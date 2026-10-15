const configuredBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
export const API_BASE_URL = configuredBase.replace(/\/+$/, '');

export async function submitOrder({ items, idempotencyKey, visitorId = null, sessionId = null }) {
  const response = await fetch(`${API_BASE_URL}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({ items, visitorId, sessionId })
  });

  let body;
  try { body = await response.json(); } catch { throw new Error('The server returned an unreadable response. Please try again.'); }
  if (!response.ok) throw new Error(body?.error?.message || 'We could not place your order. Please try again.');
  if (!body?.data?.orderId || !Number.isInteger(body?.data?.totalMinor)) {
    throw new Error('The server response did not include a verified order total. Please contact the restaurant.');
  }
  return body.data;
}
