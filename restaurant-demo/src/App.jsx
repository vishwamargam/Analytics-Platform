import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { analytics } from './analytics.js';
import { submitOrder } from './api.js';
import { formatPrice, MENU_ITEMS } from './menu.js';

function Navigation({ itemCount }) {
  return (
    <header className="site-header">
      <Link className="brand" to="/" aria-label="Little Olive home">
        <span className="brand-mark">lo</span>
        <span>little olive<span className="brand-period">.</span></span>
      </Link>
      <nav aria-label="Main navigation">
        <NavLink to="/menu">Menu</NavLink>
        <NavLink className="cart-link" to="/cart">Your bag <span className="cart-count">{itemCount}</span></NavLink>
      </nav>
    </header>
  );
}

function Layout({ itemCount, children }) {
  return (
    <div className="app-shell">
      <Navigation itemCount={itemCount} />
      {children}
      <footer className="site-footer">
        <span>Little Olive Neighborhood Kitchen</span>
        <span>Made slowly, shared gladly.</span>
      </footer>
    </div>
  );
}

function HomePage() {
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> YOUR NEIGHBORHOOD KITCHEN</span>
          <h1>A little joy,<br /><em>oven fresh.</em></h1>
          <p>Good food brings us together. We make thoughtful, wood-fired favorites with seasonal ingredients and plenty of heart.</p>
          <Link className="button button-dark" to="/menu">Explore the menu <span aria-hidden="true">↗</span></Link>
          <div className="hero-note"><span className="note-line" /> Fresh from our oven, every day</div>
        </div>
        <div className="hero-art" aria-label="Illustration of a fresh pizza" role="img">
          <div className="sun-shape" />
          <div className="pizza-plate"><div className="pizza"><span>✳</span><span>●</span><span>✳</span><span>●</span><span>✳</span><span>●</span></div></div>
          <div className="art-caption">A slice of<br />something good.</div>
          <span className="art-sparkle sparkle-one">✳</span><span className="art-sparkle sparkle-two">✳</span>
        </div>
      </section>
      <section className="home-details">
        <div><span className="eyebrow">THE LITTLE OLIVE WAY</span><h2>Simple things,<br /><em>done beautifully.</em></h2></div>
        <p>Hand-stretched dough, tomatoes picked at their peak, and a table with room for one more. That’s how we like to do dinner.</p>
        <Link className="text-link" to="/menu">Find your favorite <span aria-hidden="true">→</span></Link>
      </section>
    </main>
  );
}

