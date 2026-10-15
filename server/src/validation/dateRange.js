import { HttpError } from '../utils/httpError.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000;

function hasValidCalendarDate(value) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseDateRange(query) {
  const fromText = query.from ?? query.startDate;
  const toText = query.to ?? query.endDate;
  if (typeof fromText !== 'string' || typeof toText !== 'string' || !DATE_PATTERN.test(fromText) || !DATE_PATTERN.test(toText)
      || !hasValidCalendarDate(fromText) || !hasValidCalendarDate(toText)) {
    throw new HttpError(400, 'INVALID_DATE_RANGE', 'from and to must be ISO 8601 datetimes with an explicit timezone');
  }
  const from = new Date(fromText);
  const to = new Date(toText);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    throw new HttpError(400, 'INVALID_DATE_RANGE', 'date range must be valid and from must be earlier than to');
  }
  if (to - from > MAX_RANGE_MS) throw new HttpError(400, 'INVALID_DATE_RANGE', 'date range must not exceed 90 days');
  return { from, to };
}
