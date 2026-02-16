import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { ReportesController } from '../controllers/reportesController';

const router = Router();
const ctrl = new ReportesController();

router.get('/avances', asyncHandler(ctrl.getReporteAvances.bind(ctrl)));
router.get('/vimica', asyncHandler(ctrl.getReporteVimica.bind(ctrl)));
router.get('/vimica/historial', asyncHandler(ctrl.getVimicaHistorial.bind(ctrl)));
router.post('/vimica/enviar', asyncHandler(ctrl.postEnviarVimica.bind(ctrl)));
router.post('/vimica/cerrar-procesadas', asyncHandler(ctrl.cerrarVimicaProcesadas.bind(ctrl)));

export default router;