function MenuPage({ addItem }) {
  return (
    <main className="content-page">
      <div className="page-heading">
        <span className="eyebrow">FRESH FROM OUR KITCHEN</span>
        <h1>A menu made<br /><em>for sharing.</em></h1>
        <p>Seasonal ingredients, a very hot oven, and a few things we think you’ll love.</p>
      </div>
      <section className="menu-grid" aria-label="Restaurant menu">
        {MENU_ITEMS.map((item, index) => (
          <article className={`menu-card menu-card-${index + 1}`} key={item.id}>
            <div className="menu-art" aria-hidden="true"><span>{item.emoji}</span><small>{item.category}</small></div>
            <div className="menu-card-body">
              <div className="menu-title-row"><h2>{item.name}</h2><span>{formatPrice(item.priceMinor)}</span></div>
              <p>{item.description}</p>
              <button className="button button-outline" onClick={() => addItem(item)}>
                Add {item.name} to bag <span aria-hidden="true">+</span>
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

function CartPage({ cart, setQuantity, onOrderComplete }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const idempotencyRef = useRef({ signature: '', key: '' });
  const lines = useMemo(() => MENU_ITEMS
    .filter((item) => cart[item.id] > 0)
    .map((item) => ({ ...item, quantity: cart[item.id], lineTotal: item.priceMinor * cart[item.id] })), [cart]);
  const estimateMinor = lines.reduce((total, item) => total + item.lineTotal, 0);
  const signature = JSON.stringify(lines.map(({ id, quantity }) => [id, quantity]));

  async function placeOrder() {
    if (!lines.length || loading) return;
    setLoading(true);
    setError('');
    analytics.track('checkout_started', { itemCount: lines.reduce((sum, item) => sum + item.quantity, 0) });
    if (!idempotencyRef.current.key || idempotencyRef.current.signature !== signature) {
      idempotencyRef.current = { signature, key: globalThis.crypto.randomUUID() };
    }
    try {
      const order = await submitOrder({
        items: lines.map(({ id, quantity }) => ({ menuItemId: id, quantity })),
        idempotencyKey: idempotencyRef.current.key
      });
      onOrderComplete(order);
    } catch (checkoutError) {
      setError(checkoutError.message || 'We could not place your order. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (!lines.length) {
    return (
      <main className="content-page narrow-page">
        <div className="empty-state"><span className="empty-icon">✳</span><span className="eyebrow">YOUR BAG</span>
          <h1>A little room<br /><em>for something good.</em></h1><p>Your bag is waiting for its first favorite.</p>
          <Link className="button button-dark" to="/menu">Browse the menu <span aria-hidden="true">↗</span></Link>
        </div>
      </main>
    );
  }

  return (
    <main className="content-page narrow-page">
      <div className="page-heading cart-heading"><span className="eyebrow">ALMOST A LITTLE FEAST</span><h1>Your <em>bag.</em></h1>
        <Link className="text-link" to="/menu">Add something else <span aria-hidden="true">→</span></Link>
      </div>
      <section className="cart-list" aria-label="Items in your bag">
        {lines.map((item) => (
          <article className="cart-line" key={item.id}>
            <div className="cart-item-emoji" aria-hidden="true">{item.emoji}</div>
            <div className="cart-item-description"><h2>{item.name}</h2><p>{formatPrice(item.priceMinor)} each</p></div>
            <div className="quantity-control" aria-label={`${item.name} quantity`}>
              <button aria-label={`Remove one ${item.name}`} onClick={() => setQuantity(item.id, item.quantity - 1)}>−</button>
              <span>{item.quantity}</span>
              <button aria-label={`Add one ${item.name}`} onClick={() => setQuantity(item.id, item.quantity + 1)}>+</button>
            </div>
            <strong className="line-total">{formatPrice(item.lineTotal)}</strong>
          </article>
        ))}
      </section>
      <section className="checkout-panel">
        <div className="total-row"><span>Estimated total</span><strong>{formatPrice(estimateMinor)}</strong></div>
        <p className="estimate-note">Your final total is calculated and confirmed by our server when you place the order.</p>
        {error && <p className="checkout-error" role="alert">{error}</p>}
        <button className="button button-dark checkout-button" onClick={placeOrder} disabled={loading}>
          {loading ? <><span className="spinner" aria-hidden="true" /> Placing your order…</> : <>Place order <span aria-hidden="true">↗</span></>}
        </button>
        <p className="checkout-footnote">No payment details needed for this demo.</p>
      </section>
    </main>
  );
}

function ConfirmationPage() {
  const location = useLocation();
  const order = location.state?.order;
  return (
    <main className="content-page narrow-page confirmation-page">
      <div className="confirmation-mark" aria-hidden="true">✓</div>
      <span className="eyebrow">THAT’S A WRAP</span>
      <h1>Your good things<br /><em>are on their way.</em></h1>
      <p className="confirmation-copy">Thanks for bringing a little olive to your table. Your order is confirmed.</p>
      {order && <section className="verified-total" aria-label="Server-confirmed order total">
        <span>Server-confirmed total</span><strong>{formatPrice(order.totalMinor, order.currency)}</strong>
        <small>Order {order.orderId}</small>
      </section>}
      <Link className="button button-dark" to="/menu">Back to the menu <span aria-hidden="true">↗</span></Link>
    </main>
  );
}

export function RestaurantApp() {
  const [cart, setCart] = useState({});
  const location = useLocation();
  const navigate = useNavigate();
  const itemCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);

  useEffect(() => {
    analytics.trackPageView();
  }, [location.pathname]);

  function addItem(item) {
    analytics.track('menu_item_clicked', { menuItemId: item.id });
    analytics.track('add_to_cart', { menuItemId: item.id, quantity: 1 });
    setCart((current) => ({ ...current, [item.id]: (current[item.id] || 0) + 1 }));
    // navigate to the cart page after adding an item
    navigate('/cart');
  }

  function setQuantity(id, quantity) {
    const currentQuantity = cart[id] || 0;
    const nextQuantity = Math.min(quantity, 50);
    if (nextQuantity > currentQuantity) {
      analytics.track('add_to_cart', { menuItemId: id, quantity: nextQuantity - currentQuantity });
    }
    setCart((current) => {
      const next = { ...current };
      if (nextQuantity <= 0) delete next[id];
      else next[id] = nextQuantity;
      return next;
    });
  }

  function orderComplete(order) {
    setCart({});
    navigate('/confirmation', { state: { order } });
  }

  return (
    <Layout itemCount={itemCount}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/menu" element={<MenuPage addItem={addItem} />} />
        <Route path="/cart" element={<CartPage cart={cart} setQuantity={setQuantity} onOrderComplete={orderComplete} />} />
        <Route path="/confirmation" element={<ConfirmationPage />} />
        <Route path="*" element={<main className="content-page narrow-page empty-state"><h1>We can’t find that page.</h1><Link className="text-link" to="/">Head home →</Link></main>} />
      </Routes>
    </Layout>
  );
}
