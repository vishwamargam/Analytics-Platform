# Analytics Platform: Technical Design

**Status:** Proposed; design only  
**Date:** 2026-10-15  
**Scope:** Small, single-deployment analytics platform for a restaurant demo

## 1. Goals and boundaries

The platform accepts browser-generated product events and trusted server-generated business events, stores both in MongoDB, and serves aggregate analytics to a React dashboard. A restaurant demo exercises the order flow. Keep the initial system understandable and deployable by one developer: one Express API, one MongoDB database, two small plain-JavaScript SDKs, and a Vite/React frontend.

The browser is an untrusted source. Browser events can describe page activity and user interactions; they cannot establish that an order was paid, set authoritative prices, or invoke privileged server behavior. The Express order endpoint calculates totals from server-owned menu data and writes order/business events itself.

Out of scope for the first version: user accounts, cross-device identity stitching, ad attribution, a general-purpose event query language, a queue/stream processor, real payment processing, and multi-tenant authorization. Configure one project/site using environment configuration. Add tenant isolation and authentication before exposing this as a hosted multi-customer service.

## 2. Architecture and data flow

```text
Browser
  ├─ Restaurant demo / dashboard (React + Vite)
  └─ Browser SDK ── POST /api/events (public, rate-limited)
                           │ validate, normalize, deduplicate
                           ▼
                    Express API ────────────── MongoDB
                      ▲   │                  ├─ events
                      │   │                  └─ orders
       server SDK ────┘   └─ analytics reads
                      ▲                    ▲
         Restaurant orders API       Dashboard API calls
         validates menu/order         aggregates in MongoDB
```

1. On page load, the browser SDK obtains a random anonymous visitor ID and a session ID, then sends a `page_view` through the public ingestion endpoint. It sends event name, URL/referrer, UTC timestamp, IDs, and optional bounded properties. The browser SDK batches where practical, but can send directly for this small implementation.
2. Express validates and bounds the payload, marks the source as `browser` itself (never trusts a caller-selected source), applies origin/rate checks, and inserts an event. A unique database index on the event identity supports idempotent retries.
3. The restaurant demo posts an order intent containing item identifiers and quantities. The API looks up the menu and computes authoritative line prices and totals. It persists an order and emits an `order_created` event from the server, using the server SDK or a shared event service. The browser does not receive or submit a server ingestion secret.
4. The dashboard calls analytics endpoints with an explicit UTC date range. Express validates the range and runs MongoDB aggregation pipelines over the event collection. It returns compact counts and bucketed series; the client renders them.

The API and dashboard can be served separately in development. In production, either serve the built dashboard from the same origin or configure a narrow allowed-origin list. MongoDB is the sole durable store; no queue or cache is required for assessment scale.

## 3. Event contract and source trust

Every stored event is normalized to this contract:

| Field | Type | Meaning / validation |
|---|---|---|
| `eventId` | string (UUID) | Idempotency key. Required from SDKs; server creates one when absent on trusted internal calls. |
| `eventName` | string | Required, bounded length, allow a conservative character set. Examples: `page_view`, `add_to_cart`, `order_created`. |
| `eventSource` | enum | `browser` or `server`. Set by the receiving route/service, never accepted as authoritative from browser input. |
| `timestamp` | Date | UTC instant. Browser may supply event occurrence time subject to an allowed skew window; server sets business-event time. Persist as BSON Date. |
| `visitorId` | string or null | Random anonymous browser identifier. For server events, optional and only copied from a validated order/session context when available. |
| `sessionId` | string or null | Random browser session identifier. Optional for server events. |
| `pageUrl` | string or null | Browser page URL, sanitized and length-bounded; server events may omit it. Strip fragments and avoid collecting query parameters by default. |
| `referrer` | string or null | Browser referrer, sanitized, length-bounded, and optionally reduced to origin/path. Server events may omit it. |
| `properties` | object | Optional event-specific, size- and depth-bounded JSON. Allow-list/validate known business fields. Do not accept arbitrary PII or sensitive payment data. |
| `schemaVersion` | integer | Required; starts at `1`. Enables compatible schema evolution. |

