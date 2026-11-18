import { Router } from 'express';
import * as AdminController from './admin.controller.js';
import { validate } from '../../middleware/validation.middleware.js';
import { authenticate, requireAdmin } from '../../middleware/auth.middleware.js';
import {
  adminLoginSchema,
  dashboardStatsQuerySchema,
  listStudentsQuerySchema,
  listPaymentsQuerySchema,
  updateTimerSchema,
  reactivateTimerSchema,
  createCourseSchema,
  updateCourseSchema,
  updateCourseScholarshipSchema,
  updateCourseDistributionsSchema,
  updateCourseStatusSchema,
  verifyManualPaymentSchema,
  createSpecializationSchema,
  updateSpecializationSchema,
  updateSpecializationStatusSchema,
  listSpecializationsQuerySchema,
  validateQuery
} from './admin.validation.js';

const router = Router();

// Admin Authentication (No public registration)
router.post('/auth/login', validate(adminLoginSchema), AdminController.loginAdmin);
router.post('/auth/logout', AdminController.logoutAdmin);

// Protected Admin Routes
router.use(authenticate, requireAdmin);

router.get('/auth/me', AdminController.getAdminMe);
router.get(
  '/dashboard/stats',
  validateQuery(dashboardStatsQuerySchema),
  AdminController.getDashboardStats
);
router.get(
  '/students',
  validateQuery(listStudentsQuerySchema),
  AdminController.getStudents
);
router.get('/students/:id', AdminController.getStudentById);
router.get('/students/:id/payments', AdminController.getStudentPayments);
router.get('/students/:id/scholarship', AdminController.getStudentScholarshipDetails);
router.post(
  '/students/:id/reactivate-timer',
  validate(reactivateTimerSchema),
  AdminController.reactivateStudentTimer
);
router.post(
  '/students/:id/verify-registration-payment',
  validate(verifyManualPaymentSchema),
  AdminController.verifyRegistrationPayment
);

router.get(
  '/payments',
  validateQuery(listPaymentsQuerySchema),
  AdminController.getPayments
);

// Course Management Endpoints
router.get('/courses', AdminController.getCourses);
router.post('/courses', validate(createCourseSchema), AdminController.createCourse);
router.get('/courses/:id', AdminController.getCourseById);
router.put('/courses/:id', validate(updateCourseSchema), AdminController.updateCourse);
router.delete('/courses/:id', AdminController.deleteCourse);
router.patch('/courses/:id/status', validate(updateCourseStatusSchema), AdminController.updateCourseStatus);
router.put('/courses/:id/status', validate(updateCourseStatusSchema), AdminController.updateCourseStatus);
router.put('/courses/:id/scholarship', validate(updateCourseScholarshipSchema), AdminController.updateCourseScholarship);
router.patch('/courses/:id/scholarship', validate(updateCourseScholarshipSchema), AdminController.updateCourseScholarship);
router.get('/courses/distributions', AdminController.getAllCourseScholarshipDistributions);
router.get('/courses/:id/distributions', AdminController.getCourseScholarshipDistributions);
router.put('/courses/:id/distributions', validate(updateCourseDistributionsSchema), AdminController.saveCourseScholarshipDistributions);
router.post('/courses/:id/distributions', validate(updateCourseDistributionsSchema), AdminController.saveCourseScholarshipDistributions);

// Specialisation Management Endpoints
router.get('/specializations', validateQuery(listSpecializationsQuerySchema), AdminController.getSpecializations);
router.post('/specializations', validate(createSpecializationSchema), AdminController.createSpecialization);
router.get('/specializations/:id', AdminController.getSpecializationById);
router.put('/specializations/:id', validate(updateSpecializationSchema), AdminController.updateSpecialization);
router.delete('/specializations/:id', AdminController.deleteSpecialization);
router.patch('/specializations/:id/status', validate(updateSpecializationStatusSchema), AdminController.updateSpecializationStatus);

// Scholarship Timer Configuration
router.get('/settings/timer', AdminController.getScholarshipTimer);
router.put('/settings/timer', validate(updateTimerSchema), AdminController.updateScholarshipTimer);

export { router as adminRoutes };

