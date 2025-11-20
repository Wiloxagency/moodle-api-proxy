import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { ModalidadesController } from '../controllers/modalidadesController';

const router = Router();
const ctrl = new ModalidadesController();

router.get('/', asyncHandler(ctrl.list));
router.post('/', asyncHandler(ctrl.create));
router.put('/:id', asyncHandler(ctrl.update));
router.delete('/:id', asyncHandler(ctrl.remove));

export default router;