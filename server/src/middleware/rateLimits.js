import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';

export function createPublicRateLimit({ windowMs = config.rateLimitWindowMs, limit = config.rateLimitMax } = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests; try again later' } }
  });
}

export const publicRateLimit = createPublicRateLimit();
