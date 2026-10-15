import { AnalyticsEvent } from '../models/AnalyticsEvent.js';
import { HttpError } from '../utils/httpError.js';

const matchRange = (range) => ({ timestamp: { $gte: range.from, $lt: range.to } });

export async function getSummary(range) {
  const [totalEvents, pageViews, uniqueResult] = await Promise.all([
    AnalyticsEvent.countDocuments(matchRange(range)),
    AnalyticsEvent.countDocuments({ ...matchRange(range), eventName: 'page_view', eventSource: 'browser' }),
    AnalyticsEvent.aggregate([
      { $match: { ...matchRange(range), eventSource: 'browser', visitorId: { $type: 'string', $ne: '' } } },
      { $group: { _id: '$visitorId' } },
      { $count: 'count' }
    ])
  ]);
  return { totalEvents, pageViews, uniqueVisitors: uniqueResult[0]?.count ?? 0 };
}

export async function getRecentEvents(range, rawLimit = '50') {
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'INVALID_LIMIT', 'limit must be an integer from 1 to 100');
  return AnalyticsEvent.find(matchRange(range))
    .sort({ timestamp: -1, _id: -1 })
    .limit(limit)
    .select('timestamp eventName eventSource visitorId pageUrl -_id')
    .lean();
}

export async function getPages(range, rawLimit = '10') {
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'INVALID_LIMIT', 'limit must be an integer from 1 to 100');
  return AnalyticsEvent.aggregate([
    { $match: { ...matchRange(range), eventName: 'page_view', eventSource: 'browser', pageUrl: { $type: 'string' } } },
    { $project: {
      pagePath: { $let: {
        vars: {
          absolute: { $regexFind: { input: '$pageUrl', regex: /^https?:\/\/[^/]+([^?#]*)/i } },
          relative: { $arrayElemAt: [{ $split: [{ $arrayElemAt: [{ $split: ['$pageUrl', '#'] }, 0] }, '?'] }, 0] }
        },
        in: { $cond: [
          { $ne: ['$$absolute', null] },
          { $let: { vars: { path: { $arrayElemAt: ['$$absolute.captures', 0] } }, in: { $cond: [{ $eq: ['$$path', ''] }, '/', '$$path'] } } },
          '$$relative'
        ] }
      } }
    } },
    { $group: { _id: '$pagePath', pageViews: { $sum: 1 } } },
    { $sort: { pageViews: -1, _id: 1 } },
    { $limit: limit },
    { $project: { _id: 0, pagePath: '$_id', pageViews: 1 } }
  ]);
}

export async function getEventCounts(range) {
  return AnalyticsEvent.aggregate([
    { $match: matchRange(range) },
    { $group: { _id: { eventName: '$eventName', eventSource: '$eventSource' }, count: { $sum: 1 } } },
    { $sort: { '_id.eventName': 1, '_id.eventSource': 1 } },
    { $project: { _id: 0, eventName: '$_id.eventName', eventSource: '$_id.eventSource', count: 1 } }
  ]);
}

export async function getTimeseries(range, interval = 'day') {
  if (!['hour', 'day'].includes(interval)) throw new HttpError(400, 'INVALID_INTERVAL', 'interval must be hour or day');
  const bucketFormat = interval === 'hour' ? '%Y-%m-%dT%H:00:00.000Z' : '%Y-%m-%dT00:00:00.000Z';
  const grouped = await AnalyticsEvent.aggregate([
    { $match: matchRange(range) },
    { $group: {
      _id: { $dateToString: { date: '$timestamp', format: bucketFormat, timezone: 'UTC' } },
      totalEvents: { $sum: 1 },
      pageViews: { $sum: { $cond: [{ $and: [{ $eq: ['$eventName', 'page_view'] }, { $eq: ['$eventSource', 'browser'] }] }, 1, 0] } },
      visitors: { $addToSet: { $cond: [
        { $and: [{ $eq: ['$eventSource', 'browser'] }, { $ne: ['$visitorId', null] }, { $ne: ['$visitorId', ''] }] },
        '$visitorId', null
      ] } }
    } },
    { $project: {
      _id: 1, totalEvents: 1, pageViews: 1,
      uniqueVisitors: { $size: { $filter: { input: '$visitors', as: 'visitor', cond: { $ne: ['$$visitor', null] } } } }
    } },
    { $sort: { _id: 1 } }
  ]);

  const step = interval === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  if (Math.ceil((range.to - range.from) / step) > 2200) throw new HttpError(400, 'RANGE_TOO_LARGE', 'requested interval produces too many buckets');
  const bucketStart = (value) => Math.floor(value / step) * step;
  const values = new Map(grouped.map((row) => [row._id, {
    timestamp: row._id,
    totalEvents: row.totalEvents,
    pageViews: row.pageViews,
    uniqueVisitors: row.uniqueVisitors
  }]));
  const result = [];
  for (let cursor = bucketStart(range.from.getTime()); cursor < range.to.getTime(); cursor += step) {
    const timestamp = new Date(cursor).toISOString();
    result.push(values.get(timestamp) || { timestamp, totalEvents: 0, pageViews: 0, uniqueVisitors: 0 });
  }
  return result;
}
