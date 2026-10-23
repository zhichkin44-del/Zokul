import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authMiddleware } from '../middleware/authMiddleware';
import { loginLimiter, registerLimiter, changePasswordLimiter, resetLimiter } from '../middleware/rateLimitMiddleware';

const router = Router();

router.post('/register', registerLimiter, authController.register);
router.post('/login', loginLimiter, authController.login);
router.get('/me', authMiddleware, authController.me);
router.post('/logout', authMiddleware, authController.logout);
router.post('/change-password', authMiddleware, changePasswordLimiter, authController.changePassword);
router.post('/reset/check', resetLimiter, authController.checkReset);
router.post('/reset', resetLimiter, authController.useReset);
router.post('/delete-account', authMiddleware, changePasswordLimiter, authController.deleteAccount);

export default router;
