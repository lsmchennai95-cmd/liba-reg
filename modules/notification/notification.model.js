import { query } from '../../config/database.js';

export const getAllRecipients = async () => {
  return query(
    `SELECT id, recipient_name, email, is_active, created_at, updated_at
     FROM registration_notification_recipients
     ORDER BY id ASC`
  );
};

export const getActiveRecipients = async () => {
  return query(
    `SELECT id, recipient_name, email
     FROM registration_notification_recipients
     WHERE is_active = 1
     ORDER BY id ASC`
  );
};

export const findRecipientById = async (id) => {
  const rows = await query(
    `SELECT id, recipient_name, email, is_active, created_at, updated_at
     FROM registration_notification_recipients
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
};

export const findRecipientByEmail = async (email, excludeId = null) => {
  const normalized = String(email || '').trim().toLowerCase();
  if (excludeId !== null && excludeId !== undefined) {
    const rows = await query(
      `SELECT id, recipient_name, email, is_active
       FROM registration_notification_recipients
       WHERE LOWER(email) = ? AND id != ?
       LIMIT 1`,
      [normalized, excludeId]
    );
    return rows[0] || null;
  }

  const rows = await query(
    `SELECT id, recipient_name, email, is_active
     FROM registration_notification_recipients
     WHERE LOWER(email) = ?
     LIMIT 1`,
    [normalized]
  );
  return rows[0] || null;
};

export const createRecipient = async ({ recipientName, email, isActive = true }) => {
  const result = await query(
    `INSERT INTO registration_notification_recipients (recipient_name, email, is_active)
     VALUES (?, ?, ?)`,
    [recipientName.trim(), email.trim().toLowerCase(), isActive ? 1 : 0]
  );
  return findRecipientById(result.insertId);
};

export const updateRecipient = async (id, { recipientName, email }) => {
  const fields = [];
  const params = [];

  if (recipientName !== undefined) {
    fields.push('recipient_name = ?');
    params.push(recipientName.trim());
  }
  if (email !== undefined) {
    fields.push('email = ?');
    params.push(email.trim().toLowerCase());
  }

  if (fields.length === 0) {
    return findRecipientById(id);
  }

  params.push(id);
  await query(
    `UPDATE registration_notification_recipients
     SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = ?`,
    params
  );

  return findRecipientById(id);
};

export const updateRecipientStatus = async (id, isActive) => {
  await query(
    `UPDATE registration_notification_recipients
     SET is_active = ?, updated_at = NOW()
     WHERE id = ?`,
    [isActive ? 1 : 0, id]
  );
  return findRecipientById(id);
};

export const deleteRecipient = async (id) => {
  const result = await query(
    'DELETE FROM registration_notification_recipients WHERE id = ?',
    [id]
  );
  return result.affectedRows > 0;
};

export const enqueueRegistrationNotification = async ({
  userId,
  studentId,
  applicationNo,
  payload
}) => {
  const result = await query(
    `INSERT IGNORE INTO registration_notification_outbox
       (user_id, student_id, application_no, payload, status, attempts, max_attempts, next_retry_at)
     VALUES (?, ?, ?, ?, 'pending', 0, 3, NOW())`,
    [userId, studentId || null, applicationNo || null, JSON.stringify(payload)]
  );

  return {
    id: result.insertId || null,
    inserted: result.affectedRows > 0
  };
};

export const claimOutboxItemForProcessing = async (outboxId) => {
  const result = await query(
    `UPDATE registration_notification_outbox
     SET status = 'processing', updated_at = NOW()
     WHERE id = ? AND status = 'pending'`,
    [outboxId]
  );
  return result.affectedRows > 0;
};

export const getOutboxItemById = async (outboxId) => {
  const rows = await query(
    'SELECT * FROM registration_notification_outbox WHERE id = ? LIMIT 1',
    [outboxId]
  );
  return rows[0] || null;
};

export const getPendingOutboxItems = async (limit = 10) => {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
  return query(
    `SELECT *
     FROM registration_notification_outbox
     WHERE status = 'pending'
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       AND attempts < max_attempts
     ORDER BY created_at ASC
     LIMIT ${safeLimit}`
  );
};

export const markOutboxSent = async (outboxId, { attempts, recipientsSnapshot }) => {
  return query(
    `UPDATE registration_notification_outbox
     SET status = 'sent',
         attempts = ?,
         recipients_snapshot = ?,
         last_error = NULL,
         next_retry_at = NULL,
         sent_at = NOW(),
         updated_at = NOW()
     WHERE id = ?`,
    [attempts, JSON.stringify(recipientsSnapshot || []), outboxId]
  );
};

export const markOutboxSkipped = async (outboxId, reason) => {
  return query(
    `UPDATE registration_notification_outbox
     SET status = 'skipped',
         last_error = ?,
         next_retry_at = NULL,
         updated_at = NOW()
     WHERE id = ?`,
    [String(reason || 'No active recipients configured').slice(0, 1000), outboxId]
  );
};

export const scheduleOutboxRetry = async (outboxId, {
  attempts,
  maxAttempts,
  errorMessage,
  delaySeconds
}) => {
  const isFinalFailure = attempts >= maxAttempts;
  if (isFinalFailure) {
    return query(
      `UPDATE registration_notification_outbox
       SET status = 'failed',
           attempts = ?,
           last_error = ?,
           next_retry_at = NULL,
           updated_at = NOW()
       WHERE id = ?`,
      [attempts, String(errorMessage || 'Unknown SMTP failure').slice(0, 1000), outboxId]
    );
  }

  return query(
    `UPDATE registration_notification_outbox
     SET status = 'pending',
         attempts = ?,
         last_error = ?,
         next_retry_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
         updated_at = NOW()
     WHERE id = ?`,
    [attempts, String(errorMessage || 'Unknown SMTP failure').slice(0, 1000), delaySeconds, outboxId]
  );
};

