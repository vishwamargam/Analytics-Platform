import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { config } from './config/env.js';
import { createEventRouter } from './routes/eventRoutes.js';
import { createOrderRouter } from './routes/orderRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import { requestContext } from './middleware/requestContext.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { HttpError } from './utils/httpError.js';
import { publicRateLimit } from './middleware/rateLimits.js';

export function createApp({ internalIngestionKey = config.internalIngestionKey, rateLimiter = publicRateLimit } = {}) {
  const app = express();
  app.locals.internalIngestionKey = internalIngestionKey;
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new HttpError(403, 'CORS_ORIGIN_DENIED', 'Origin is not allowed'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'Authorization'],
    credentials: false,
    maxAge: 600
  }));
  app.use(requestContext);
  app.use(morgan('tiny', { skip: (req) => req.path === '/api/health' }));
  app.use(express.json({ limit: '16kb', strict: true }));

  app.get('/api/health', (req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ data: { status: ready ? 'ok' : 'not_ready' } });
  });
  app.use('/api/events', createEventRouter(rateLimiter));
  app.use('/api/orders', createOrderRouter(rateLimiter));
  app.use('/api/analytics', analyticsRoutes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
