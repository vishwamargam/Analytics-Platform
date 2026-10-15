import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Analytics from '../src/index.js';

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    values
  };
}

function setupBrowser({ href = 'https://restaurant.test/menu?campaign=spring#top', referrer = 'https://search.test/find?q=pizza' } = {}) {
  const listeners = new Map();
  const local = storage();
  const session = storage();
  const window = {
    location: { href },
    addEventListener: vi.fn((name, fn) => listeners.set(name, fn)),
    removeEventListener: vi.fn((name) => listeners.delete(name)),
    listeners
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: window.location });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { referrer } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: session });
  return { window, local, session };
}

const ok = () => Promise.resolve({ ok: true, status: 202 });

beforeEach(() => {
  vi.restoreAllMocks();
  setupBrowser();
  globalThis.fetch = vi.fn(ok);
});

afterEach(() => {
  Analytics.destroy();
  vi.useRealTimers();
  delete globalThis.window;
  delete globalThis.location;
  delete globalThis.document;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
  delete globalThis.fetch;
});

describe('browser analytics SDK', () => {
  it('creates backend-compatible events with sanitized page context', async () => {
    const sdk = Analytics.init({ endpoint: 'https://api.test/api/events' });
    const id = sdk.track('add_to_cart', { menuItemId: 'margherita', quantity: 1 });
    await sdk.flush();

    const event = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(event).toMatchObject({
      eventId: id,
      eventName: 'add_to_cart',
      eventSource: 'browser',
      pageUrl: 'https://restaurant.test/menu',
      referrer: 'https://search.test/find',
      properties: { menuItemId: 'margherita', quantity: 1 },
      schemaVersion: 1
    });
    expect(event.visitorId).toBe(globalThis.localStorage.getItem('analytics:visitor:v1'));
    expect(event.sessionId).toBe(globalThis.sessionStorage.getItem('analytics:session:v1'));
    expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(event.timestamp).toBe(new Date(event.timestamp).toISOString());
    expect(event.visitorId).toBeTruthy();
    expect(event.sessionId).toBeTruthy();
    expect(globalThis.fetch.mock.calls[0][0]).toBe('https://api.test/api/events');
  });

  it('persists visitor and session IDs and tolerates unavailable storage', async () => {
    const browser = setupBrowser();
    const first = Analytics.init({ endpoint: 'https://api.test/api/events' });
    const firstId = first.track('checkout_started');
    await first.flush();
    const firstPayload = JSON.parse(globalThis.fetch.mock.calls.at(-1)[1].body);
    Analytics.destroy();

    globalThis.fetch = vi.fn(ok);
    const second = Analytics.init({ endpoint: 'https://api.test/api/events' });
    second.track('checkout_started');
    await second.flush();
    const secondPayload = JSON.parse(globalThis.fetch.mock.calls.at(-1)[1].body);
    expect(secondPayload.visitorId).toBe(firstPayload.visitorId);
    expect(secondPayload.sessionId).toBe(firstPayload.sessionId);
    expect(browser.local.setItem).toHaveBeenCalledTimes(1);
    expect(browser.session.setItem).toHaveBeenCalledTimes(1);
    expect(firstId).not.toBe(secondPayload.eventId);

    Analytics.destroy();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('blocked'); } });
    const storageFree = Analytics.init({ endpoint: 'https://api.test/api/events' });
    expect(() => storageFree.track('custom_event')).not.toThrow();
    await storageFree.flush();
  });

  it('tracks the initial view when enabled and deduplicates explicit same-route notifications', async () => {
    const sdk = Analytics.init({ endpoint: 'https://api.test/api/events', autoTrackPageViews: true });
    const initial = sdk.trackPageView();
    expect(initial).toBeNull();
    await sdk.flush();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    globalThis.window.location.href = 'https://restaurant.test/cart';
    const next = sdk.trackPageView();
    expect(next).toBeTruthy();
    await sdk.flush();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(globalThis.fetch.mock.calls[1][1].body).eventName).toBe('page_view');
  });

  it('makes repeated init calls safe and never transmits a write key', async () => {
    const first = Analytics.init({ endpoint: 'https://api.test/api/events', autoTrackPageViews: true });
    expect(Analytics.init({ endpoint: 'https://other.test/api/events', autoTrackPageViews: true })).toBe(first);
    expect(globalThis.window.addEventListener).toHaveBeenCalledTimes(1);
    await first.flush();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).eventName).toBe('page_view');
    first.track('custom_event');
    await first.flush();
    expect(globalThis.fetch.mock.calls[1][1].headers).toEqual({ 'Content-Type': 'application/json' });
    expect(globalThis.fetch.mock.calls[1][1].body).not.toContain('public-or-secret');
    Analytics.destroy();
    expect(() => Analytics.init({ endpoint: 'https://api.test/api/events', writeKey: 'public-or-secret' })).toThrow(/does not support a public writeKey/);
  });

  it('accepts custom names, rejects malformed event data locally', async () => {
    const sdk = Analytics.init({ endpoint: 'https://api.test/api/events' });
    expect(sdk.track('menu_item_clicked', { itemId: 'veggie' })).toBeTruthy();
    expect(() => sdk.track('Not An Event')).toThrow();
    expect(() => sdk.track('custom_event', { email: 'person@example.test' })).toThrow();
    expect(() => sdk.track('custom_event', { nested: { value: true } })).toThrow();
    await sdk.flush();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures with the same event ID and stops on permanent rejection', async () => {
    vi.useFakeTimers();
    const sdk = Analytics.init({ endpoint: 'https://api.test/api/events' });
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, status: 202 });
    const eventId = sdk.track('checkout_started');
    const completed = sdk.flush();
    await vi.runAllTimersAsync();
    const results = await completed;
    expect(results[0].status).toBe('sent');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).eventId).toBe(eventId);
    expect(globalThis.fetch.mock.calls[1][1].body).toBe(globalThis.fetch.mock.calls[0][1].body);

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    sdk.track('custom_event');
    const rejected = sdk.flush();
    await vi.runAllTimersAsync();
    expect((await rejected)[0].status).toBe('rejected');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns a bounded failure result when the ingestion service stays offline', async () => {
    vi.useFakeTimers();
    const sdk = Analytics.init({ endpoint: 'https://api.test/api/events' });
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    expect(() => sdk.track('checkout_started')).not.toThrow();
    const flushing = sdk.flush();
    await vi.runAllTimersAsync();
    const results = await flushing;
    expect(results[0]).toMatchObject({ status: 'failed' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('uses keepalive JSON on pagehide without relying on an inspectable beacon response', async () => {
    const { window } = setupBrowser();
    const sdk = Analytics.init({ endpoint: 'https://api.test/api/events' });
    sdk.track('custom_event');
    window.listeners.get('pagehide')();
    await sdk.flush();
    expect(globalThis.fetch.mock.calls[0][1].keepalive).toBe(true);
  });
});
