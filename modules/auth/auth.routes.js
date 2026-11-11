import { Router } from 'express';
import * as AuthController from './auth.controller.js';
import { validate } from '../../middleware/validation.middleware.js';
import { authenticate, requireStudent } from '../../middleware/auth.middleware.js';
import {
  registerSchema,
  verifyOtpSchema,
  resendOtpSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema
} from './auth.validation.js';

const router = Router();

// Public routes
router.post('/register', validate(registerSchema), AuthController.register);
router.post('/verify-otp', validate(verifyOtpSchema), AuthController.verifyOtp);
router.post('/resend-otp', validate(resendOtpSchema), AuthController.resendOtp);
router.post('/login', validate(loginSchema), AuthController.login);
router.post('/logout', AuthController.logout);
router.post('/forgot-password', validate(forgotPasswordSchema), AuthController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), AuthController.resetPassword);
router.get('/courses', AuthController.getCourses);

// Protected routes
router.get('/me', authenticate, requireStudent, AuthController.getMe);

export { router as authRoutes };
