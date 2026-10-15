import mongoose from 'mongoose';

const analyticsEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, maxlength: 100 },
  eventName: { type: String, required: true, maxlength: 64, index: true },
  eventSource: { type: String, required: true, enum: ['browser', 'server'] },
  timestamp: { type: Date, required: true, index: true },
  visitorId: { type: String, default: null, maxlength: 100 },
  sessionId: { type: String, default: null, maxlength: 100 },
  pageUrl: { type: String, default: null, maxlength: 2048 },
  referrer: { type: String, default: null, maxlength: 2048 },
  properties: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  schemaVersion: { type: Number, required: true, min: 1 }
}, { versionKey: false, strict: 'throw' });

analyticsEventSchema.index({ timestamp: 1, eventName: 1 });
analyticsEventSchema.index({ timestamp: 1, eventSource: 1 });
analyticsEventSchema.index({ timestamp: 1, visitorId: 1 });
analyticsEventSchema.index({ timestamp: 1, pageUrl: 1 });

export const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);