**Required for browser input:** `eventId`, `eventName`, `timestamp`, `visitorId`, `sessionId`, `pageUrl`, `schemaVersion`. `referrer` and `properties` are optional. `eventSource` is omitted by the SDK or ignored and assigned as `browser` by the API. Browser events should not carry trusted order totals or sensitive data.

**Required for server events:** `eventId`, `eventName`, `timestamp`, `schemaVersion`, and validated event-specific properties. The API assigns `eventSource: "server"`. `visitorId`, `sessionId`, `pageUrl`, and `referrer` are optional. Business events such as `order_created` must include an `orderId`; the event's order details and amount come from the persisted order/server calculation, not from browser event properties.

Unknown top-level fields are discarded or rejected consistently. Enforce a request-body limit (for example, 16 KB), property depth/key limits, and a maximum property count. Store timestamps as UTC instants; API date parameters use **inclusive `from` and exclusive `to`** (`from <= timestamp < to`), both ISO 8601 UTC timestamps. This avoids overlap when adjoining ranges.

## 4. Identity and privacy

- **Visitor ID:** Generate a cryptographically random UUID in the browser, persist in `localStorage` under a versioned key, and reuse across visits on that browser. It identifies a browser installation, not a person. If storage is unavailable, use an in-memory ID for the page lifetime. Do not use fingerprinting.
- **Session ID:** Generate a cryptographically random UUID in `sessionStorage`; a new tab/session gets a new ID. For more conventional inactivity sessions, rotate after 30 minutes without activity and refresh the activity time. The initial implementation may use tab lifetime as its simpler, documented rule.
- **Unique visitors:** Count distinct `visitorId` values among eligible browser events within the requested time range. A visitor active on multiple days contributes once to the range total; a daily series counts distinct IDs independently per UTC day. IDs can be cleared or partitioned by browser, so this is an approximate browser-level metric, not a people count.
- **Personal data:** No name, email, IP address, precise location, fingerprint, or raw payment details in analytics events. Avoid query strings in stored page URLs. Do not log complete event bodies. Add retention/deletion controls before production use with real users; configure consent behavior to match the applicable jurisdiction and deployment.

## 5. MongoDB collections and indexes

### `events`

Mongoose `Event` document mirrors the normalized event contract. Use `strict: "throw"` or explicit normalization, `timestamps: false` (event time is the business field), and validation for enum/length/version. `properties` is a bounded `Mixed`/`Map` subdocument after application validation; avoid indexing arbitrary property keys.

Indexes:

- `{ eventId: 1 }` unique: idempotent insertion across retries and sources. If IDs are scoped per project in a later multi-tenant version, use `{ projectId: 1, eventId: 1 }` unique.
- `{ timestamp: 1, eventName: 1 }`: date-bounded event counts and series.
- `{ timestamp: 1, eventSource: 1 }`: source/date filtering and operational inspection.
- `{ timestamp: 1, visitorId: 1 }`: distinct visitor aggregation.
- `{ timestamp: 1, pageUrl: 1 }`: popular pages aggregation.

Indexes should be checked against actual explain plans and workload; compound-index order can be adjusted as query patterns settle. Consider TTL retention only after a retention period is chosen and product/legal needs are known; TTL deletion is asynchronous and must not be represented as an exact deletion deadline.

### `orders`

Suggested document:

```js
{
  orderId: String,              // UUID, unique
  status: "created",           // later: paid/cancelled if implemented
  items: [{ menuItemId: String, name: String, quantity: Number,
            unitPriceMinor: Number, lineTotalMinor: Number }],
  currency: "USD",             // configured; all amounts are integer minor units
  subtotalMinor: Number,
  totalMinor: Number,
  visitorId: String | null,    // optional anonymous attribution
  sessionId: String | null,
  createdAt: Date               // UTC server time
}
```

