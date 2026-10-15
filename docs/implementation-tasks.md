# Implementation Tasks and Acceptance Criteria

This is the proposed build sequence. No application implementation is included in this design deliverable.

## 1. Repository and configuration foundation

- [ ] Create the selected workspace layout and package scripts for server, dashboard, and tests.
- [ ] Add `.env.example`, environment parsing/validation, `.gitignore`, and local setup instructions.

**Acceptance criteria:** A clean checkout can install dependencies and start the API and Vite app with documented local settings; secrets are excluded from browser configuration and version control; invalid required environment configuration fails with a clear message.

## 2. Express app, Mongo connection, and health endpoint

- [ ] Build an importable Express app separately from process startup.
- [ ] Add Mongo connection lifecycle, centralized errors, JSON/body limits, security headers, CORS allow-list, and `GET /api/health`.

**Acceptance criteria:** Health reports readiness only when Mongo is reachable; app tests can instantiate Express without opening a listener; CORS accepts configured origins and rejects unconfigured browser origins; error responses do not leak stack traces or secrets.

## 3. Event model, validation, and ingestion

- [ ] Add Mongoose Event schema and indexes from the design.
- [ ] Implement normalization/validation and public `POST /api/events` with forced browser source and idempotent inserts.
- [ ] Add public ingestion rate limiting and bounded timestamp skew/payload/property rules.

**Acceptance criteria:** Valid browser contract stores UTC BSON timestamps and `eventSource: browser`; caller-supplied `eventSource: server` cannot persist as trusted; invalid/oversized payloads receive 4xx; duplicate `eventId` returns duplicate success and creates one document; event indexes are created by the model/database setup.

## 4. Browser SDK

- [ ] Implement `init()`, stable anonymous visitor ID, session ID, `trackPageView()`, `track()`, no-op consent/disabled mode, and bounded request behavior.
- [ ] Add SDK unit tests with mocked fetch/storage/clock.

**Acceptance criteria:** Emitted events match schema version 1, use UTC timestamps and UUID event IDs, persist/reuse visitor ID, scope session ID as documented, sanitize page context, never send a secret or trusted source, and retry transient errors without minting a new event ID.

## 5. Order API and server business event

- [ ] Define server-owned demo menu and Mongoose Order schema/indexes.
- [ ] Implement `POST /api/orders` with validation, authoritative price calculation, order idempotency, and in-process `order_created` event creation.
- [ ] Add a plain-JavaScript server SDK abstraction if separate use is needed; otherwise expose a small server event service matching its API.

**Acceptance criteria:** Client-provided prices/totals/status are ignored or rejected; total is recomputed from configured menu prices using integer minor units; duplicate order requests with the same idempotency key do not create multiple orders/events; trusted events receive `eventSource: server`; no server key enters Vite output; event-write failure is observable and follows the documented consistency behavior.

## 6. Analytics query service and routes

- [ ] Implement UTC range parsing and maximum range/bucket constraints.
- [ ] Add summary, popular pages, event counts, and time-series aggregation endpoints with `[from,to)` semantics.

**Acceptance criteria:** Invalid or reversed ranges return 400; exact `to` boundary is excluded; page views only count `page_view`; unique visitors are distinct browser visitor IDs for the selected range; daily series use UTC buckets; limits are enforced and output shape is documented/stable.

## 7. React dashboard

- [ ] Build a Vite React dashboard with range presets, KPI cards, popular pages, event counts, and time-series display.
- [ ] Add loading, empty, and error states, plus clear UTC and approximate visitor labels.

**Acceptance criteria:** Dashboard reads only through API endpoints; selected dates are encoded consistently as UTC; metrics reconcile with seeded API data; empty datasets render without errors; no database or secret access exists in browser code.

## 8. Restaurant demo

- [ ] Build a small restaurant menu/cart/checkout flow that posts menu item IDs and quantities.
- [ ] Initialize browser tracking and track relevant UI events without sending sensitive data.

**Acceptance criteria:** Demo creates an order through the API and shows server-calculated receipt totals; changing browser payload prices cannot alter stored totals; browser interaction events are distinguishable from server `order_created`; no payment details or unnecessary personal data are collected.

## 9. Automated tests and verification

- [ ] Add Vitest unit tests and Supertest API/integration tests using an isolated database.
- [ ] Cover validation, source trust boundary, idempotency, order price integrity, UTC range semantics, and analytics aggregations.

**Acceptance criteria:** Test suite runs from documented scripts without a developer's existing database; deterministic fixtures make results repeatable; all critical cases listed in the technical design have coverage; build and tests pass in a clean environment.

## 10. Documentation and release readiness

- [ ] Document event contract, endpoint examples, SDK usage, environment setup, and known limitations.
- [ ] Add production deployment checklist for HTTPS, origin configuration, DB backup, retention, and access control.

**Acceptance criteria:** A new developer can run the project from the docs; examples do not include real secrets; documentation clearly states demo-only unauthenticated analytics, best-effort browser delivery, approximate visitor counts, and the order/event consistency model.
