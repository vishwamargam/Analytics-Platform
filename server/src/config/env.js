import dotenv from 'dotenv';

dotenv.config();

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: positiveInteger(process.env.PORT, 3000, 'PORT'),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/analytics_platform',
  internalIngestionKey: process.env.INTERNAL_INGESTION_KEY || '',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:5174')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
  rateLimitWindowMs: positiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60_000, 'RATE_LIMIT_WINDOW_MS'),
  rateLimitMax: positiveInteger(process.env.RATE_LIMIT_MAX, 120, 'RATE_LIMIT_MAX'),
  orderCurrency: (process.env.ORDER_CURRENCY || 'USD').toUpperCase(),
  trustProxy: process.env.TRUST_PROXY === '1'
});
