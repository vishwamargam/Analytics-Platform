import { parseDateRange } from '../validation/dateRange.js';
import { getEventCounts, getPages, getRecentEvents, getSummary, getTimeseries } from '../services/analyticsService.js';

export async function summary(req, res) {
  const range = parseDateRange(req.query);
  res.json({ data: { range: { from: range.from.toISOString(), to: range.to.toISOString() }, ...(await getSummary(range)) } });
}

export async function timeseries(req, res) {
  const range = parseDateRange(req.query);
  const interval = req.query.interval || 'day';
  res.json({ data: { interval, points: await getTimeseries(range, interval) } });
}

export async function pages(req, res) {
  const range = parseDateRange(req.query);
  res.json({ data: { pages: await getPages(range, req.query.limit ?? '10') } });
}

export async function events(req, res) {
  const range = parseDateRange(req.query);
  res.json({ data: { events: await getEventCounts(range) } });
}

export async function recent(req, res) {
  const range = parseDateRange(req.query);
  res.json({ data: { events: await getRecentEvents(range, req.query.limit ?? '50') } });
}
