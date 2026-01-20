import { Router } from 'express';
import { UsersController } from '../controllers/usersController';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
const ctrl = new UsersController();

// Base path: /api/users
router.get('/', asyncHandler(ctrl.list));
router.post('/', asyncHandler(ctrl.create));
router.put('/:id', asyncHandler(ctrl.update));
router.post('/:id/password', asyncHandler(ctrl.changePassword));
router.post('/login', asyncHandler(ctrl.login));
router.delete('/:id', asyncHandler(ctrl.delete));

export default router;
