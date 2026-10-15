import { Router } from 'express';
import { ingestEvent } from '../controllers/eventController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { publicRateLimit } from '../middleware/rateLimits.js';

export function createEventRouter(rateLimiter = publicRateLimit) {
  const router = Router();
  router.post('/', rateLimiter, asyncHandler(ingestEvent));
  return router;
}

export default createEventRouter();
