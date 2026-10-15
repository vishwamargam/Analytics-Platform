# Analytics dashboard

React + Vite dashboard for the analytics platform. It reads the actual Express APIs for summary, UTC time series, popular pages and event counts, plus the bounded `/api/analytics/recent` endpoint for the recent-event table. No analytics values are generated in the frontend.

## Local setup

From the repository root, install packages, start MongoDB and the API (`npm run dev`), then start the dashboard:

```powershell
Copy-Item dashboard/.env.example dashboard/.env.local
npm run dev:dashboard
```

The dashboard opens at `http://localhost:5174`. Set `VITE_API_BASE_URL` in `dashboard/.env.local` when the API is not at `http://localhost:3000`. This is a public URL setting; never put ingestion keys, MongoDB URIs or server SDK credentials in a `VITE_*` variable. The backend must allow the dashboard origin in `ALLOWED_ORIGINS`.

## Date ranges and metrics

Date pickers represent UTC calendar dates. Both selected dates are inclusive in the UI; requests translate them to `from` at UTC midnight and `to` at midnight after the end date. The API filters `[from, to)`, with a maximum range of 90 days. Unique visitors are the backend's distinct browser `visitorId` count across the full selected range. Popular pages are normalized and grouped by path by MongoDB. Orders count trusted `order_created` events grouped by the backend.

`GET /api/analytics/recent?from=...&to=...&limit=50` is a narrow addition for the requested table. It returns at most 100 events and only timestamp, event name/source, visitor ID and page URL. As with the existing demo analytics endpoints, protect analytics reads with authentication and tenant scoping before public multi-customer deployment.

## Checks

```powershell
npm test
npm run build:dashboard
```
