import { AnalyticsEvent } from '../models/AnalyticsEvent.js';
import { createAnalyticsClient } from '@analytics-platform/server-sdk';

export async function insertBrowserEvent(event) {
  try {
    await AnalyticsEvent.create(event);
    return { duplicate: false };
  } catch (error) {
    if (error?.code === 11000) return { duplicate: true };
    throw error;
  }
}

const orderEventClient = createAnalyticsClient({
  // In-process delivery is the simple monolith path. Standalone clients use HTTP.
  transport: async (event) => {
    try {
      await AnalyticsEvent.create(event);
      return { duplicate: false };
    } catch (error) {
      if (error?.code === 11000) return { duplicate: true };
      throw error;
    }
  },
  onError: (failure) => console.error(JSON.stringify({
    level: 'error',
    message: 'order analytics event delivery failed',
    eventId: failure.eventId,
    eventName: failure.eventName,
    attempts: failure.attempts,
    code: failure.code
  }))
});

export function emitOrderCreated(order) {
  return orderEventClient.track('order_created', {
    orderId: order.orderId,
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    totalAmount: order.totalMinor / 100,
    totalMinor: order.totalMinor,
    currency: order.currency
  }, {
    eventId: `order:${order.orderId}`,
    timestamp: order.createdAt,
    visitorId: order.visitorId,
    sessionId: order.sessionId
  });
}
