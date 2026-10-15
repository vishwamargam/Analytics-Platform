import { Router } from 'express';
import { events, pages, recent, summary, timeseries } from '../controllers/analyticsController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.get('/summary', asyncHandler(summary));
router.get('/timeseries', asyncHandler(timeseries));
router.get('/pages', asyncHandler(pages));
router.get('/events', asyncHandler(events));
router.get('/recent', asyncHandler(recent));
export default router;
