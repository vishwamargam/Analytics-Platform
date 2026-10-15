import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Dashboard } from './Dashboard.jsx';
import { toUtcDateRange } from './api.js';

vi.mock('recharts', async () => {
  const React = await import('react');
  return {
    ResponsiveContainer: ({ children }) => React.createElement('div', { 'data-testid': 'chart' }, children),
    LineChart: ({ children }) => React.createElement('div', null, children),
    CartesianGrid: () => null, Line: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null
  };
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const fixtures = {
  summary: { pageViews: 12, uniqueVisitors: 5, totalEvents: 19 },
  timeseries: { interval: 'day', points: [{ timestamp: '2026-02-01T00:00:00.000Z', pageViews: 12, totalEvents: 19, uniqueVisitors: 5 }] },
  pages: { pages: [{ pagePath: '/menu', pageViews: 8 }] },
  events: { events: [{ eventName: 'page_view', eventSource: 'browser', count: 12 }, { eventName: 'order_created', eventSource: 'server', count: 2 }, { eventName: 'add_to_cart', eventSource: 'browser', count: 5 }] },
  recent: { events: [{ timestamp: '2026-02-01T10:30:00.000Z', eventName: 'order_created', eventSource: 'server', visitorId: null, pageUrl: null }] }
};

function mockApi({ fail = false, empty = false } = {}) {
  const fetchMock = vi.fn(async (url) => {
    const path = new URL(url).pathname.split('/').at(-1);
    if (fail && path === 'summary') return { ok: false, status: 503, json: async () => ({ error: { message: 'Service unavailable' } }) };
    return { ok: true, status: 200, json: async () => ({ data: empty ? {
      summary: { pageViews: 0, uniqueVisitors: 0, totalEvents: 0 },
      timeseries: { interval: 'day', points: [] }, pages: { pages: [] }, events: { events: [] }, recent: { events: [] }
    }[path] : fixtures[path] }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('dashboard', () => {
  it('converts inclusive UTC calendar dates to an exclusive end instant and rejects invalid ranges', () => {
    expect(toUtcDateRange('2026-02-01', '2026-02-07')).toEqual({ from: '2026-02-01T00:00:00.000Z', to: '2026-02-08T00:00:00.000Z' });
    expect(toUtcDateRange('2026-02-08', '2026-02-07')).toBeNull();
    expect(toUtcDateRange('not-a-date', '2026-02-07')).toBeNull();
    expect(toUtcDateRange('2026-01-01', '2026-04-01')).toBeNull();
  });

  it('renders metrics, normalized paths, event breakdown and recent events from the API', async () => {
    mockApi();
    render(<Dashboard />);
    expect(await screen.findAllByText('order_created')).not.toHaveLength(0);
    expect(screen.getAllByText('Page views').find((node) => node.closest('.metric-card')).closest('.metric-card')).toHaveTextContent('12');
    expect(screen.getByText('Unique visitors').closest('.metric-card')).toHaveTextContent('5');
    expect(screen.getByText('Tracked events').closest('.metric-card')).toHaveTextContent('19');
    expect(screen.getByText('Orders created').closest('.metric-card')).toHaveTextContent('2');
    expect(screen.getByText('/menu')).toBeInTheDocument();
    expect(document.querySelector('.visitor-cell')).toHaveTextContent('—');
    expect(document.querySelector('.timestamp-cell').textContent).toContain('2026');
  });

  it('refreshes requests with consistent UTC filters when a preset changes', async () => {
    const fetchMock = mockApi();
    render(<Dashboard />);
    await screen.findByText('19');
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(10));
    const today = new Date().toISOString().slice(0, 10);
    const lastRequest = fetchMock.mock.calls.at(-1)[0];
    const query = new URL(lastRequest).searchParams;
    expect(query.get('from')).toBe(`${today}T00:00:00.000Z`);
    const tomorrow = new Date(`${today}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    expect(query.get('to')).toBe(tomorrow.toISOString());
  });

  it('shows clear empty results for a range with no events', async () => {
    mockApi({ empty: true });
    render(<Dashboard />);
    expect(await screen.findByText('No page views in this range.')).toBeInTheDocument();
    expect(screen.getByText('No tracked events in this range.')).toBeInTheDocument();
    expect(screen.getByText('No recent events in this range.')).toBeInTheDocument();
    expect(screen.getByText('No traffic data in this range.')).toBeInTheDocument();
  });

  it('shows the backend error and retry control when requests fail', async () => {
    const fetchMock = mockApi({ fail: true });
    render(<Dashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(10));
  });
});
