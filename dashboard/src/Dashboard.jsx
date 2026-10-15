import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchDashboardData, toUtcDateRange } from './api.js';

const todayUtc = () => new Date().toISOString().slice(0, 10);
const daysAgoUtc = (days) => {
  const date = new Date(`${todayUtc()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};
const initialRange = { start: daysAgoUtc(6), end: todayUtc() };
const number = (value) => new Intl.NumberFormat().format(value ?? 0);
const dateTime = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value));
const pagePath = (url) => {
  if (!url) return '—';
  try { return new URL(url).pathname || '/'; } catch { return url; }
};

function MetricCard({ label, value, note, icon }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><strong>{number(value)}</strong><small>{note}</small></article>;
}

function DateControls({ start, end, onRange, onDates }) {
  const preset = (days) => {
    onRange({ start: daysAgoUtc(days - 1), end: todayUtc() });
  };
  return <section className="filter-bar" aria-label="Date range filter">
    <div className="presets" aria-label="Date presets">
      <button onClick={() => preset(1)} aria-label="Today">Today</button>
      <button onClick={() => preset(7)} aria-label="Last 7 days">7 days</button>
      <button onClick={() => preset(30)} aria-label="Last 30 days">30 days</button>
    </div>
    <div className="date-inputs">
      <label>From <input aria-label="Start date" type="date" value={start} max={end} onChange={(event) => onDates({ start: event.target.value, end })} /></label>
      <span className="date-separator">to</span>
      <label>To <input aria-label="End date" type="date" value={end} min={start} max={todayUtc()} onChange={(event) => onDates({ start, end: event.target.value })} /></label>
    </div>
  </section>;
}

function DataTable({ title, subtitle, headers, rows, empty, className = '' }) {
  return <section className={`panel table-panel ${className}`}><div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>
    {rows.length ? <div className="table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows}</tbody></table></div> : <div className="table-empty">{empty}</div>}
  </section>;
}

export function Dashboard() {
  const [dates, setDates] = useState(initialRange);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const range = useMemo(() => toUtcDateRange(dates.start, dates.end), [dates]);

  useEffect(() => {
    if (!range) {
      setLoading(false);
      setError('Choose a valid UTC date range no longer than 90 days.');
      setResult(null);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setResult(null);
    fetchDashboardData(range, { signal: controller.signal })
      .then((data) => { setResult(data); setError(''); })
      .catch((fetchError) => {
        if (fetchError.name !== 'AbortError') { setError(fetchError.message || 'Could not load analytics.'); setResult(null); }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range]);

  const dateLabel = range ? `${dates.start} – ${dates.end} UTC` : 'Invalid date range';
  const eventCounts = result?.events?.events ?? [];
  const orderCount = eventCounts.filter((row) => row.eventName === 'order_created').reduce((sum, row) => sum + row.count, 0);
  const chartRows = (result?.timeseries?.points ?? []).map((point) => ({ ...point, otherEvents: Math.max(0, point.totalEvents - point.pageViews), label: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...(result?.timeseries?.interval === 'hour' ? { hour: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(point.timestamp)) }));
  const eventTotal = result?.summary?.totalEvents ?? 0;

  return <div className="dashboard-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-symbol">A</span><span>Atlas<span> / Insights</span></span></div><div className="side-label">WORKSPACE</div><div className="side-item active"><span>▦</span> Overview</div><div className="sidebar-foot"><span className="status-dot" /> API connected</div></aside>
    <main className="main-content">
      <header className="topbar"><div><span className="breadcrumb">Analytics <span>/</span> Overview</span><h1>Overview</h1></div><div className="topbar-right"><span className="live-pill"><i /> Live data</span><span className="avatar">A</span></div></header>
      <div className="content-area">
        <div className="section-intro"><div><h2>Performance at a glance</h2><p>Understand how visitors are engaging with your site.</p></div><span className="range-caption">Showing <strong>{dateLabel}</strong></span></div>
        <DateControls start={dates.start} end={dates.end} onRange={setDates} onDates={setDates} />
        {error && <div className="alert" role="alert"><span className="alert-mark">!</span><div><strong>Analytics unavailable</strong><p>{error}</p></div><button onClick={() => setDates((current) => ({ ...current }))}>Retry</button></div>}
        {loading && <div className="loading-banner" role="status"><span className="spinner" /> Loading analytics for {dateLabel}…</div>}
        {result && !error && <>
          <section className="metric-grid" aria-label="Summary metrics">
            <MetricCard label="Page views" value={result.summary.pageViews} note="Browser page_view events" icon="◉" />
            <MetricCard label="Unique visitors" value={result.summary.uniqueVisitors} note="Distinct browser IDs in range" icon="♙" />
            <MetricCard label="Tracked events" value={eventTotal} note="All sources and event types" icon="⌁" />
            <MetricCard label="Orders created" value={orderCount} note="Trusted server events" icon="↗" />
          </section>
          <section className="panel chart-panel"><div className="panel-heading"><div><h2>Traffic over time</h2><p>Page views and other tracked events · UTC</p></div><div className="chart-legend"><span><i className="legend-page" /> Page views</span><span><i className="legend-events" /> Other events</span></div></div>
            {chartRows.length && eventTotal > 0 ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartRows} margin={{ top: 12, right: 8, left: -16, bottom: 0 }}><CartesianGrid stroke="#edf0f5" vertical={false} /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#8790a1', fontSize: 11 }} minTickGap={32} /><YAxis axisLine={false} tickLine={false} tick={{ fill: '#8790a1', fontSize: 11 }} allowDecimals={false} /><Tooltip contentStyle={{ border: '1px solid #e7eaf0', borderRadius: 10, boxShadow: '0 8px 24px #20294412' }} /><Line type="monotone" dataKey="pageViews" name="Page views" stroke="#5475e5" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} /><Line type="monotone" dataKey="otherEvents" name="Other events" stroke="#32a88a" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div> : <div className="table-empty">No traffic data in this range.</div>}
          </section>
          <div className="two-column">
            <DataTable title="Popular pages" subtitle="Pages ranked by page views" headers={['Page path', 'Page views']} empty="No page views in this range." rows={(result.pages.pages ?? []).map((page) => <tr key={page.pagePath}><td><span className="path-dot" />{page.pagePath || pagePath(page.pageUrl)}</td><td className="count-cell">{number(page.pageViews)}</td></tr>)} />
            <DataTable title="Event breakdown" subtitle="Events grouped by name and source" headers={['Event / source', 'Count']} empty="No tracked events in this range." rows={eventCounts.map((event) => <tr key={`${event.eventName}-${event.eventSource}`}><td><span className={`source-dot ${event.eventSource}`} />{event.eventName}<small className="source-label">{event.eventSource}</small></td><td className="count-cell">{number(event.count)}</td></tr>)} />
          </div>
          <DataTable title="Recent events" subtitle="Latest events received in the selected range" className="recent-panel" headers={['Timestamp (UTC)', 'Event name', 'Source', 'Visitor ID', 'Page path']} empty="No recent events in this range." rows={(result.recent.events ?? []).map((event, index) => <tr key={`${event.timestamp}-${event.eventName}-${index}`}><td className="timestamp-cell">{dateTime(event.timestamp)}</td><td><span className="event-name">{event.eventName}</span></td><td><span className={`source-badge ${event.eventSource}`}>{event.eventSource}</span></td><td className="visitor-cell">{event.visitorId || '—'}</td><td>{pagePath(event.pageUrl)}</td></tr>)} />
        </>}
        <footer className="page-footer">Reporting uses UTC calendar dates and an exclusive end boundary. Unique visitors are deduplicated across the full selected range.</footer>
      </div>
    </main>
  </div>;
}
