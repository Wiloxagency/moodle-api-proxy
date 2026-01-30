import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { ParticipantsGradesReportController } from '../controllers/participantsGradesReportController';

const router = Router();
const ctrl = new ParticipantsGradesReportController();

router.get('/:numeroInscripcion/grades', asyncHandler(ctrl.getReport.bind(ctrl)));
router.get('/:numeroInscripcion/grades-numeric', asyncHandler(ctrl.getNumericReport.bind(ctrl)));

export default router;
