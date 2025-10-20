import { Router } from 'express';
import { InscripcionesController } from '../controllers/inscripcionesController';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
const ctrl = new InscripcionesController();

router.get('/', asyncHandler(ctrl.list));
router.get('/:id', asyncHandler(ctrl.getById));
router.post('/', asyncHandler(ctrl.create));
router.put('/:id', asyncHandler(ctrl.update));
router.delete('/:id', asyncHandler(ctrl.remove));
router.post('/import', asyncHandler(ctrl.importFromExcel));

export default router;
