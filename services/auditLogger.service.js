import { query } from '../src/config/database.js';

/**
 * Shared Audit Logging Service
 * Records administrative actions with admin_id and immutable admin_email.
 * Preserves audit history even if an administrator account is deleted (ON DELETE SET NULL).
 */
export const recordAuditLog = async ({
  adminId,
  adminEmail,
  action,
  targetType,
  targetId,
  previousValue = null,
  newValue = null,
  notes = null,
  connection = null
}) => {
  try {
    const prevJson = previousValue !== null ? JSON.stringify(previousValue) : null;
    const newJson = newValue !== null ? JSON.stringify(newValue) : null;

    const sql = `
      INSERT INTO admin_audit_logs (
        admin_id, admin_email, action, target_type, target_id,
        previous_value, new_value, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    const params = [
      adminId || null,
      adminEmail || null,
      String(action),
      String(targetType),
      String(targetId),
      prevJson,
      newJson,
      notes || null
    ];

    if (connection) {
      await connection.execute(sql, params);
    } else {
      await query(sql, params);
    }
  } catch (err) {
    // Audit logging failure should not abort critical flows, but must be logged
    console.error('[AUDIT-LOG-ERROR] Failed to record audit log:', err.message);
  }
};