Use integer minor units to avoid floating point currency errors. Never accept `name`, price, subtotal, total, or status as authoritative from the browser; accept menu IDs and bounded positive quantities, then resolve and price server-side. Index `{ orderId: 1 }` unique and `{ createdAt: 1 }`; add `{ createdAt: 1, status: 1 }` if status analytics are introduced. For consistency between order and event writes, initially save the order then emit the event and log/report an event-write failure for reconciliation; preferably use a MongoDB transaction when deployment supports replica sets. The simple assessment setup may use standalone MongoDB, where multi-document transactions are unavailable. This limitation is explicit; avoid claiming atomicity.

## 6. HTTP API

All endpoints are under `/api`. JSON responses use a stable `{ data }` success envelope and `{ error: { code, message } }` failure envelope. Apply request IDs and structured logs without personal data.

| Method/path | Purpose | Inputs / behavior |
|---|---|---|
| `GET /api/health` | Liveness/readiness | Return service status and Mongo connectivity; use 200 only when ready if used as readiness check. Do not expose secrets or connection details. |
| `POST /api/events` | Browser ingestion | Accept one event or a small batch (choose one contract; initial design: one event per request). Force source to `browser`, validate, rate-limit, deduplicate, return 202 accepted or 200 duplicate. Public endpoint; no server secret. |
| `POST /api/orders` | Demo order creation | Accept menu item IDs and quantities plus optional anonymous IDs. Validate and calculate on server; persist order and emit server `order_created`; return order ID and safe receipt summary. |
| `GET /api/analytics/summary?from=...&to=...` | KPI totals | Return page views, unique visitors, and total event count for `[from,to)`. |
| `GET /api/analytics/pages?from=...&to=...&limit=...` | Popular pages | Return URL and page-view count, sorted descending, bounded limit. |
| `GET /api/analytics/events?from=...&to=...` | Event-name counts | Return counts grouped by event name. |
| `GET /api/analytics/recent?from=...&to=...&limit=...` | Recent dashboard activity | Return at most 100 newest rows with timestamp, event name/source, visitor ID and page URL only. This narrow read is needed for the dashboard activity table; protect it with the analytics endpoints before public multi-tenant deployment. |
| `GET /api/analytics/timeseries?from=...&to=...&interval=hour|day` | Trend data | Return UTC bucket start and counts (page views/events/unique visitors as practical). Validate interval and cap range/bucket count. |

Date-range rules: require valid ISO-8601 timestamps with explicit timezone, normalize to UTC, require `from < to`, and limit maximum range (e.g. 90 days initially). Daily buckets are UTC calendar days. Return empty buckets for requested periods where feasible, using a bounded bucket count. Analytics only include `eventName=page_view` for page-view and popular-page metrics. Unique visitors are distinct non-empty `visitorId` values among browser events across the whole requested range; daily series count distinct IDs within each UTC bucket. The recent endpoint is limited and excludes event properties and other payload fields.

The `order_created` event count is a business-event count, not proof of payment. Analytics endpoints are unauthenticated only for a local/demo deployment. A public deployment requires authentication/authorization and project scoping before release.

## 7. SDK APIs

### Browser SDK (plain JavaScript)

```js
Analytics.init({ endpoint, enabled, debug });
Analytics.trackPageView({ pageUrl?, referrer? });
Analytics.track(eventName, properties?);
Analytics.flush(); // optional if queue/batching is implemented
```

`init()` creates/reuses visitor and session IDs, installs a history/popstate page-view hook only if explicitly enabled, and sends the initial view once. `trackPageView()` captures sanitized URL/referrer and standard fields. `track()` creates UUID, UTC timestamp, schema version and attaches identity/context; it sends to the same-origin or configured HTTPS endpoint. The SDK must not offer server-only credentials or allow caller-controlled `eventSource`. `enabled: false` is a no-op for consent/off state. Keep dependencies at zero; use `fetch` and `crypto.randomUUID` with a safe fallback only when necessary.

