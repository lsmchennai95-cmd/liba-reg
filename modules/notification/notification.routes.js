import { Router } from 'express';
import * as NotificationController from './notification.controller.js';
import { validate } from '../../middleware/validation.middleware.js';
import { authenticate, requireAdmin } from '../../middleware/auth.middleware.js';
import {
  createRecipientSchema,
  updateRecipientSchema,
  updateRecipientStatusSchema
} from './notification.validation.js';

const router = Router();

// All notification recipient management APIs require authenticated administrator access
router.use(authenticate, requireAdmin);

router.get('/recipients', NotificationController.getRecipients);
router.post('/recipients', validate(createRecipientSchema), NotificationController.createRecipient);
router.put('/recipients/:id', validate(updateRecipientSchema), NotificationController.updateRecipient);
router.patch(
  '/recipients/:id/status',
  validate(updateRecipientStatusSchema),
  NotificationController.updateRecipientStatus
);
router.delete('/recipients/:id', NotificationController.deleteRecipient);

export { router as notificationRoutes };

