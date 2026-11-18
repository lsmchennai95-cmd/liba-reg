import { Router } from 'express';
import * as StudentController from './student.controller.js';
import { authenticate, requireStudent, requireActiveStudent } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validation.middleware.js';
import { initiatePaymentSchema } from './student.validation.js';

const router = Router();
const paymentRouter = Router();

// Student Profile (Pre & Post Activation)
router.get('/profile', authenticate, requireStudent, StudentController.getProfile);

// Student Dashboard & Payment History
router.get('/dashboard', authenticate, requireStudent, StudentController.getDashboard);
router.get('/payments', authenticate, requireStudent, StudentController.getPayments);

// Scholarship and Academics Routes
router.post('/scholarship/validate', authenticate, requireStudent, StudentController.validateScholarshipCode);
router.post('/scholarship', authenticate, requireStudent, StudentController.submitAcademicAndScholarship);
router.get('/scholarship', authenticate, requireStudent, StudentController.getAcademicAndScholarship);

// Registration Fee & CCAvenue Payment Routes
router.get('/registration-fee', authenticate, requireStudent, StudentController.getRegistrationFee);
router.post('/payment/initiate', authenticate, requireStudent, validate(initiatePaymentSchema), StudentController.initiateRegistrationPayment);
router.get('/registration-status', authenticate, requireStudent, StudentController.getRegistrationStatus);

// Canonical CCAvenue Payment Endpoints mounted at /api/v1/payments
paymentRouter.post('/initiate', authenticate, requireStudent, validate(initiatePaymentSchema), StudentController.initiateRegistrationPayment);
paymentRouter.post('/ccavenue/response', StudentController.handleCcavenueResponse);

export { router as studentRoutes, paymentRouter as paymentRoutes };
