import { createHash } from 'node:crypto';
import { MENU } from '../constants/menu.js';
import { HttpError } from '../utils/httpError.js';

export function validateOrderRequest(body, idempotencyKey) {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key header must contain 8 to 128 characters');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'INVALID_ORDER', 'request body must be a JSON object');
  const allowed = new Set(['items', 'visitorId', 'sessionId']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new HttpError(400, 'INVALID_ORDER', 'order contains unsupported fields');
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
    throw new HttpError(400, 'INVALID_ORDER', 'items must contain between 1 and 20 entries');
  }
  const items = body.items.map((item) => {
    if (!item || typeof item !== 'object' || Object.keys(item).some((key) => !['menuItemId', 'quantity'].includes(key))) {
      throw new HttpError(400, 'INVALID_ORDER', 'each item must contain only menuItemId and quantity');
    }
    const menuItem = MENU[item.menuItemId];
    if (!menuItem) throw new HttpError(400, 'INVALID_ORDER', 'unknown menu item');
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50) {
      throw new HttpError(400, 'INVALID_ORDER', 'quantity must be an integer from 1 to 50');
    }
    return {
      menuItemId: item.menuItemId,
      name: menuItem.name,
      quantity: item.quantity,
      unitPriceMinor: menuItem.unitPriceMinor,
      lineTotalMinor: menuItem.unitPriceMinor * item.quantity
    };
  });
  const visitorId = body.visitorId ?? null;
  const sessionId = body.sessionId ?? null;
  for (const [field, value] of [['visitorId', visitorId], ['sessionId', sessionId]]) {
    if (value !== null && (typeof value !== 'string' || value.length > 100)) throw new HttpError(400, 'INVALID_ORDER', `${field} must be a string of at most 100 characters`);
  }
  // Hash only the semantic client request, not the calculated menu values.
  const requestHash = createHash('sha256').update(JSON.stringify({
    items: body.items.map(({ menuItemId, quantity }) => ({ menuItemId, quantity })), visitorId, sessionId
  })).digest('hex');
  return { items, visitorId, sessionId, requestHash };
}
