import { Router } from 'express';
import * as AdminController from './admin.controller.js';
import { validate } from '../../middleware/validation.middleware.js';
import { authenticate, requireAdmin } from '../../middleware/auth.middleware.js';
import {
  adminLoginSchema,
  dashboardStatsQuerySchema,
  listStudentsQuerySchema,
  listPaymentsQuerySchema,
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
router.post('/students/:id/reactivate-timer', AdminController.reactivateStudentTimer);
router.get(
  '/payments',
  validateQuery(listPaymentsQuerySchema),
  AdminController.getPayments
);

// Scholarship Timer Configuration
router.get('/settings/timer', AdminController.getScholarshipTimer);
router.put('/settings/timer', AdminController.updateScholarshipTimer);

export { router as adminRoutes };

