import { Router } from 'express';
import { ParticipantesController } from '../controllers/participantesController';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
const ctrl = new ParticipantesController();

router.get('/', asyncHandler(ctrl.list));
router.get('/counts', asyncHandler(ctrl.counts));
router.post('/', asyncHandler(ctrl.create));
router.put('/:id', asyncHandler(ctrl.update));
router.delete('/:id', asyncHandler(ctrl.delete));
router.post('/import', asyncHandler(ctrl.importFromExcel));
router.post('/import/moodle', asyncHandler(ctrl.importFromMoodle));

export default router;
