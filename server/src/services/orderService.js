import { randomUUID } from 'node:crypto';
import { RestaurantOrder } from '../models/RestaurantOrder.js';
import { config } from '../config/env.js';
import { emitOrderCreated } from './eventService.js';
import { HttpError } from '../utils/httpError.js';

export async function createOrder({ idempotencyKey, request }) {
  let order;
  try {
    order = await RestaurantOrder.findOne({ idempotencyKey });
    if (order) {
      if (order.requestHash !== request.requestHash) {
        throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for a different order');
      }
    } else {
      const subtotalMinor = request.items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
      order = await RestaurantOrder.create({
        orderId: randomUUID(),
        idempotencyKey,
        requestHash: request.requestHash,
        status: 'created',
        items: request.items,
        currency: config.orderCurrency,
        subtotalMinor,
        totalMinor: subtotalMinor,
        visitorId: request.visitorId,
        sessionId: request.sessionId,
        createdAt: new Date()
      });
    }
  } catch (error) {
    if (error?.code !== 11000) throw error;
    order = await RestaurantOrder.findOne({ idempotencyKey });
    if (!order) throw error;
    if (order.requestHash !== request.requestHash) {
      throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for a different order');
    }
  }

  // Persist first. On a retry, this also repairs a previously failed event write.
  await emitOrderCreated(order);
  return order;
}
