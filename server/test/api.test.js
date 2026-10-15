import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { AnalyticsEvent } from '../src/models/AnalyticsEvent.js';
import { RestaurantOrder } from '../src/models/RestaurantOrder.js';
import { createAnalyticsClient } from '@analytics-platform/server-sdk';
import { config } from '../src/config/env.js';
import { createPublicRateLimit } from '../src/middleware/rateLimits.js';

let mongo;
const app = createApp();
const internalApp = createApp({ internalIngestionKey: 'test-server-ingestion-key-123' });
const from = '2026-02-01T00:00:00.000Z';
const to = '2026-02-02T00:00:00.000Z';

function pageEvent(eventId, visitorId, timestamp, pageUrl = 'https://restaurant.test/menu') {
  return {
    eventId,
    eventName: 'page_view',
    timestamp,
    visitorId,
    sessionId: `session-${visitorId}`,
    pageUrl,
    referrer: null,
    properties: { section: 'menu' },
    schemaVersion: 1
  };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([AnalyticsEvent.init(), RestaurantOrder.init()]);
}, 600_000);

beforeEach(async () => {
  await Promise.all([AnalyticsEvent.deleteMany({}), RestaurantOrder.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
}, 30_000);

describe('health and browser ingestion', () => {
  it('reports readiness when MongoDB is connected', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body.data.status).toBe('ok');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows configured origins and the server SDK authorization header, and rejects unlisted origins', async () => {
    const response = await request(app).options('/api/events')
      .set('Origin', config.allowedOrigins[0])
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type')
      .expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(config.allowedOrigins[0]);
    expect(response.headers['access-control-allow-headers'].toLowerCase()).toContain('authorization');
    await request(app).get('/api/health').set('Origin', 'https://unlisted.example').expect(403);
  });

  it('enforces a configurable rate limit before event validation', async () => {
    const limitedApp = createApp({ rateLimiter: createPublicRateLimit({ windowMs: 60_000, limit: 1 }) });
    await request(limitedApp).post('/api/events').send({}).expect(400);
    const response = await request(limitedApp).post('/api/events').send({}).expect(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
  });

  it('forces browser source, accepts once, and handles a duplicate idempotently', async () => {
    const payload = pageEvent('550e8400-e29b-41d4-a716-446655440001', 'visitor-a', new Date().toISOString());
    const first = await request(app).post('/api/events').send({ ...payload, eventSource: 'server' }).expect(202);
    const duplicate = await request(app).post('/api/events').send(payload).expect(200);
    expect(first.body.data.status).toBe('accepted');
    expect(duplicate.body.data.status).toBe('duplicate');
    const saved = await AnalyticsEvent.findOne({ eventId: payload.eventId });
    expect(saved.eventSource).toBe('browser');
    expect(await AnalyticsEvent.countDocuments()).toBe(1);
  });

  it('rejects invalid event input and prevents browser business events', async () => {
    await request(app).post('/api/events').send({ eventName: 'page_view' }).expect(400);
    await request(app).post('/api/events').send(pageEvent(
      '550e8400-e29b-41d4-a716-446655440002', 'visitor-a', new Date().toISOString()
    )).expect(202);
    const business = pageEvent('550e8400-e29b-41d4-a716-446655440003', 'visitor-a', new Date().toISOString());
    await request(app).post('/api/events').send({ ...business, eventName: 'order_created' }).expect(400);
  });

  it('rejects oversized JSON bodies with a safe client error', async () => {
    const response = await request(app).post('/api/events').send({ oversized: 'x'.repeat(17 * 1024) }).expect(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(response.body.error.message).not.toContain('stack');
  });

  it('accepts authenticated trusted server events and rejects unauthenticated business events', async () => {
    const event = {
      eventId: 'order:event-internal-test',
      eventName: 'order_created',
      eventSource: 'browser',
      timestamp: new Date().toISOString(),
      properties: { orderId: 'order-internal', itemCount: 1, totalAmount: 12.99 },
      schemaVersion: 1
    };
    await request(internalApp).post('/api/events').send(event).expect(400);
    const response = await request(internalApp).post('/api/events')
      .set('Authorization', 'Bearer test-server-ingestion-key-123').send(event).expect(202);
    expect(response.body.data.status).toBe('accepted');
    expect((await AnalyticsEvent.findOne({ eventId: event.eventId })).eventSource).toBe('server');
    await request(internalApp).post('/api/events').set('Authorization', 'Bearer invalid-key').send(event).expect(401);
  });

  it('sends a server SDK event through the authenticated ingestion API', async () => {
    const listener = internalApp.listen(0);
    try {
      await new Promise((resolve) => listener.once('listening', resolve));
      const address = listener.address();
      const client = createAnalyticsClient({
        endpoint: `http://127.0.0.1:${address.port}/api/events`,
        writeKey: 'test-server-ingestion-key-123',
        timeoutMs: 2000
      });
      const result = await client.track('order_created', {
        orderId: 'order-via-sdk', itemCount: 1, totalAmount: 12.99
      }, { eventId: 'server-sdk-event-123', timestamp: new Date() });
      expect(result).toMatchObject({ ok: true, status: 'sent', eventId: 'server-sdk-event-123' });
      const event = await AnalyticsEvent.findOne({ eventId: 'server-sdk-event-123' });
      expect(event.eventSource).toBe('server');
      await client.close();
    } finally {
      await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe('orders', () => {
  it('uses trusted menu prices and emits exactly one server event on retry', async () => {
    const body = { items: [{ menuItemId: 'margherita', quantity: 2 }] };
    const first = await request(app).post('/api/orders').set('Idempotency-Key', 'order-request-123').send(body).expect(201);
    const replay = await request(app).post('/api/orders').set('Idempotency-Key', 'order-request-123').send(body).expect(201);
    expect(first.body.data.totalMinor).toBe(2598);
    expect(replay.body.data.orderId).toBe(first.body.data.orderId);
    expect(await RestaurantOrder.countDocuments()).toBe(1);
    expect(await AnalyticsEvent.countDocuments({ eventName: 'order_created' })).toBe(1);
    const event = await AnalyticsEvent.findOne({ eventName: 'order_created' });
    expect(event.eventSource).toBe('server');
    expect(event.eventId).toBe(`order:${first.body.data.orderId}`);
    expect(event.properties.totalMinor).toBe(2598);
    expect(event.properties.totalAmount).toBe(25.98);
  });

  it('rejects changed payload under a reused key and does not trust supplied prices', async () => {
    const first = { items: [{ menuItemId: 'veggie', quantity: 1 }] };
    const altered = { items: [{ menuItemId: 'veggie', quantity: 1, unitPriceMinor: 1 }] };
    await request(app).post('/api/orders').set('Idempotency-Key', 'order-request-456').send(first).expect(201);
    await request(app).post('/api/orders').set('Idempotency-Key', 'order-request-456').send(altered).expect(400);
    const order = await RestaurantOrder.findOne({ idempotencyKey: 'order-request-456' });
    expect(order.totalMinor).toBe(1499);
  });

  it('does not create an order or business event when order validation fails', async () => {
    await request(app).post('/api/orders').set('Idempotency-Key', 'invalid-order-123').send({
      items: [{ menuItemId: 'not-on-menu', quantity: 1 }]
    }).expect(400);
    expect(await RestaurantOrder.countDocuments()).toBe(0);
    expect(await AnalyticsEvent.countDocuments({ eventName: 'order_created' })).toBe(0);
  });

  it('does not emit a business event when the order database write fails and hides the stack from clients', async () => {
    const createOrderDocument = vi.spyOn(RestaurantOrder, 'create').mockRejectedValue(new Error('database failure detail'));
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await request(app).post('/api/orders').set('Idempotency-Key', 'order-db-failure-1').send({
        items: [{ menuItemId: 'margherita', quantity: 1 }]
      }).expect(500);
      expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
      expect(JSON.stringify(response.body)).not.toContain('database failure detail');
      expect(await AnalyticsEvent.countDocuments({ eventName: 'order_created' })).toBe(0);
    } finally {
      createOrderDocument.mockRestore();
      logError.mockRestore();
    }
  });

  it('keeps a persisted order successful when analytics storage is unavailable and repairs the event on retry', async () => {
    const body = { items: [{ menuItemId: 'lemonade', quantity: 1 }] };
    const createEvent = vi.spyOn(AnalyticsEvent, 'create').mockRejectedValue(new Error('analytics store unavailable'));
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const first = await request(app).post('/api/orders').set('Idempotency-Key', 'order-repair-123').send(body).expect(201);
      expect(await RestaurantOrder.countDocuments()).toBe(1);
      expect(await AnalyticsEvent.countDocuments({ eventName: 'order_created' })).toBe(0);
      expect(logError).toHaveBeenCalled();
      createEvent.mockRestore();
      const replay = await request(app).post('/api/orders').set('Idempotency-Key', 'order-repair-123').send(body).expect(201);
      expect(replay.body.data.orderId).toBe(first.body.data.orderId);
      expect(await RestaurantOrder.countDocuments()).toBe(1);
      expect(await AnalyticsEvent.countDocuments({ eventName: 'order_created' })).toBe(1);
    } finally {
      createEvent.mockRestore();
      logError.mockRestore();
    }
  });
});

describe('analytics ranges and aggregations', () => {
  it('counts views and unique visitors with an exclusive end boundary', async () => {
    await AnalyticsEvent.create([
      { ...pageEvent('event-a', 'visitor-a', from), eventSource: 'browser' },
      { ...pageEvent('event-b', 'visitor-a', '2026-02-01T12:00:00.000Z'), eventSource: 'browser' },
      { ...pageEvent('event-custom', 'visitor-b', '2026-02-01T18:00:00.000Z', 'https://restaurant.test/cart'), eventName: 'add_to_cart', eventSource: 'browser' },
      { ...pageEvent('event-c', 'visitor-b', to), eventSource: 'browser' }
    ]);
    const response = await request(app).get('/api/analytics/summary').query({ from, to }).expect(200);
    expect(response.body.data.pageViews).toBe(2);
    expect(response.body.data.uniqueVisitors).toBe(2);
    expect(response.body.data.totalEvents).toBe(3);
  });

  it('counts a returning visitor once across the selected range but once in each daily bucket', async () => {
    await AnalyticsEvent.create([
      { ...pageEvent('multi-day-a', 'visitor-a', '2026-02-01T23:59:59.999Z'), eventSource: 'browser' },
      { ...pageEvent('multi-day-a2', 'visitor-a', '2026-02-02T00:00:00.000Z'), eventName: 'add_to_cart', eventSource: 'browser' },
      { ...pageEvent('multi-day-b', 'visitor-b', '2026-02-02T12:00:00.000Z'), eventSource: 'browser' }
    ]);
    const rangeTo = '2026-02-03T00:00:00.000Z';
    const summary = await request(app).get('/api/analytics/summary').query({ from, to: rangeTo }).expect(200);
    const series = await request(app).get('/api/analytics/timeseries').query({ from, to: rangeTo, interval: 'day' }).expect(200);
    expect(summary.body.data).toMatchObject({ pageViews: 2, totalEvents: 3, uniqueVisitors: 2 });
    expect(series.body.data.points.map(({ uniqueVisitors }) => uniqueVisitors)).toEqual([1, 2]);
  });

  it('returns popular pages, event counts, UTC daily series, and empty buckets', async () => {
    await AnalyticsEvent.create([
      { ...pageEvent('event-d', 'visitor-a', '2026-02-01T01:00:00.000Z'), eventSource: 'browser' },
      { ...pageEvent('event-e', 'visitor-b', '2026-02-01T02:00:00.000Z', 'https://restaurant.test/menu?campaign=spring'), eventSource: 'browser' },
      { ...pageEvent('event-f-browser', 'visitor-c', '2026-02-01T02:30:00.000Z'), eventName: 'add_to_cart', eventSource: 'browser' },
      { eventId: 'order:event-f', eventName: 'order_created', eventSource: 'server', timestamp: new Date('2026-02-01T03:00:00Z'), visitorId: null, sessionId: null, pageUrl: null, referrer: null, properties: { orderId: 'f' }, schemaVersion: 1 }
    ]);
    const pages = await request(app).get('/api/analytics/pages').query({ from, to }).expect(200);
    const events = await request(app).get('/api/analytics/events').query({ from, to }).expect(200);
    const series = await request(app).get('/api/analytics/timeseries').query({ from, to, interval: 'day' }).expect(200);
    expect(pages.body.data.pages).toEqual([{ pagePath: '/menu', pageViews: 2 }]);
    expect(events.body.data.events.reduce((sum, row) => sum + row.count, 0)).toBe(4);
    expect(series.body.data.points).toEqual([{ timestamp: from, totalEvents: 4, pageViews: 2, uniqueVisitors: 3 }]);
    const empty = await request(app).get('/api/analytics/timeseries').query({ from, to: '2026-02-02T00:00:00Z' }).expect(200);
    expect(empty.body.data.points).toHaveLength(1);
  });

  it('rejects invalid date range and excessive limits', async () => {
    await request(app).get('/api/analytics/summary').query({ from: 'yesterday', to }).expect(400);
    await request(app).get('/api/analytics/pages').query({ from, to, limit: 1000 }).expect(400);
  });

  it('returns bounded recent event fields within the UTC date range', async () => {
    await AnalyticsEvent.create([
      { ...pageEvent('recent-in', 'visitor-a', '2026-02-01T12:00:00.000Z'), eventSource: 'browser' },
      { ...pageEvent('recent-out', 'visitor-b', to), eventSource: 'browser' }
    ]);
    const response = await request(app).get('/api/analytics/recent').query({ from, to }).expect(200);
    expect(response.body.data.events).toEqual([{
      timestamp: '2026-02-01T12:00:00.000Z', eventName: 'page_view', eventSource: 'browser',
      visitorId: 'visitor-a', pageUrl: 'https://restaurant.test/menu'
    }]);
    await request(app).get('/api/analytics/recent').query({ from, to, limit: 101 }).expect(400);
  });
});
