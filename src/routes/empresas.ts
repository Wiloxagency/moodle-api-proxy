import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { EmpresasController } from '../controllers/empresasController';

const router = Router();
const ctrl = new EmpresasController();

router.get('/', asyncHandler(ctrl.list));
router.post('/', asyncHandler(ctrl.create));
router.put('/:id', asyncHandler(ctrl.update));
router.delete('/:id', asyncHandler(ctrl.remove));

export default router;