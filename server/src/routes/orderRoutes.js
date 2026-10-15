import { Router } from 'express';
import { create } from '../controllers/orderController.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { publicRateLimit } from '../middleware/rateLimits.js';

export function createOrderRouter(rateLimiter = publicRateLimit) {
  const router = Router();
  router.post('/', rateLimiter, asyncHandler(create));
  return router;
}

export default createOrderRouter();