**Do not implement `identify()` initially.** The platform deliberately avoids collecting direct identifiers and has no authenticated user model. If a future product requirement justifies account-level analytics, define consent, minimization, deletion, and access controls first; do not quietly add email or raw user IDs to event properties.

### Server SDK (plain JavaScript)

```js
const analytics = createAnalyticsClient({ endpoint, writeKey, timeoutMs });
await analytics.track("order_created", { orderId, totalMinor, currency });
```

The server SDK obtains `writeKey` only from server environment configuration and sends over HTTPS to a dedicated trusted ingestion route (for example `POST /api/internal/events`) authenticated by a server-only bearer key. Alternatively, because the restaurant endpoint and tracker live in the same API process, use an internal event service with the same schema and no HTTP hop; this is the preferred simplest first implementation. Server source is assigned by trusted code. Never expose `writeKey` in Vite variables (which are client-visible) or bundle it into the dashboard/demo.

## 8. Reliability, validation, and security

- **Duplicates:** Generate stable `eventId` once per event and reuse it for retries. Insert with a unique event ID; treat duplicate-key as successful duplicate acceptance. The browser SDK does not mint a new ID on retry. For order creation, support an `Idempotency-Key` or client-generated request ID with a unique order key to prevent duplicate orders on retries.
- **Validation:** Validate types, known schema version, event name, timestamps/skew, IDs, URL length/protocol, allowed property keys/types, and event-specific server payloads. Reject malformed payloads with 400; do not silently coerce financial values. Strip/reject unsupported fields. Set body and query limits.
- **Timeout/retry:** Browser requests use a short timeout (for example 3 seconds) and bounded retry with exponential backoff and jitter for network failures/429/5xx; use `sendBeacon` on page unload only as a best-effort fallback. Do not retry permanent 4xx responses. Server SDK uses abortable timeout (for example 2 seconds), bounded retries, and reports failures; business order persistence must not be undone by analytics transport failure. In-process event creation avoids that transport uncertainty.
- **Rate limiting:** Apply IP-based coarse limits to public ingestion and orders, plus payload-size limits. Because IP is operationally sensitive, do not persist it in events; proxy-aware rate limiting must trust only configured proxy hops. Return `429` with `Retry-After`.
- **CORS:** Allow only configured dashboard/demo origins, required methods/headers, and no credentialed wildcard CORS. Same-origin production deployment is simplest. Browser ingestion does not rely on CORS as authentication.
- **Secrets and transport:** Keep Mongo URI and internal write key server-side; use HTTPS outside local development. Redact secrets and event payloads from logs. Use Helmet/security headers, disable verbose stack traces in production, and validate `Host`/proxy configuration as appropriate.
- **Abuse/privacy:** Restrict allowed event names or apply conservative validation, prevent URL/property injection from reaching HTML, avoid logging request bodies, and document consent and retention. CORS is not an access-control mechanism. Do not expose unauthenticated analytics in a multi-tenant or sensitive deployment.

## 9. Dashboard metrics and behavior

The initial dashboard provides a selected UTC range and:

- **Page views:** Count `page_view` browser events.
- **Unique visitors:** Distinct non-null `visitorId` among page-view events in the whole selected range; daily chart values use distinct IDs per UTC day.
- **Popular pages:** Normalize browser page URLs to paths, group page views by path, sort by count descending, show top N.
- **Event counts:** Count by `eventName`, optionally distinguish browser and server source in a future enhancement.
- **Time series:** UTC hourly buckets for short ranges and daily buckets for longer ranges; show page views and total events, with visitor series if feasible.

Display the selected range and timezone (UTC), loading/empty/error states, and label unique visitors as browser IDs/estimated. Dashboard queries call aggregate endpoints, not direct MongoDB. Avoid claiming real-time guarantees; refresh on page load/manual interval. Keep date range presets simple (24 hours, 7 days, 30 days) and ensure query boundaries follow `[from,to)`.

