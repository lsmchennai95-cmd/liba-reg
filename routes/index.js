import { Router } from 'express';
import { authRoutes } from '../modules/auth/auth.routes.js';
import { studentRoutes, paymentRoutes } from '../modules/student/student.routes.js';
import { notificationRoutes } from '../modules/notification/notification.routes.js';
import { adminRoutes } from '../modules/admin/admin.routes.js';

const router = Router();

// Health check endpoint: GET /api/v1/health
router.get('/health', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'LIBA Server is running',
    data: {}
  });
});

// Feature Modules
router.use('/auth', authRoutes);
router.use('/students', studentRoutes);
router.use('/payments', paymentRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin', adminRoutes);

export { router as apiRoutes };

