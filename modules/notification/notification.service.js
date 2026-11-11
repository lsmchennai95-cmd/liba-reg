import * as NotificationModel from './notification.model.js';
import { sendInternalRegistrationNotificationEmail } from '../../services/email.service.js';

const formatRecipient = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    recipientName: row.recipient_name,
    email: row.email,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

const parseRecipientId = (rawId) => {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error('Invalid recipient ID');
    error.statusCode = 400;
    throw error;
  }
  return id;
};

export const getAllRecipients = async () => {
  const rows = await NotificationModel.getAllRecipients();
  return rows.map(formatRecipient);
};

export const createRecipient = async ({ recipientName, email, isActive = true }) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const existing = await NotificationModel.findRecipientByEmail(normalizedEmail);
  if (existing) {
    const error = new Error('A notification recipient with this email address already exists.');
    error.statusCode = 409;
    throw error;
  }

  const created = await NotificationModel.createRecipient({
    recipientName,
    email: normalizedEmail,
    isActive
  });
  return formatRecipient(created);
};

export const updateRecipient = async (rawId, { recipientName, email }) => {
  const id = parseRecipientId(rawId);
  const existing = await NotificationModel.findRecipientById(id);
  if (!existing) {
    const error = new Error('Notification recipient not found');
    error.statusCode = 404;
    throw error;
  }

  if (email !== undefined) {
    const normalizedEmail = String(email).trim().toLowerCase();
    const duplicate = await NotificationModel.findRecipientByEmail(normalizedEmail, id);
    if (duplicate) {
      const error = new Error('A notification recipient with this email address already exists.');
      error.statusCode = 409;
      throw error;
    }
  }

  const updated = await NotificationModel.updateRecipient(id, { recipientName, email });
  return formatRecipient(updated);
};

export const updateRecipientStatus = async (rawId, isActive) => {
  const id = parseRecipientId(rawId);
  const existing = await NotificationModel.findRecipientById(id);
  if (!existing) {
    const error = new Error('Notification recipient not found');
    error.statusCode = 404;
    throw error;
  }

  const updated = await NotificationModel.updateRecipientStatus(id, isActive);
  return formatRecipient(updated);
};

export const deleteRecipient = async (rawId) => {
  const id = parseRecipientId(rawId);
  const existing = await NotificationModel.findRecipientById(id);
  if (!existing) {
    const error = new Error('Notification recipient not found');
    error.statusCode = 404;
    throw error;
  }

  await NotificationModel.deleteRecipient(id);
  return { deleted: true, id };
};

export const processOutboxItem = async (outboxId) => {
  const claimed = await NotificationModel.claimOutboxItemForProcessing(outboxId);
  if (!claimed) {
    return { processed: false, reason: 'Already claimed or processed' };
  }

  const item = await NotificationModel.getOutboxItemById(outboxId);
  if (!item) {
    return { processed: false, reason: 'Outbox record not found' };
  }

  const nextAttempts = Number(item.attempts || 0) + 1;
  const maxAttempts = Number(item.max_attempts || 3);

  try {
    const payload = typeof item.payload === 'string'
      ? JSON.parse(item.payload)
      : (item.payload || {});

    const activeRecipients = await NotificationModel.getActiveRecipients();
    if (!activeRecipients || activeRecipients.length === 0) {
      await NotificationModel.markOutboxSkipped(outboxId, 'No active notification recipients configured');
      console.info(
        `[NOTIFICATION-SERVICE] No active registration notification recipients configured; skipping notification for ${item.application_no || item.user_id}.`
      );
      return { processed: true, status: 'skipped' };
    }

    const result = await sendInternalRegistrationNotificationEmail({
      recipients: activeRecipients,
      student: payload
    });

    await NotificationModel.markOutboxSent(outboxId, {
      attempts: nextAttempts,
      recipientsSnapshot: activeRecipients.map((r) => r.email)
    });

    return {
      processed: true,
      status: 'sent',
      recipientsCount: result.recipientsCount,
      messageId: result.messageId
    };
  } catch (error) {
    const delaySeconds = 15 * Math.pow(2, Math.max(0, nextAttempts - 1));
    console.error(
      `[NOTIFICATION-SERVICE] Failed to send internal registration notification (outbox #${outboxId}, attempt ${nextAttempts}/${maxAttempts}):`,
      error.message
    );

    try {
      await NotificationModel.scheduleOutboxRetry(outboxId, {
        attempts: nextAttempts,
        maxAttempts,
        errorMessage: error.message,
        delaySeconds
      });
    } catch (retryErr) {
      console.error(
        `[NOTIFICATION-SERVICE] Failed to update outbox retry state for #${outboxId}:`,
        retryErr.message
      );
    }

    return {
      processed: false,
      status: nextAttempts >= maxAttempts ? 'failed' : 'pending_retry',
      error: error.message
    };
  }
};

export const retryPendingNotifications = async () => {
  try {
    const pendingItems = await NotificationModel.getPendingOutboxItems(10);
    if (!pendingItems || pendingItems.length === 0) {
      return [];
    }

    const results = [];
    for (const item of pendingItems) {
      const outcome = await processOutboxItem(item.id);
      results.push({ id: item.id, ...outcome });
    }
    return results;
  } catch (error) {
    console.error('[NOTIFICATION-SERVICE] Retry worker error:', error.message);
    return [];
  }
};

export const startNotificationRetryWorker = (intervalMs = 15000) => {
  const timer = setInterval(() => {
    retryPendingNotifications().catch((err) => {
      console.error('[NOTIFICATION-SERVICE] Background retry cycle failed:', err.message);
    });
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return timer;
};

/**
 * Enqueues and asynchronously dispatches an internal registration notification.
 * Never throws so student registration and verification remain unaffected.
 */
export const triggerRegistrationNotification = async (studentData) => {
  try {
    const sanitizedPayload = {
      fullName: studentData.fullName,
      email: studentData.email,
      phone: studentData.phone,
      courseName: studentData.courseName || null,
      specializationName: studentData.specializationName || null,
      studentId: studentData.studentId || null,
      applicationNo: studentData.applicationNo || null,
      registrationStatus: studentData.registrationStatus || 'pending_verification',
      registeredAt: studentData.registeredAt || new Date().toISOString()
    };

    const enqueued = await NotificationModel.enqueueRegistrationNotification({
      userId: studentData.userId,
      studentId: sanitizedPayload.studentId,
      applicationNo: sanitizedPayload.applicationNo,
      payload: sanitizedPayload
    });

    if (!enqueued.inserted || !enqueued.id) {
      console.info(
        `[NOTIFICATION-SERVICE] Duplicate registration notification prevented for userId=${studentData.userId}.`
      );
      return { duplicate: true, enqueued: false };
    }

    const timer = setTimeout(() => {
      processOutboxItem(enqueued.id).catch((err) => {
        console.error(
          `[NOTIFICATION-SERVICE] Unhandled async dispatch error for outbox #${enqueued.id}:`,
          err.message
        );
      });
    }, 5500);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    return { enqueued: true, outboxId: enqueued.id };
  } catch (error) {
    console.error(
      '[NOTIFICATION-SERVICE] Failed to enqueue internal registration notification:',
      error.message
    );
    return { enqueued: false, error: error.message };
  }
};
