import { describe, expect, it, vi } from 'vitest';
import { createAnalyticsClient } from '../src/index.js';

const WRITE_KEY = 'unit-test-server-write-key-123';
const successfulResponse = (eventId, status = 'accepted') => ({
  ok: true,
  status: status === 'duplicate' ? 200 : 202,
  json: async () => ({ data: { eventId, status } })
});

function makeClient(fetchImpl, options = {}) {
  return createAnalyticsClient({
    endpoint: 'https://analytics.example.test/api/events',
    writeKey: WRITE_KEY,
    fetchImpl,
    retryDelayMs: 0,
    ...options
  });
}

describe('server analytics SDK', () => {
  it('sends a schema-compatible trusted event with the write key only in authorization', async () => {
    let sent;
    const fetchImpl = vi.fn(async (url, options) => {
      sent = { url, options };
      const event = JSON.parse(options.body);
      return successfulResponse(event.eventId);
    });
    const client = makeClient(fetchImpl);
    const result = await client.track('order_created', {
      orderId: 'order-123', itemCount: 2, totalAmount: 25.98, currency: 'USD'
    }, { eventId: 'event-order-123', timestamp: new Date('2026-04-01T12:00:00Z') });

    const event = JSON.parse(sent.options.body);
    expect(result).toMatchObject({ ok: true, status: 'sent', eventId: 'event-order-123', attempts: 1 });
    expect(sent.url).toBe('https://analytics.example.test/api/events');
    expect(sent.options.headers.Authorization).toBe(`Bearer ${WRITE_KEY}`);
    expect(sent.options.body).not.toContain(WRITE_KEY);
    expect(event).toMatchObject({
      eventId: 'event-order-123', eventName: 'order_created', eventSource: 'server',
      timestamp: '2026-04-01T12:00:00.000Z', visitorId: null, sessionId: null,
      pageUrl: null, referrer: null, schemaVersion: 1,
      properties: { orderId: 'order-123', itemCount: 2, totalAmount: 25.98 }
    });
  });

  it('retries transient status codes with identical event ID, timestamp, and body', async () => {
    const requests = [];
    const fetchImpl = vi.fn(async (_url, options) => {
      requests.push(options.body);
      if (requests.length === 1) return { ok: false, status: 503 };
      const event = JSON.parse(options.body);
      return successfulResponse(event.eventId);
    });
    const client = makeClient(fetchImpl, { maxRetries: 2 });
    const result = await client.track('order_created', {
      orderId: 'order-456', itemCount: 1, totalAmount: 12.99
    }, { eventId: 'order-event-456', timestamp: '2026-04-02T00:00:00Z' });
    expect(result).toMatchObject({ ok: true, attempts: 2, eventId: 'order-event-456' });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe(requests[1]);
  });

  it('aborts timed out requests and obeys the retry limit without throwing', async () => {
    const fetchImpl = vi.fn((_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const onError = vi.fn();
    const client = makeClient(fetchImpl, { timeoutMs: 5, maxRetries: 2, onError });
    const result = await client.track('order_created', { orderId: 'order-789', itemCount: 1, totalAmount: 3.99 });
    expect(result).toMatchObject({ ok: false, status: 'failed', attempts: 3, error: { code: 'TIMEOUT' } });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ eventId: result.eventId, attempts: 3, code: 'TIMEOUT' }));
  });

  it('does not retry validation responses or malformed success responses', async () => {
    const rejected = makeClient(vi.fn(async () => ({ ok: false, status: 400 })));
    const rejectedResult = await rejected.track('order_created', { orderId: 'order-400', itemCount: 1, totalAmount: 1 });
    expect(rejectedResult).toMatchObject({ ok: false, attempts: 1, error: { code: 'REJECTED' } });

    const malformedFetch = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ unexpected: true }) }));
    const malformed = makeClient(malformedFetch);
    const malformedResult = await malformed.track('order_created', { orderId: 'order-202', itemCount: 1, totalAmount: 1 });
    expect(malformedResult).toMatchObject({ ok: false, attempts: 1, error: { code: 'INVALID_RESPONSE' } });
    expect(malformedFetch).toHaveBeenCalledTimes(1);
  });

  it('retries network errors only up to the configured bound and reports them safely', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('secret-bearing low-level error'));
    const onError = vi.fn();
    const client = makeClient(fetchImpl, { maxRetries: 1, onError });
    const result = await client.track('order_created', { orderId: 'order-net', itemCount: 1, totalAmount: 1 });
    expect(result).toMatchObject({ ok: false, attempts: 2, error: { code: 'NETWORK_ERROR' } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(onError.mock.calls)).not.toContain('secret-bearing');
  });

  it('supports in-process transports and treats duplicate writes as success', async () => {
    const transport = vi.fn(async () => ({ duplicate: true }));
    const client = createAnalyticsClient({ transport, maxRetries: 1, retryDelayMs: 0 });
    const result = await client.track('order_created', { orderId: 'order-db', itemCount: 1, totalAmount: 7.99 }, { eventId: 'order:order-db' });
    expect(result).toMatchObject({ ok: true, status: 'duplicate', eventId: 'order:order-db' });
    expect(transport.mock.calls[0][0]).toMatchObject({ eventSource: 'server', schemaVersion: 1, eventName: 'order_created' });
  });

  it('rejects unsupported event names and sensitive property keys', async () => {
    const client = makeClient(vi.fn());
    await expect(client.track('page_view', {})).rejects.toThrow(/not permitted/);
    await expect(client.track('order_created', { orderId: 'order-pii', itemCount: 1, totalAmount: 1, email: 'x@y.test' })).rejects.toThrow(/not permitted/);
  });
});