## 10. Testing strategy

Use Vitest for SDK, validation, identity, date-range, and API/service unit tests. Use Supertest against an Express app instance (separate app construction from listener startup) for health, invalid/valid ingestion, source enforcement, duplicate handling, range validation, order price authority, and analytics responses. Use an isolated MongoDB test database or a test MongoDB memory server if appropriate; do not make tests depend on a developer's local production-like database. Test indexes/schema behavior where integration test setup permits. SDK tests mock `fetch`, storage, and clock/UUID as needed to check payload shape, no-op mode, and retry rules. Keep external calls absent and seed deterministic events for aggregation assertions.

Core cases: browser cannot mark an event trusted/server; duplicate `eventId` does not increase counts; malformed/future timestamps are rejected; order totals derive from server menu data; `[from,to)` excludes an event exactly at `to`; daily unique visitors deduplicate within a day; and empty periods return a usable response.

## 11. Suggested repository structure

```text
apps/
  dashboard/                 # Vite + React dashboard and restaurant demo
    src/
      dashboard/
      restaurant/
      api/
packages/
  browser-sdk/               # Plain JavaScript browser tracker
  server-sdk/                 # Plain JavaScript trusted server client
server/
  src/
    app.js                    # Express app, no listen side effect
    index.js                  # process startup
    config/
    models/                   # Event, Order
    routes/
    controllers/
    services/                 # ingestion, order, analytics
    middleware/
    validation/
docs/
  technical-design.md
  implementation-tasks.md
```

For a very small assessment, this can be a single npm workspace or one root package with folders. Keep module format consistent (ES modules recommended for Vite and Node with `type: module`). Do not create package abstractions that are not needed.

## 12. Environment, local setup, assumptions, tradeoffs

Expected server environment variables:

| Variable | Purpose |
|---|---|
| `NODE_ENV` | Runtime mode |
| `PORT` | Express listen port, default 3000 |
| `MONGODB_URI` | Server-only MongoDB connection string |
| `ALLOWED_ORIGINS` | Comma-separated explicit browser origins |
| `INTERNAL_INGESTION_KEY` | Optional server-to-server HTTP key; omit if server event uses in-process service |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | Public endpoint rate limit configuration |
| `ORDER_CURRENCY` | Currency code for server-owned menu prices |
| `EVENT_RETENTION_DAYS` | Optional retention policy, only after chosen |

Frontend environment variables use only public configuration, e.g. `VITE_API_BASE_URL`; never put secrets in `VITE_*`. A local setup should install dependencies, start MongoDB (local service or Docker), configure `.env` from a committed `.env.example`, run server and Vite dev server, then open the dashboard/demo. Add scripts for dev, build, and test when implementation starts.

Assumptions: one restaurant demo/menu, one configured analytics project, modest event volume, no user login, and analytics are for demonstration/assessment. Browser IDs are first-party local storage IDs and can be blocked/reset. Date boundaries and charts use UTC. Prices are represented as minor units. Deployment choice is not fixed.

Tradeoffs: MongoDB aggregation keeps the stack small but distinct visitors over large ranges can become expensive; pre-aggregation is deferred until measured. Direct ingestion is simpler but gives less offline resilience than a queue; bounded browser retry is enough at this scale. An in-process server event service avoids secrets and network overhead but order/event atomicity needs a transaction or reconciliation. Public demo analytics are intentionally unauthenticated only in a single-project demo and must be secured before broader hosting.

## 13. Limitations and production follow-up

The platform provides approximate browser-level counts, not person-level attribution. Ad blockers, consent choices, storage deletion, offline use, and browser restrictions reduce event coverage. Event ingestion is best effort. Order creation is not payment processing. A single shared project configuration is not tenant isolation. Before production use with real customers, add authentication/authorization and tenant-scoped keys, consent and retention/deletion workflows, deployment monitoring/alerts, backup/restore, and a transaction or durable outbox for order-event consistency. Measure aggregation performance before raising event volume or range limits.
