import { describe, expect, it } from 'vitest';
import { validateBrowserEvent } from '../src/validation/events.js';
import { parseDateRange } from '../src/validation/dateRange.js';

const baseEvent = {
  eventId: '550e8400-e29b-41d4-a716-446655440000',
  eventName: 'page_view',
  eventSource: 'server',
  timestamp: '2026-01-01T00:00:00.000Z',
  visitorId: 'visitor-1',
  sessionId: 'session-1',
  pageUrl: 'https://example.test/menu?secret=removed#top',
  referrer: null,
  schemaVersion: 1,
  properties: { section: 'menu' }
};

describe('browser event validation', () => {
  it('normalizes trust fields and strips URL query and fragment', () => {
    const event = validateBrowserEvent(baseEvent, { now: Date.parse('2026-01-01T00:00:01Z') });
    expect(event.eventSource).toBe('browser');
    expect(event.pageUrl).toBe('https://example.test/menu');
    expect(event.referrer).toBeNull();
  });

  it('rejects trusted business event names and personal data properties', () => {
    expect(() => validateBrowserEvent({ ...baseEvent, eventName: 'order_created' }, { now: Date.parse(baseEvent.timestamp) })).toThrow();
    expect(() => validateBrowserEvent({ ...baseEvent, properties: { email: 'a@example.test' } }, { now: Date.parse(baseEvent.timestamp) })).toThrow();
  });

  it('accepts the restaurant demo menu_item_clicked event name', () => {
    const event = validateBrowserEvent({ ...baseEvent, eventName: 'menu_item_clicked', properties: { menuItemId: 'margherita' } }, {
      now: Date.parse(baseEvent.timestamp)
    });
    expect(event.eventName).toBe('menu_item_clicked');
  });
});

describe('date range validation', () => {
  it('accepts equivalent aliases and produces instants', () => {
    const range = parseDateRange({ startDate: '2026-01-01T00:00:00Z', endDate: '2026-01-02T00:00:00+00:00' });
    expect(range.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects missing timezones and reversed ranges', () => {
    expect(() => parseDateRange({ from: '2026-01-01', to: '2026-01-02' })).toThrow();
    expect(() => parseDateRange({ from: '2026-01-02T00:00:00Z', to: '2026-01-01T00:00:00Z' })).toThrow();
  });
});
