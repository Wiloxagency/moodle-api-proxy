import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { EjecutivosController } from '../controllers/ejecutivosController';

const router = Router();
const ctrl = new EjecutivosController();

router.get('/', asyncHandler(ctrl.list));
router.post('/', asyncHandler(ctrl.create));
router.put('/:id', asyncHandler(ctrl.update));
router.delete('/:id', asyncHandler(ctrl.remove));

export default router;