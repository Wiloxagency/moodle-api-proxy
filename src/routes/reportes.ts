import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { ReportesController } from '../controllers/reportesController';

const router = Router();
const ctrl = new ReportesController();

router.get('/avances', asyncHandler(ctrl.getReporteAvances.bind(ctrl)));

export default router;
