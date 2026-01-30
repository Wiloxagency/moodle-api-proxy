import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { DashboardController } from '../controllers/dashboardController';

const router = Router();
const ctrl = new DashboardController();

router.get('/cache', asyncHandler(ctrl.getCache.bind(ctrl)));

export default router;
