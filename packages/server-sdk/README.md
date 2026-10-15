# Node.js Analytics SDK

Reusable Node.js helper for trusted server business events. It is plain JavaScript, independent of Express, and uses Node's built-in `fetch` and crypto APIs (Node.js 20+).

## Install and use

The SDK is a workspace package in this repository:

```sh
npm install
```

```js
import { createAnalyticsClient } from '@analytics-platform/server-sdk';

const analytics = createAnalyticsClient({
  endpoint: process.env.ANALYTICS_INGESTION_ENDPOINT,
  writeKey: process.env.INTERNAL_INGESTION_KEY,
  timeoutMs: 2000,
  onError: (failure) => {
    // Structured metadata only. Never log the write key or event payload.
    console.error(JSON.stringify({ level: 'error', message: 'analytics delivery failed', ...failure }));
  }
});

const result = await analytics.track('order_created', {
  orderId: 'order-123',
  itemCount: 2,
  totalAmount: 25.98, // major currency units; include currency in properties
  currency: 'USD'
});

if (!result.ok) {
  // Delivery did not complete after the bounded retries; decide whether to alert or reconcile.
}
await analytics.close(); // no-op today; provided for lifecycle compatibility
```

`track()` returns a result object: `{ ok, eventId, eventName, status, attempts }` on success, or `{ ok: false, ..., error: { code, message } }` on failure. Invalid local event data throws `TypeError`; transport failures resolve to a failed result and invoke `onError` when configured. The callback is isolated so callback errors cannot affect order handling.

## Contract and security

Events use the backend's schema version 1: `eventId`, `eventName`, `eventSource: "server"`, UTC `timestamp`, optional `visitorId`/`sessionId`, null `pageUrl`/`referrer`, scalar `properties`, and `schemaVersion`. Server event names currently supported by the backend are `order_created`, `add_to_cart`, and `checkout_started`. `order_created` requires `orderId`, positive integer `itemCount`, and numeric non-negative `totalAmount`. Properties are bounded and reject common personal/sensitive fields.

HTTP delivery sends `Authorization: Bearer <writeKey>` only to the configured endpoint, never in the JSON body or logs. The backend validates this server-only key on `POST /api/events`; browser requests continue to use the public unauthenticated browser path. Use HTTPS for non-loopback endpoints. Do not place `INTERNAL_INGESTION_KEY` in browser code or `VITE_*` variables.

The client generates an event ID and timestamp once per `track()` call, serializes the payload once, and reuses the identical body across attempts. `context` may provide an existing `eventId` and timestamp; the restaurant order integration uses `order:<orderId>` and the persisted `createdAt`, so retries and idempotent order replays refer to the same business event. Configure `maxRetries` from 0 to 5 (default 2) and `timeoutMs` up to 60 seconds (default 2 seconds). Network errors, timeouts, HTTP 408/429, and 5xx responses are retried; validation 4xx responses and malformed success responses are not.

## Delivery guarantees and integration

The restaurant API writes the order first, then calls this helper using an in-process MongoDB transport. The event insert is deduplicated by the unique event ID index, and delivery failures are reported as structured logs without making a successful order appear to fail. This is **best effort**, not atomic: a process/database failure can occur between the order write and event write. The same idempotent order request attempts the event again, but an order never retried after a failed event write may remain without its analytics event. A transactional outbox is needed for guaranteed eventual delivery.

For standalone HTTP use, point `endpoint` to the trusted ingestion endpoint and provide the server-only write key. `close()` is currently a no-op because the client owns no persistent connection pool or background worker.
