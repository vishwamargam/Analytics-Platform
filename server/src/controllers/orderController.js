import { validateOrderRequest } from '../validation/orders.js';
import { createOrder } from '../services/orderService.js';

export async function create(req, res) {
  const request = validateOrderRequest(req.body, req.get('Idempotency-Key'));
  const order = await createOrder({ idempotencyKey: req.get('Idempotency-Key'), request });
  res.status(201).json({ data: {
    orderId: order.orderId,
    status: order.status,
    items: order.items,
    currency: order.currency,
    subtotalMinor: order.subtotalMinor,
    totalMinor: order.totalMinor,
    createdAt: order.createdAt.toISOString()
  } });
}
