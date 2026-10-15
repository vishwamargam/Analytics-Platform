import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  menuItemId: { type: String, required: true },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1, max: 50 },
  unitPriceMinor: { type: Number, required: true, min: 0 },
  lineTotalMinor: { type: Number, required: true, min: 0 }
}, { _id: false, strict: 'throw' });

const restaurantOrderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true, unique: true, maxlength: 128 },
  requestHash: { type: String, required: true, maxlength: 64 },
  status: { type: String, required: true, enum: ['created'], default: 'created' },
  items: { type: [orderItemSchema], required: true },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  subtotalMinor: { type: Number, required: true, min: 0 },
  totalMinor: { type: Number, required: true, min: 0 },
  visitorId: { type: String, default: null, maxlength: 100 },
  sessionId: { type: String, default: null, maxlength: 100 },
  createdAt: { type: Date, required: true, default: Date.now }
}, { versionKey: false, strict: 'throw' });

restaurantOrderSchema.index({ createdAt: 1 });

export const RestaurantOrder = mongoose.model('RestaurantOrder', restaurantOrderSchema);
