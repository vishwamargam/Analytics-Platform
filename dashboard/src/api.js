const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

export async function fetchDashboardData(range, { signal } = {}) {
  const query = new URLSearchParams({ from: range.from, to: range.to });
  const paths = ['summary', 'timeseries', 'pages', 'events', 'recent'];
  const results = await Promise.all(paths.map(async (path) => {
    const response = await fetch(`${API_BASE_URL}/api/analytics/${path}?${query}`, { signal, headers: { Accept: 'application/json' } });
    let body;
    try { body = await response.json(); } catch { throw new Error(`Analytics API returned an invalid response (${path}).`); }
    if (!response.ok) throw new Error(body?.error?.message || `Analytics request failed (${response.status}).`);
    if (!body?.data) throw new Error(`Analytics API response was missing data (${path}).`);
    return body.data;
  }));
  return { summary: results[0], timeseries: results[1], pages: results[2], events: results[3], recent: results[4] };
}

export function toUtcDateRange(startDate, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  const from = new Date(`${startDate}T00:00:00.000Z`);
  const endDay = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(endDay.getTime()) || from.toISOString().slice(0, 10) !== startDate || endDay.toISOString().slice(0, 10) !== endDate || from > endDay) return null;
  endDay.setUTCDate(endDay.getUTCDate() + 1);
  if (endDay.getTime() - from.getTime() > 90 * 24 * 60 * 60 * 1000) return null;
  return { from: from.toISOString(), to: endDay.toISOString() };
}
