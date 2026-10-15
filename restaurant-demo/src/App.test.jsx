import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const analyticsMocks = vi.hoisted(() => {
  const track = vi.fn();
  const trackPageView = vi.fn();
  return { track, trackPageView, init: vi.fn(() => ({ track, trackPageView, flush: vi.fn() })) };
});

vi.mock('@analytics-platform/browser-sdk', () => ({
  init: analyticsMocks.init
}));

import { RestaurantApp } from './App.jsx';

function renderApp(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><RestaurantApp /></MemoryRouter>);
}

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

async function addPizzaAndOpenCart(user) {
  await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: /menu/i }));
  await user.click(screen.getByRole('button', { name: /add margherita to bag/i }));
  await user.click(screen.getByRole('link', { name: /your bag/i }));
}

beforeEach(() => {
  analyticsMocks.init.mockReturnValue({
    track: analyticsMocks.track,
    trackPageView: analyticsMocks.trackPageView
  });
  analyticsMocks.track.mockClear();
  analyticsMocks.trackPageView.mockClear();
  globalThis.fetch = vi.fn();
  globalThis.crypto.randomUUID = vi.fn(() => 'checkout-key-1234');
});

afterEach(() => {
  cleanup();
  delete globalThis.fetch;
  vi.restoreAllMocks();
});

describe('restaurant demo', () => {
  it('renders the home page and tracks router page views once per route', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(screen.getByRole('heading', { name: /a little joy/i })).toBeInTheDocument();
    await waitFor(() => expect(analyticsMocks.trackPageView).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('link', { name: /explore the menu/i }));
    await waitFor(() => expect(analyticsMocks.trackPageView).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('heading', { name: /a menu made/i })).toBeInTheDocument();
  });

  it('tracks menu clicks and add-to-cart with item identifiers and quantity', async () => {
    const user = userEvent.setup();
    renderApp('/menu');
    await user.click(screen.getByRole('button', { name: /add margherita to bag/i }));
    expect(analyticsMocks.track).toHaveBeenCalledWith('menu_item_clicked', { menuItemId: 'margherita' });
    expect(analyticsMocks.track).toHaveBeenCalledWith('add_to_cart', { menuItemId: 'margherita', quantity: 1 });
    expect(screen.getByText('1', { selector: '.cart-count' })).toBeInTheDocument();
  });

  it('posts only item IDs and quantities, then displays the server-confirmed total', async () => {
    const user = userEvent.setup();
    globalThis.fetch.mockResolvedValue(jsonResponse(201, { data: {
      orderId: 'server-order-77', status: 'created', currency: 'USD', totalMinor: 1299,
      subtotalMinor: 1299, items: [{ menuItemId: 'margherita', quantity: 1, unitPriceMinor: 1299 }]
    } }));
    renderApp();
    await addPizzaAndOpenCart(user);
    expect(screen.getByText(/estimated total/i)).toBeInTheDocument();
    expect(screen.getByText('$12.99', { selector: '.total-row strong' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /place order/i }));

    await waitFor(() => expect(screen.getByRole('heading', { name: /your good things/i })).toBeInTheDocument());
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/orders');
    expect(options.headers['Idempotency-Key']).toBe('checkout-key-1234');
    expect(JSON.parse(options.body)).toEqual({
      items: [{ menuItemId: 'margherita', quantity: 1 }], visitorId: null, sessionId: null
    });
    expect(options.body).not.toContain('unitPriceMinor');
    expect(screen.getByText('Server-confirmed total')).toBeInTheDocument();
    expect(screen.getByText('$12.99', { selector: '.verified-total strong' })).toBeInTheDocument();
    expect(screen.getByText(/server-order-77/i)).toBeInTheDocument();
    expect(analyticsMocks.track).toHaveBeenCalledWith('checkout_started', { itemCount: 1 });
    expect(analyticsMocks.track).not.toHaveBeenCalledWith('order_created', expect.anything());
    await waitFor(() => expect(analyticsMocks.trackPageView).toHaveBeenCalledTimes(4));
  });

  it('shows checkout errors and reuses its idempotency key when retrying the same cart', async () => {
    const user = userEvent.setup();
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse(503, { error: { message: 'Please try again shortly.' } }))
      .mockResolvedValueOnce(jsonResponse(201, { data: {
        orderId: 'retry-order-8', status: 'created', currency: 'USD', totalMinor: 1299,
        subtotalMinor: 1299, items: []
      } }));
    renderApp();
    await addPizzaAndOpenCart(user);
    await user.click(screen.getByRole('button', { name: /place order/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please try again shortly.');
    await user.click(screen.getByRole('button', { name: /place order/i }));
    await waitFor(() => expect(screen.getByText(/retry-order-8/i)).toBeInTheDocument());
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch.mock.calls[0][1].headers['Idempotency-Key'])
      .toBe(globalThis.fetch.mock.calls[1][1].headers['Idempotency-Key']);
  });
});
