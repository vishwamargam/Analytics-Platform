# Browser Analytics SDK

Plain JavaScript SDK for browser applications. It has no React dependency and sends one JSON event per request to the backend's `POST /api/events` endpoint.

## Install and import

In this monorepo, the package is a workspace:

```sh
npm install
```

```js
import { init, track, trackPageView, flush, destroy } from '@analytics-platform/browser-sdk';

init({
  endpoint: 'http://localhost:3000/api/events',
  autoTrackPageViews: true
});

track('add_to_cart', { menuItemId: 'margherita', quantity: 1 });
track('checkout_started');

// Call after your SPA router has changed the browser URL:
trackPageView();
```

`autoTrackPageViews` sends the initial page view. The SDK does not monkey-patch history or subscribe to router internals; the host calls `trackPageView()` after a route change. Repeated calls for the same sanitized URL are ignored. The SDK also exposes `flush()` and `destroy()` for lifecycle management. Calls to `track()` enqueue and send in the background; they return the generated `eventId` and do not wait for the network.

## Identity and event fields

The SDK stores a random visitor ID in `localStorage` and a tab/session ID in `sessionStorage`. If either storage API is unavailable it creates an in-memory ID for that SDK instance. It emits `eventId`, `eventName`, `eventSource: "browser"`, UTC `timestamp`, `visitorId`, `sessionId`, sanitized `pageUrl` and `referrer`, scalar `properties`, and `schemaVersion: 1`. URL query strings and fragments are removed to avoid retaining potentially sensitive values.

Events are sent individually because the backend currently defines only single-event ingestion. The SDK validates property keys, values, counts and sizes before sending. It retries network errors, timeouts, 429s, and server errors at most twice with the same event ID; permanent 4xx responses are not retried. `pagehide` triggers a best-effort JSON `fetch` with `keepalive`. `sendBeacon` is not used: the API requires `application/json`, beacon delivery has no inspectable response, and cross-origin content-type/CORS behavior would make it a less reliable fit. Closing a page can still interrupt delivery.

## Backend compatibility notes

The backend permits browser event names `page_view`, `menu_item_clicked`, `add_to_cart`, and `checkout_started`. The generic SDK accepts other syntactically valid custom names too, but the backend rejects names outside its allowlist with HTTP 400; the SDK intentionally does not retry those responses. Add each supported name to the backend allowlist before relying on it.

The `writeKey` option is present in the `init()` signature for forward compatibility, but this backend has no public write-key validation. Passing a non-empty `writeKey` throws an explanatory error, and no key is ever sent. Never pass a server credential to browser code.
