import { Router } from 'express';
import * as StudentController from './student.controller.js';
import { authenticate, requireStudent, requireActiveStudent } from '../../middleware/auth.middleware.js';
import { validate } from '../../middleware/validation.middleware.js';
import { initiatePaymentSchema } from './student.validation.js';

const router = Router();
const paymentRouter = Router();

// Student Profile (Pre & Post Activation)
router.get('/profile', authenticate, requireStudent, StudentController.getProfile);

// Post-Activation Protected Routes (Requires is_active = 1)
router.get('/dashboard', authenticate, requireActiveStudent, StudentController.getDashboard);
router.get('/payments', authenticate, requireActiveStudent, StudentController.getPayments);

// Scholarship and Academics Routes (Requires is_active = 1, accessed after account activation)
router.post('/scholarship/validate', authenticate, requireActiveStudent, StudentController.validateScholarshipCode);
router.post('/scholarship', authenticate, requireActiveStudent, StudentController.submitAcademicAndScholarship);
router.get('/scholarship', authenticate, requireActiveStudent, StudentController.getAcademicAndScholarship);

// Registration Fee & CCAvenue Payment Routes
router.get('/registration-fee', authenticate, requireStudent, StudentController.getRegistrationFee);
router.post('/payment/initiate', authenticate, requireStudent, validate(initiatePaymentSchema), StudentController.initiateRegistrationPayment);
router.get('/registration-status', authenticate, requireStudent, StudentController.getRegistrationStatus);

// Canonical CCAvenue Payment Endpoints mounted at /api/v1/payments
paymentRouter.post('/initiate', authenticate, requireStudent, validate(initiatePaymentSchema), StudentController.initiateRegistrationPayment);
paymentRouter.post('/ccavenue/response', StudentController.handleCcavenueResponse);

export { router as studentRoutes, paymentRouter as paymentRoutes };
