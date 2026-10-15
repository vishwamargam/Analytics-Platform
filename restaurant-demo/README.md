# Little Olive Restaurant Demo

React, Vite, React Router, and the shared browser analytics SDK. The demo has home, menu, bag/checkout, and order confirmation routes. It does not collect contact or payment details.

## Run locally

From the repository root, install the workspace dependencies and start MongoDB plus the API:

```sh
npm install
npm run dev
```

In a second terminal:

```sh
npm run dev:restaurant
```

Open `http://localhost:5173`. The backend allows that origin by default and listens on `http://localhost:3000`. To point the UI at another backend, copy this folder's `.env.example` to `.env.local` and set `VITE_API_BASE_URL`. Never put server credentials in this Vite environment file.

The bag displays an estimate based on the demo catalog. Checkout submits only `menuItemId` and `quantity` to `POST /api/orders`; the backend prices and stores the order. The confirmation page displays the server-returned total. A stable idempotency key is reused if the user retries the same cart after an error.

## Verify tracking

The app initializes the browser SDK once with auto page tracking disabled, then notifies it on each React Router path change. Menu actions emit `menu_item_clicked` and `add_to_cart`; checkout emits `checkout_started`. The trusted backend emits `order_created` after order persistence. The browser never sends that business event.

After navigating the app and placing an order, inspect the local MongoDB collection:

```javascript
use analytics_platform
db.analyticsevents.find({
  eventName: { $in: ['page_view', 'menu_item_clicked', 'add_to_cart', 'checkout_started', 'order_created'] }
}).sort({ timestamp: -1 }).limit(30)
```

Test the interaction and checkout flows with `npm test --workspace restaurant-demo`. Build the app with `npm run build:restaurant`.
