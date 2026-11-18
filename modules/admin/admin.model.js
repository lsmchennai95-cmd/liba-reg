import { query, getConnection } from '../../config/database.js';
import { recordAuditLog } from '../../services/auditLogger.service.js';

const EFFECTIVE_REG_PAYMENT_SUBQUERY = `
  SELECT *
  FROM (
    SELECT
      rp.*,
      ROW_NUMBER() OVER (
        PARTITION BY rp.user_id
        ORDER BY CASE WHEN rp.payment_status = 'successful' THEN 0 ELSE 1 END, rp.id DESC
      ) AS rn
    FROM registration_payments rp
  ) ranked_rp
  WHERE ranked_rp.rn = 1
`;

const EFFECTIVE_PAYMENT_STATUS_EXPR = `
  CASE
    WHEN rp.payment_status = 'successful' THEN 'paid'
    WHEN rp.payment_status = 'cancelled'
      OR (rp.payment_status = 'failed' AND LOWER(COALESCE(rp.raw_response, '')) LIKE '%cancel%')
      THEN 'cancelled'
    WHEN rp.payment_status = 'failed' THEN 'failed'
    ELSE 'pending'
  END
`;

const buildDateFilter = (columnExpr, { range, startDate, endDate }) => {
  const params = [];
  let sql = '';

  if (range === 'today') {
    sql = ` AND ${columnExpr} >= CURDATE() AND ${columnExpr} < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`;
  } else if (range === 'week') {
    sql = ` AND ${columnExpr} >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) AND ${columnExpr} < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`;
  } else if (range === 'month') {
    sql = ` AND ${columnExpr} >= DATE_FORMAT(CURDATE(), '%Y-%m-01') AND ${columnExpr} < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`;
  } else if (range === 'custom' && startDate && endDate) {
    sql = ` AND ${columnExpr} >= ? AND ${columnExpr} < DATE_ADD(?, INTERVAL 1 DAY)`;
    params.push(startDate, endDate);
  } else {
    if (startDate) {
      sql += ` AND ${columnExpr} >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      sql += ` AND ${columnExpr} < DATE_ADD(?, INTERVAL 1 DAY)`;
      params.push(endDate);
    }
  }

  return { sql, params };
};

export const findAdminByEmail = async (email) => {
  const rows = await query(
    'SELECT id, email, password_hash, role, is_active, is_verified, created_at FROM users WHERE email = ? LIMIT 1',
    [email]
  );
  return rows[0] || null;
};

export const findAdminById = async (id) => {
  const rows = await query(
    'SELECT id, email, role, is_active, is_verified, created_at, updated_at FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0] || null;
};

export const getDashboardStats = async ({ range = 'all', startDate, endDate }) => {
  const userDateFilter = buildDateFilter('u.created_at', { range, startDate, endDate });
  const paymentDateFilter = buildDateFilter('COALESCE(rp.paid_at, rp.created_at)', {
    range,
    startDate,
    endDate
  });

  const studentStatsSql = `
    SELECT
      COUNT(DISTINCT u.id) AS total_registered_students,
      COUNT(DISTINCT CASE WHEN u.is_verified = 1 THEN u.id END) AS email_verified_students,
      COUNT(DISTINCT CASE WHEN rp.payment_status = 'successful' THEN u.id END) AS reg_fee_paid_students,
      COUNT(DISTINCT CASE WHEN ${EFFECTIVE_PAYMENT_STATUS_EXPR} = 'failed' THEN u.id END) AS reg_fee_failed_students,
      COUNT(DISTINCT CASE WHEN ${EFFECTIVE_PAYMENT_STATUS_EXPR} = 'cancelled' THEN u.id END) AS reg_fee_cancelled_students
    FROM users u
    LEFT JOIN (${EFFECTIVE_REG_PAYMENT_SUBQUERY}) rp ON rp.user_id = u.id
    WHERE u.role = 'student' ${userDateFilter.sql}
  `;

  const [studentStats] = await query(studentStatsSql, userDateFilter.params);

  const collectedFeesSql = `
    SELECT
      COALESCE(SUM(rp.final_reg_fee), 0.00) AS total_registration_fees_collected,
      COUNT(rp.id) AS successful_registration_payments_count
    FROM registration_payments rp
    INNER JOIN users u ON u.id = rp.user_id AND u.role = 'student'
    WHERE rp.payment_status = 'successful' ${paymentDateFilter.sql}
  `;

  const [collectedStats] = await query(collectedFeesSql, paymentDateFilter.params);

  const [recipientStats] = await query(
    `SELECT
       COUNT(*) AS total_recipients,
       SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_recipients
     FROM registration_notification_recipients`
  );

  const totalRegistered = Number(studentStats?.total_registered_students || 0);
  const emailVerified = Number(studentStats?.email_verified_students || 0);
  const paidStudents = Number(studentStats?.reg_fee_paid_students || 0);
  const pendingStudents = Math.max(0, totalRegistered - paidStudents);

  return {
    totalRegisteredStudents: totalRegistered,
    emailVerifiedStudents: emailVerified,
    registrationFeePaidStudents: paidStudents,
    registrationFeePendingStudents: pendingStudents,
    totalRegistrationFeesCollected: parseFloat(collectedStats?.total_registration_fees_collected || 0),
    successfulRegistrationPaymentsCount: Number(collectedStats?.successful_registration_payments_count || 0),
    paymentStatusCounts: {
      paid: paidStudents,
      pending: Math.max(
        0,
        pendingStudents -
          Number(studentStats?.reg_fee_failed_students || 0) -
          Number(studentStats?.reg_fee_cancelled_students || 0)
      ),
      failed: Number(studentStats?.reg_fee_failed_students || 0),
      cancelled: Number(studentStats?.reg_fee_cancelled_students || 0)
    },
    notificationRecipients: {
      total: Number(recipientStats?.total_recipients || 0),
      active: Number(recipientStats?.active_recipients || 0)
    }
  };
};

export const getStudentsPaginated = async ({
  page = 1,
  limit = 10,
  search = '',
  paymentStatus = 'all',
  emailVerified = 'all',
  courseId,
  startDate,
  endDate,
  sortOrder = 'desc'
}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 10));
  const offset = (safePage - 1) * safeLimit;
  const orderDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';

  const whereClauses = ["u.role = 'student'"];
  const params = [];

  if (search) {
    const likeTerm = `%${search}%`;
    whereClauses.push(`(
      sp.student_id LIKE ?
      OR sp.application_no LIKE ?
      OR CONCAT(COALESCE(sp.first_name, ''), ' ', COALESCE(sp.last_name, '')) LIKE ?
      OR u.email LIKE ?
      OR sp.mobile_number LIKE ?
    )`);
    params.push(likeTerm, likeTerm, likeTerm, likeTerm, likeTerm);
  }

  if (emailVerified === 'verified' || emailVerified === 'true') {
    whereClauses.push('u.is_verified = 1');
  } else if (emailVerified === 'unverified' || emailVerified === 'false') {
    whereClauses.push('u.is_verified = 0');
  }

  if (courseId) {
    whereClauses.push('e.course_id = ?');
    params.push(courseId);
  }

  if (paymentStatus && paymentStatus !== 'all') {
    whereClauses.push(`(${EFFECTIVE_PAYMENT_STATUS_EXPR}) = ?`);
    params.push(paymentStatus);
  }

  const dateFilter = buildDateFilter('u.created_at', { startDate, endDate });
  const whereSql = `${whereClauses.join(' AND ')} ${dateFilter.sql}`;
  const allParams = [...params, ...dateFilter.params];

  const baseFromSql = `
    FROM users u
    INNER JOIN student_profiles sp ON sp.user_id = u.id
    LEFT JOIN enrollments e ON e.user_id = u.id
    LEFT JOIN courses c ON c.id = e.course_id
    LEFT JOIN specializations s ON s.id = e.specialization_id
    LEFT JOIN course_fees cf ON cf.course_id = e.course_id
    LEFT JOIN (${EFFECTIVE_REG_PAYMENT_SUBQUERY}) rp ON rp.user_id = u.id
    WHERE ${whereSql}
  `;

  const countSql = `SELECT COUNT(DISTINCT u.id) AS total ${baseFromSql}`;
  const [countRow] = await query(countSql, allParams);
  const total = Number(countRow?.total || 0);

  const dataSql = `
    SELECT
      u.id AS user_id,
      u.email,
      u.is_active,
      u.is_verified,
      u.created_at AS registration_date,
      sp.student_id,
      sp.application_no,
      sp.first_name,
      sp.last_name,
      CONCAT(sp.first_name, IF(sp.last_name IS NOT NULL AND sp.last_name != '', CONCAT(' ', sp.last_name), '')) AS full_name,
      sp.country_code,
      sp.mobile_number,
      sp.application_status,
      c.id AS course_id,
      c.code AS course_code,
      c.name AS course_name,
      s.name AS specialization_name,
      COALESCE(rp.final_reg_fee, cf.registration_fee, 3100.00) AS registration_fee_amount,
      (${EFFECTIVE_PAYMENT_STATUS_EXPR}) AS payment_status,
      rp.payment_status AS raw_payment_status,
      rp.order_id AS payment_order_id,
      rp.transaction_id AS payment_transaction_id,
      rp.payment_gateway,
      rp.paid_at AS payment_date
    ${baseFromSql}
    ORDER BY u.created_at ${orderDirection}, u.id ${orderDirection}
    LIMIT ${safeLimit} OFFSET ${offset}
  `;

  const rows = await query(dataSql, allParams);

  return {
    rows,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit))
    }
  };
};

export const getStudentById = async (userId) => {
  const sql = `
    SELECT
      u.id AS user_id,
      u.email,
      u.role,
      u.is_active,
      u.is_verified,
      u.created_at AS registration_date,
      sp.id AS student_profile_pk,
      sp.student_id,
      sp.application_no,
      sp.first_name,
      sp.last_name,
      CONCAT(sp.first_name, IF(sp.last_name IS NOT NULL AND sp.last_name != '', CONCAT(' ', sp.last_name), '')) AS full_name,
      sp.country_code,
      sp.mobile_number,
      sp.application_status,
      e.id AS enrollment_id,
      e.enrollment_status,
      e.total_fee,
      e.amount_paid,
      e.outstanding_balance,
      e.scholarship_code,
      COALESCE(e.scholarship_amount, 0.00) AS enrollment_scholarship_amount,
      COALESCE(e.original_total_fee, cf.total_fee, e.total_fee) AS original_total_fee,
      c.id AS course_id,
      c.code AS course_code,
      c.name AS course_name,
      s.id AS specialization_id,
      s.code AS specialization_code,
      s.name AS specialization_name,
      COALESCE(cf.registration_fee, 3100.00) AS default_registration_fee,
      rp.id AS reg_payment_id,
      rp.order_id AS latest_order_id,
      rp.transaction_id AS latest_transaction_id,
      rp.tracking_id AS latest_tracking_id,
      rp.bank_ref_no AS latest_bank_ref_no,
      rp.payment_mode AS latest_payment_mode,
      rp.original_reg_fee,
      rp.scholarship_discount AS reg_scholarship_discount,
      COALESCE(rp.final_reg_fee, cf.registration_fee, 3100.00) AS registration_fee_amount,
      rp.payment_gateway,
      rp.payment_status AS raw_payment_status,
      (${EFFECTIVE_PAYMENT_STATUS_EXPR}) AS effective_payment_status,
      rp.paid_at AS latest_paid_at,
      COALESCE(rp.gateway_response, rp.raw_response) AS latest_raw_response
    FROM users u
    INNER JOIN student_profiles sp ON sp.user_id = u.id
    LEFT JOIN enrollments e ON e.user_id = u.id
    LEFT JOIN courses c ON c.id = e.course_id
    LEFT JOIN specializations s ON s.id = e.specialization_id
    LEFT JOIN course_fees cf ON cf.course_id = e.course_id
    LEFT JOIN (${EFFECTIVE_REG_PAYMENT_SUBQUERY}) rp ON rp.user_id = u.id
    WHERE u.id = ? AND u.role = 'student'
    LIMIT 1
  `;

  const rows = await query(sql, [userId]);
  return rows[0] || null;
};

const COMBINED_PAYMENTS_SUBQUERY = `
  SELECT
    CONCAT('REG-', rp.id) AS record_id,
    rp.id AS numeric_id,
    rp.user_id,
    'registration_fee' AS payment_type,
    rp.order_id,
    rp.transaction_id,
    rp.tracking_id,
    rp.bank_ref_no,
    rp.payment_mode,
    rp.final_reg_fee AS amount,
    COALESCE(rp.currency, 'INR') AS currency,
    rp.payment_gateway,
    rp.payment_status AS raw_payment_status,
    CASE
      WHEN rp.payment_status = 'successful' THEN 'paid'
      WHEN rp.payment_status = 'cancelled'
        OR (rp.payment_status = 'failed' AND LOWER(COALESCE(rp.raw_response, '')) LIKE '%cancel%')
        THEN 'cancelled'
      WHEN rp.payment_status = 'failed' THEN 'failed'
      ELSE 'pending'
    END AS display_status,
    rp.paid_at,
    rp.created_at,
    COALESCE(rp.gateway_response, rp.raw_response) AS raw_response
  FROM registration_payments rp

  UNION ALL

  SELECT
    CONCAT('CRS-', p.id) AS record_id,
    p.id AS numeric_id,
    p.user_id,
    'course_fee' AS payment_type,
    p.order_id,
    COALESCE(p.transaction_id, p.tracking_id, p.order_id) AS transaction_id,
    p.tracking_id,
    p.bank_ref_no,
    p.payment_mode,
    p.amount,
    p.currency,
    COALESCE(p.payment_gateway, p.payment_method, 'ccavenue') AS payment_gateway,
    p.payment_status AS raw_payment_status,
    CASE
      WHEN p.payment_status = 'successful' THEN 'paid'
      WHEN p.payment_status = 'cancelled' THEN 'cancelled'
      WHEN p.payment_status = 'failed' THEN 'failed'
      WHEN p.payment_status = 'refunded' THEN 'refunded'
      ELSE 'pending'
    END AS display_status,
    p.paid_at,
    p.created_at,
    COALESCE(p.gateway_response, p.raw_response) AS raw_response
  FROM payments p
`;

export const getPaymentsByStudentId = async (userId) => {
  const sql = `
    SELECT
      tx.*,
      c.name AS course_name
    FROM (${COMBINED_PAYMENTS_SUBQUERY}) tx
    LEFT JOIN enrollments e ON e.user_id = tx.user_id
    LEFT JOIN courses c ON c.id = e.course_id
    WHERE tx.user_id = ?
    ORDER BY COALESCE(tx.paid_at, tx.created_at) DESC, tx.numeric_id DESC
  `;
  return query(sql, [userId]);
};

export const getPaymentsPaginated = async ({
  page = 1,
  limit = 10,
  search = '',
  paymentType = 'all',
  status = 'all',
  startDate,
  endDate
}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 10));
  const offset = (safePage - 1) * safeLimit;

  const whereClauses = ["u.role = 'student'"];
  const params = [];

  if (search) {
    const likeTerm = `%${search}%`;
    whereClauses.push(`(
      sp.student_id LIKE ?
      OR sp.application_no LIKE ?
      OR CONCAT(COALESCE(sp.first_name, ''), ' ', COALESCE(sp.last_name, '')) LIKE ?
      OR u.email LIKE ?
      OR tx.order_id LIKE ?
      OR tx.transaction_id LIKE ?
      OR tx.tracking_id LIKE ?
      OR tx.bank_ref_no LIKE ?
    )`);
    params.push(likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm);
  }

  if (paymentType && paymentType !== 'all') {
    whereClauses.push('tx.payment_type = ?');
    params.push(paymentType);
  }

  if (status && status !== 'all') {
    whereClauses.push('tx.display_status = ?');
    params.push(status);
  }

  const dateFilter = buildDateFilter('COALESCE(tx.paid_at, tx.created_at)', { startDate, endDate });
  const whereSql = `${whereClauses.join(' AND ')} ${dateFilter.sql}`;
  const allParams = [...params, ...dateFilter.params];

  const baseFromSql = `
    FROM (${COMBINED_PAYMENTS_SUBQUERY}) tx
    INNER JOIN users u ON u.id = tx.user_id
    INNER JOIN student_profiles sp ON sp.user_id = u.id
    LEFT JOIN enrollments e ON e.user_id = u.id
    LEFT JOIN courses c ON c.id = e.course_id
    WHERE ${whereSql}
  `;

  const summarySql = `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN tx.payment_type = 'registration_fee' AND tx.display_status = 'paid' THEN tx.amount ELSE 0 END), 0.00) AS total_reg_collected,
      COALESCE(SUM(CASE WHEN tx.display_status = 'paid' THEN tx.amount ELSE 0 END), 0.00) AS total_collected,
      SUM(CASE WHEN tx.display_status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
      SUM(CASE WHEN tx.display_status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN tx.display_status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN tx.display_status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count
    ${baseFromSql}
  `;

  const [summary] = await query(summarySql, allParams);
  const total = Number(summary?.total || 0);

  const dataSql = `
    SELECT
      tx.*,
      u.email,
      sp.student_id,
      sp.application_no,
      CONCAT(sp.first_name, IF(sp.last_name IS NOT NULL AND sp.last_name != '', CONCAT(' ', sp.last_name), '')) AS full_name,
      c.name AS course_name
    ${baseFromSql}
    ORDER BY COALESCE(tx.paid_at, tx.created_at) DESC, tx.numeric_id DESC
    LIMIT ${safeLimit} OFFSET ${offset}
  `;

  const rows = await query(dataSql, allParams);

  return {
    rows,
    summary: {
      totalRegistrationFeesCollected: parseFloat(summary?.total_reg_collected || 0),
      totalCollected: parseFloat(summary?.total_collected || 0),
      paidCount: Number(summary?.paid_count || 0),
      pendingCount: Number(summary?.pending_count || 0),
      failedCount: Number(summary?.failed_count || 0),
      cancelledCount: Number(summary?.cancelled_count || 0)
    },
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit))
    }
  };
};

export const getSystemSetting = async (key) => {
  const rows = await query(
    'SELECT setting_key, setting_value FROM system_settings WHERE setting_key = ? LIMIT 1',
    [key]
  );
  return rows.length > 0 ? rows[0].setting_value : null;
};

export const upsertSystemSetting = async (key, value) => {
  await query(
    `INSERT INTO system_settings (setting_key, setting_value, created_at, updated_at)
     VALUES (?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
    [key, String(value)]
  );
  return { setting_key: key, setting_value: String(value) };
};

export const getLatestScholarshipClaimByUserId = async (userId) => {
  const rows = await query(
    `SELECT id, user_id, course_id, max_scholarship, total_discount, calculation_snapshot, status, expires_at, created_at, updated_at,
            CASE
              WHEN status = 'active' AND expires_at <= NOW() THEN 'expired'
              ELSE status
            END AS effective_status
     FROM scholarship_claims
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [userId]
  );
  return rows.length > 0 ? rows[0] : null;
};

export const reactivateScholarshipClaim = async (claimId, minutes) => {
  await query(
    `UPDATE scholarship_claims
     SET status = 'active',
         expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE),
         updated_at = NOW()
     WHERE id = ?`,
    [minutes, claimId]
  );
  const rows = await query('SELECT * FROM scholarship_claims WHERE id = ?', [claimId]);
  return rows.length > 0 ? rows[0] : null;
};

export const createScholarshipClaimForUser = async (userId, discount, minutes) => {
  const res = await query(
    `INSERT INTO scholarship_claims (user_id, total_discount, status, expires_at, created_at, updated_at)
     VALUES (?, ?, 'active', DATE_ADD(NOW(), INTERVAL ? MINUTE), NOW(), NOW())`,
    [userId, discount, minutes]
  );
  const insertId = res.insertId;
  const rows = await query('SELECT * FROM scholarship_claims WHERE id = ?', [insertId]);
  return rows.length > 0 ? rows[0] : null;
};

export const verifyManualRegistrationPayment = async ({
  userId,
  amount,
  paymentMethod,
  normalizedRef,
  actualPaymentDate,
  verificationNotes = '',
  paymentProofPath = '',
  adminId,
  adminEmail
}) => {
  const connection = await getConnection();
  try {
    await connection.beginTransaction();

    const [existingRef] = await connection.execute(
      `SELECT id, user_id FROM registration_payments WHERE manual_txn_ref = ? OR transaction_id = ? FOR UPDATE`,
      [normalizedRef, `MANUAL-${normalizedRef}`]
    );

    if (existingRef.length > 0) {
      const conflictErr = new Error(`Transaction reference '${normalizedRef}' has already been verified.`);
      conflictErr.statusCode = 409;
      conflictErr.code = 'DUPLICATE_MANUAL_REFERENCE';
      throw conflictErr;
    }

    const [enrollmentRows] = await connection.execute(
      `SELECT e.course_id, e.registration_fee, sp.student_id, sp.application_no, c.name as course_name
       FROM enrollments e
       LEFT JOIN student_profiles sp ON sp.user_id = e.user_id
       LEFT JOIN courses c ON c.id = e.course_id
       WHERE e.user_id = ?
       LIMIT 1 FOR UPDATE`,
      [userId]
    );

    const enrollment = enrollmentRows[0] || {};
    const courseId = enrollment.course_id || 1;
    const expectedRegFee = parseFloat(enrollment.registration_fee || amount || 3100);
    const effectiveAmount = (amount !== undefined && !isNaN(amount) && amount > 0) ? parseFloat(amount) : expectedRegFee;

    const nowTimestamp = Date.now();
    const orderId = `MANUAL-REG-${nowTimestamp}`;
    const transactionId = `MANUAL-${normalizedRef}`;

    let dbPaymentDate = null;
    try {
      if (actualPaymentDate) {
        dbPaymentDate = new Date(actualPaymentDate).toISOString().slice(0, 19).replace('T', ' ');
      }
    } catch (e) {
      dbPaymentDate = null;
    }
    if (!dbPaymentDate) {
      dbPaymentDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
    }

    await connection.execute(
      `INSERT INTO registration_payments (
        user_id, student_id, course_id, original_reg_fee, scholarship_discount,
        final_reg_fee, amount, order_id, transaction_id, payment_mode,
        payment_gateway, payment_method, payment_type, currency, payment_status,
        paid_at, actual_payment_date, verified_by, verified_at,
        verification_status, verification_notes, payment_proof_path, manual_txn_ref,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, 0.00,
        ?, ?, ?, ?, ?,
        'manual', ?, 'registration_fee', 'INR', 'successful',
        NOW(), ?, ?, NOW(),
        'verified', ?, ?, ?,
        NOW(), NOW()
      )`,
      [
        userId,
        enrollment.student_id || null,
        courseId,
        expectedRegFee,
        effectiveAmount,
        effectiveAmount,
        orderId,
        transactionId,
        paymentMethod,
        paymentMethod,
        dbPaymentDate,
        adminId || null,
        verificationNotes || null,
        paymentProofPath || null,
        normalizedRef
      ]
    );

    await connection.execute(
      `UPDATE users SET registration_fee_paid = 1, is_active = 1, updated_at = NOW() WHERE id = ?`,
      [userId]
    );

    await connection.execute(
      `UPDATE student_profiles SET application_status = 'approved', updated_at = NOW() WHERE user_id = ?`,
      [userId]
    );

    await recordAuditLog({
      adminId,
      adminEmail,
      action: 'verify_registration_payment',
      targetType: 'student',
      targetId: String(userId),
      previousValue: { registration_fee_paid: 0 },
      newValue: {
        registration_fee_paid: 1,
        manual_txn_ref: normalizedRef,
        amount: effectiveAmount,
        actual_payment_date: actualPaymentDate
      },
      notes: verificationNotes || `Verified manual registration payment ref: ${normalizedRef}`,
      connection
    });

    await connection.commit();

    return {
      success: true,
      orderId,
      transactionId,
      amount: effectiveAmount,
      paymentType: 'registration_fee',
      verifiedAt: new Date().toISOString()
    };
  } catch (err) {
    await connection.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      const conflictErr = new Error(`Transaction reference '${normalizedRef}' has already been recorded.`);
      conflictErr.statusCode = 409;
      conflictErr.code = 'DUPLICATE_MANUAL_REFERENCE';
      throw conflictErr;
    }
    throw err;
  } finally {
    connection.release();
  }
};

export const verifyManualCoursePayment = async ({
  userId,
  amount,
  paymentMethod,
  normalizedRef,
  actualPaymentDate,
  verificationNotes = '',
  paymentProofPath = '',
  adminId,
  adminEmail
}) => {
  const connection = await getConnection();
  try {
    await connection.beginTransaction();

    const [enrollmentRows] = await connection.execute(
      `SELECT e.id as enrollment_id, e.course_id, e.total_fee, e.amount_paid, e.outstanding_balance,
              e.original_total_fee, e.scholarship_amount, sp.student_id, sp.application_no, c.name as course_name
       FROM enrollments e
       LEFT JOIN student_profiles sp ON sp.user_id = e.user_id
       LEFT JOIN courses c ON c.id = e.course_id
       WHERE e.user_id = ?
       LIMIT 1 FOR UPDATE`,
      [userId]
    );

    if (enrollmentRows.length === 0) {
      const err = new Error(`Student #${userId} does not have an active enrollment.`);
      err.statusCode = 404;
      throw err;
    }

    const enrollment = enrollmentRows[0];
    const totalFee = parseFloat(enrollment.total_fee || 0);
    const prevAmountPaid = parseFloat(enrollment.amount_paid || 0);
    const prevOutstanding = parseFloat(enrollment.outstanding_balance || 0);

    const paymentAmount = parseFloat(amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      const err = new Error('Course fee payment amount must be greater than zero.');
      err.statusCode = 400;
      throw err;
    }

    const [existingTx] = await connection.execute(
      `SELECT id FROM payments WHERE transaction_id = ? OR tracking_id = ? OR bank_ref_no = ? LIMIT 1 FOR UPDATE`,
      [normalizedRef, normalizedRef, normalizedRef]
    );
    if (existingTx.length > 0) {
      const conflictErr = new Error(`Transaction reference '${normalizedRef}' has already been recorded in payments.`);
      conflictErr.statusCode = 409;
      conflictErr.code = 'DUPLICATE_MANUAL_REFERENCE';
      throw conflictErr;
    }

    const nowTimestamp = Date.now();
    const orderId = `MANUAL-CRS-${nowTimestamp}`;
    const transactionId = `MANUAL-${normalizedRef}`;
    const tid = `MANUAL-TID-${nowTimestamp}`;
    const newAmountPaid = prevAmountPaid + paymentAmount;
    const newOutstanding = Math.max(0, totalFee - newAmountPaid);
    const newEnrollmentStatus = newOutstanding <= 0 ? 'completed' : 'enrolled';

    let dbPaymentDate = null;
    try {
      if (actualPaymentDate) {
        dbPaymentDate = new Date(actualPaymentDate).toISOString().slice(0, 19).replace('T', ' ');
      }
    } catch (e) {
      dbPaymentDate = null;
    }
    if (!dbPaymentDate) {
      dbPaymentDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
    }

    const [insPayment] = await connection.execute(
      `INSERT INTO payments (
        enrollment_id, user_id, transaction_id, order_id, tid,
        amount, currency, payment_method, payment_gateway, payment_status,
        paid_at, raw_response
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, 'INR', ?, 'manual', 'successful',
        ?, ?
      )`,
      [
        enrollment.enrollment_id,
        userId,
        transactionId,
        orderId,
        tid,
        paymentAmount,
        paymentMethod || 'bank_transfer',
        dbPaymentDate,
        JSON.stringify({
          source: 'admin_manual_entry',
          adminId,
          adminEmail,
          manualTxnRef: normalizedRef,
          notes: verificationNotes,
          recordedAt: new Date().toISOString()
        })
      ]
    );

    await connection.execute(
      `UPDATE enrollments
       SET amount_paid = ?,
           outstanding_balance = ?,
           enrollment_status = ?,
           enrolled_at = COALESCE(enrolled_at, NOW()),
           updated_at = NOW()
       WHERE id = ?`,
      [newAmountPaid, newOutstanding, newEnrollmentStatus, enrollment.enrollment_id]
    );

    await connection.execute(
      `UPDATE student_profiles SET application_status = 'approved', updated_at = NOW() WHERE user_id = ?`,
      [userId]
    );

    await recordAuditLog({
      adminId,
      adminEmail,
      action: 'verify_course_fee_payment',
      targetType: 'student',
      targetId: String(userId),
      previousValue: {
        amount_paid: prevAmountPaid,
        outstanding_balance: prevOutstanding
      },
      newValue: {
        amount_paid: newAmountPaid,
        outstanding_balance: newOutstanding,
        manual_txn_ref: normalizedRef,
        amount: paymentAmount,
        actual_payment_date: actualPaymentDate,
        payment_id: insPayment.insertId
      },
      notes: verificationNotes || `Verified manual course payment ref: ${normalizedRef} (Amount: ₹${paymentAmount})`,
      connection
    });

    await connection.commit();

    return {
      success: true,
      orderId,
      transactionId,
      amount: paymentAmount,
      paymentType: 'course_fee',
      newAmountPaid,
      newOutstanding,
      enrollmentStatus: newEnrollmentStatus,
      verifiedAt: new Date().toISOString()
    };
  } catch (err) {
    await connection.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      const conflictErr = new Error(`Transaction reference '${normalizedRef}' has already been verified.`);
      conflictErr.statusCode = 409;
      conflictErr.code = 'DUPLICATE_MANUAL_REFERENCE';
      throw conflictErr;
    }
    throw err;
  } finally {
    connection.release();
  }
};

/* =====================================================================
   COURSE MANAGEMENT MODEL METHODS
===================================================================== */

export const getAllCoursesWithFees = async () => {
  const coursesSql = `
    SELECT
      c.id,
      c.code,
      c.name,
      c.description,
      c.course_type,
      c.scholarship_amount,
      c.is_scholarship_active,
      c.is_active,
      c.created_at,
      c.updated_at,
      COALESCE(cf.total_fee, 0.00) AS total_fee,
      COALESCE(cf.registration_fee, 3100.00) AS registration_fee,
      COALESCE(cf.admission_fee, 0.00) AS admission_fee,
      COALESCE(cf.tuition_fee, 0.00) AS tuition_fee
    FROM courses c
    LEFT JOIN course_fees cf ON cf.course_id = c.id
    ORDER BY c.id ASC
  `;
  const courses = await query(coursesSql);
  const specs = await query(
    'SELECT id, course_id, code, name, is_active FROM specializations ORDER BY course_id ASC, id ASC'
  );
  const distributions = await query(
    'SELECT id, course_id, category, amount, is_active, eligibility_config FROM course_scholarship_distributions ORDER BY course_id ASC, id ASC'
  );

  return courses.map(course => {
    const courseSpecs = specs
      .filter(s => Number(s.course_id) === Number(course.id))
      .map(s => ({
        ...s,
        id: Number(s.id),
        course_id: Number(s.course_id),
        is_active: Boolean(s.is_active)
      }));
    const courseDist = distributions
      .filter(d => Number(d.course_id) === Number(course.id))
      .map(d => ({
        ...d,
        id: Number(d.id),
        course_id: Number(d.course_id),
        amount: parseFloat(d.amount || 0),
        is_active: Boolean(d.is_active),
        eligibility_config: typeof d.eligibility_config === 'string'
          ? JSON.parse(d.eligibility_config)
          : (d.eligibility_config || {})
      }));

    return {
      ...course,
      id: Number(course.id),
      total_fee: parseFloat(course.total_fee || 0),
      course_fee: parseFloat(course.total_fee || 0),
      total_course_fee: parseFloat(course.total_fee || 0),
      registration_fee: parseFloat(course.registration_fee || 0),
      admission_fee: parseFloat(course.admission_fee || 0),
      tuition_fee: parseFloat(course.tuition_fee || 0),
      scholarship_amount: parseFloat(course.scholarship_amount || 0),
      is_scholarship_active: Boolean(course.is_scholarship_active),
      is_active: Boolean(course.is_active),
      specializations: courseSpecs,
      specialization_summary: courseSpecs.map(s => s.name).join(', '),
      specializations_count: courseSpecs.length,
      active_specializations_count: courseSpecs.filter(s => s.is_active).length,
      distributions: courseDist,
      distributions_count: courseDist.length
    };
  });
};

export const getCourseWithFeesById = async (courseId) => {
  const sql = `
    SELECT
      c.id,
      c.code,
      c.name,
      c.description,
      c.course_type,
      c.scholarship_amount,
      c.is_scholarship_active,
      c.is_active,
      c.created_at,
      c.updated_at,
      COALESCE(cf.total_fee, 0.00) AS total_fee,
      COALESCE(cf.registration_fee, 3100.00) AS registration_fee,
      COALESCE(cf.admission_fee, 0.00) AS admission_fee,
      COALESCE(cf.tuition_fee, 0.00) AS tuition_fee
    FROM courses c
    LEFT JOIN course_fees cf ON cf.course_id = c.id
    WHERE c.id = ?
    LIMIT 1
  `;
  const rows = await query(sql, [courseId]);
  if (rows.length === 0) return null;
  const course = rows[0];

  const specs = await query(
    'SELECT id, course_id, code, name, is_active FROM specializations WHERE course_id = ? ORDER BY id ASC',
    [courseId]
  );
  const distributions = await query(
    'SELECT id, course_id, category, amount, is_active, eligibility_config, created_at, updated_at FROM course_scholarship_distributions WHERE course_id = ? ORDER BY id ASC',
    [courseId]
  );

  const formattedSpecs = specs.map(s => ({
    ...s,
    id: Number(s.id),
    course_id: Number(s.course_id),
    is_active: Boolean(s.is_active)
  }));

  const formattedDist = distributions.map(d => ({
    ...d,
    id: Number(d.id),
    course_id: Number(d.course_id),
    amount: parseFloat(d.amount || 0),
    is_active: Boolean(d.is_active),
    eligibility_config: typeof d.eligibility_config === 'string'
      ? JSON.parse(d.eligibility_config)
      : (d.eligibility_config || {})
  }));

  return {
    ...course,
    id: Number(course.id),
    total_fee: parseFloat(course.total_fee || 0),
    course_fee: parseFloat(course.total_fee || 0),
    total_course_fee: parseFloat(course.total_fee || 0),
    registration_fee: parseFloat(course.registration_fee || 0),
    admission_fee: parseFloat(course.admission_fee || 0),
    tuition_fee: parseFloat(course.tuition_fee || 0),
    scholarship_amount: parseFloat(course.scholarship_amount || 0),
    is_scholarship_active: Boolean(course.is_scholarship_active),
    is_active: Boolean(course.is_active),
    specializations: formattedSpecs,
    specialization_summary: formattedSpecs.map(s => s.name).join(', '),
    specializations_count: formattedSpecs.length,
    active_specializations_count: formattedSpecs.filter(s => s.is_active).length,
    distributions: formattedDist,
    distributions_count: formattedDist.length
  };
};

export const createCourseWithFees = async (payload) => {
  const connection = await getConnection();
  try {
    await connection.beginTransaction();

    const [res] = await connection.execute(
      `INSERT INTO courses (code, name, description, course_type, scholarship_amount, is_scholarship_active, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        payload.code,
        payload.name,
        payload.description || '',
        payload.course_type || 'Online Degree',
        payload.scholarship_amount !== undefined ? payload.scholarship_amount : 40000.00,
        payload.is_scholarship_active !== undefined ? payload.is_scholarship_active : 1,
        payload.is_active !== undefined ? payload.is_active : 1
      ]
    );
    const courseId = res.insertId;

    const totalFee = parseFloat(payload.total_fee || 0);
    const regFee = parseFloat(payload.registration_fee !== undefined ? payload.registration_fee : 3100.00);
    const tuitionFee = parseFloat(payload.tuition_fee !== undefined ? payload.tuition_fee : Math.max(0, totalFee - regFee));

    await connection.execute(
      `INSERT INTO course_fees (course_id, total_fee, registration_fee, tuition_fee, created_at, updated_at)
       VALUES (?, ?, ?, ?, NOW(), NOW())`,
      [courseId, totalFee, regFee, tuitionFee]
    );

    // Seed default scholarship distributions for the newly created course
    const defaultDistributions = [
      { category: 'twelfth', amount: 10000, label: '12th Qualification', min_percentage: 65 },
      { category: 'ug', amount: 15000, label: 'Undergraduate Qualification', min_percentage: 65 },
      { category: 'certification', amount: 5000, label: 'Additional Certification', required: true },
      { category: 'counselor', amount: 10000, label: 'Counselor Scholarship Code', promo_required: true }
    ];

    for (const d of defaultDistributions) {
      await connection.execute(
        `INSERT INTO course_scholarship_distributions (course_id, category, amount, is_active, eligibility_config, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, NOW(), NOW())`,
        [courseId, d.category, d.amount, JSON.stringify(d)]
      );
    }

    await connection.commit();
    return getCourseWithFeesById(courseId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

export const updateCourseWithFees = async (courseId, payload) => {
  const connection = await getConnection();
  try {
    await connection.beginTransaction();

    const courseUpdates = [];
    const courseParams = [];

    if (payload.code !== undefined) {
      courseUpdates.push('code = ?');
      courseParams.push(payload.code);
    }
    if (payload.name !== undefined) {
      courseUpdates.push('name = ?');
      courseParams.push(payload.name);
    }
    if (payload.description !== undefined) {
      courseUpdates.push('description = ?');
      courseParams.push(payload.description);
    }
    if (payload.course_type !== undefined) {
      courseUpdates.push('course_type = ?');
      courseParams.push(payload.course_type);
    }
    if (payload.scholarship_amount !== undefined) {
      courseUpdates.push('scholarship_amount = ?');
      courseParams.push(payload.scholarship_amount);
    }
    if (payload.is_scholarship_active !== undefined) {
      courseUpdates.push('is_scholarship_active = ?');
      courseParams.push(payload.is_scholarship_active);
    }
    if (payload.is_active !== undefined) {
      courseUpdates.push('is_active = ?');
      courseParams.push(payload.is_active);
    }

    if (courseUpdates.length > 0) {
      courseUpdates.push('updated_at = NOW()');
      courseParams.push(courseId);
      await connection.execute(`UPDATE courses SET ${courseUpdates.join(', ')} WHERE id = ?`, courseParams);
    }

    const feeUpdates = [];
    const feeParams = [];
    if (payload.total_fee !== undefined) {
      feeUpdates.push('total_fee = ?');
      feeParams.push(payload.total_fee);
    }
    if (payload.registration_fee !== undefined) {
      feeUpdates.push('registration_fee = ?');
      feeParams.push(payload.registration_fee);
    }
    if (payload.tuition_fee !== undefined) {
      feeUpdates.push('tuition_fee = ?');
      feeParams.push(payload.tuition_fee);
    }

    if (feeUpdates.length > 0) {
      feeUpdates.push('updated_at = NOW()');
      feeParams.push(courseId);
      await connection.execute(
        `INSERT INTO course_fees (course_id, total_fee, registration_fee, tuition_fee, created_at, updated_at)
         VALUES (?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE ${feeUpdates.join(', ')}`,
        [
          courseId,
          payload.total_fee || 0,
          payload.registration_fee || 3100,
          payload.tuition_fee || 0,
          ...feeParams
        ]
      );
    }

    await connection.commit();
    return getCourseWithFeesById(courseId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

export const updateCourseStatus = async (courseId, isActive) => {
  await query('UPDATE courses SET is_active = ?, updated_at = NOW() WHERE id = ?', [isActive ? 1 : 0, courseId]);
  return getCourseWithFeesById(courseId);
};

export const updateCourseScholarshipConfig = async (courseId, payload) => {
  const updates = [];
  const params = [];
  if (payload.is_scholarship_active !== undefined) {
    updates.push('is_scholarship_active = ?');
    params.push(payload.is_scholarship_active ? 1 : 0);
  }
  if (payload.scholarship_amount !== undefined) {
    updates.push('scholarship_amount = ?');
    params.push(payload.scholarship_amount);
  }
  if (updates.length > 0) {
    updates.push('updated_at = NOW()');
    params.push(courseId);
    await query(`UPDATE courses SET ${updates.join(', ')} WHERE id = ?`, params);
  }
  return getCourseWithFeesById(courseId);
};

export const deleteOrDeactivateCourse = async (courseId) => {
  const enrollments = await query('SELECT COUNT(*) as count FROM enrollments WHERE course_id = ?', [courseId]);
  const count = Number(enrollments[0]?.count || 0);
  if (count > 0) {
    await query('UPDATE courses SET is_active = 0, updated_at = NOW() WHERE id = ?', [courseId]);
    return {
      action: 'deactivated',
      courseId,
      message: `Course has ${count} existing enrollment(s). It has been deactivated instead of deleted.`
    };
  }
  await query('DELETE FROM courses WHERE id = ?', [courseId]);
  return {
    action: 'deleted',
    courseId,
    message: 'Course deleted successfully.'
  };
};

/* =====================================================================
   COURSE SCHOLARSHIP DISTRIBUTION METHODS
===================================================================== */

export const getCourseScholarshipDistributions = async (courseId) => {
  const courses = await query(
    'SELECT id, code, name, scholarship_amount, is_scholarship_active, is_active FROM courses WHERE id = ? LIMIT 1',
    [courseId]
  );
  if (courses.length === 0) return null;
  const course = courses[0];

  const distributions = await query(
    'SELECT id, course_id, category, amount, is_active, eligibility_config, created_at, updated_at FROM course_scholarship_distributions WHERE course_id = ? ORDER BY id ASC',
    [courseId]
  );

  return {
    course: {
      ...course,
      id: Number(course.id),
      scholarship_amount: parseFloat(course.scholarship_amount || 0),
      is_scholarship_active: Boolean(course.is_scholarship_active),
      is_active: Boolean(course.is_active)
    },
    distributions: distributions.map(d => ({
      ...d,
      id: Number(d.id),
      course_id: Number(d.course_id),
      amount: parseFloat(d.amount || 0),
      is_active: Boolean(d.is_active),
      eligibility_config: typeof d.eligibility_config === 'string'
        ? JSON.parse(d.eligibility_config)
        : (d.eligibility_config || {})
    }))
  };
};

export const getAllCourseScholarshipDistributions = async () => {
  const courses = await query(
    'SELECT id, code, name, scholarship_amount, is_scholarship_active, is_active FROM courses ORDER BY id ASC'
  );
  const distributions = await query(
    'SELECT id, course_id, category, amount, is_active, eligibility_config, created_at, updated_at FROM course_scholarship_distributions ORDER BY course_id ASC, id ASC'
  );

  return courses.map(course => {
    const courseDist = distributions
      .filter(d => Number(d.course_id) === Number(course.id))
      .map(d => ({
        ...d,
        id: Number(d.id),
        course_id: Number(d.course_id),
        amount: parseFloat(d.amount || 0),
        is_active: Boolean(d.is_active),
        eligibility_config: typeof d.eligibility_config === 'string'
          ? JSON.parse(d.eligibility_config)
          : (d.eligibility_config || {})
      }));

    return {
      courseId: Number(course.id),
      courseCode: course.code,
      courseName: course.name,
      scholarshipAmount: parseFloat(course.scholarship_amount || 0),
      isScholarshipActive: Boolean(course.is_scholarship_active),
      isCourseActive: Boolean(course.is_active),
      distributions: courseDist,
      distributionsCount: courseDist.length,
      activeCount: courseDist.filter(d => d.is_active).length
    };
  });
};

export const saveCourseScholarshipDistributions = async (courseId, distributions, adminUser) => {
  const connection = await getConnection();
  try {
    await connection.beginTransaction();

    for (const d of distributions) {
      const category = d.category;
      const amount = parseFloat(d.amount || 0);
      const isActive = d.is_active !== undefined ? (d.is_active ? 1 : 0) : 1;
      const configStr = d.eligibility_config ? JSON.stringify(d.eligibility_config) : null;

      await connection.execute(
        `INSERT INTO course_scholarship_distributions (course_id, category, amount, is_active, eligibility_config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE amount = VALUES(amount), is_active = VALUES(is_active), eligibility_config = COALESCE(VALUES(eligibility_config), eligibility_config), updated_at = NOW()`,
        [courseId, category, amount, isActive, configStr]
      );
    }

    await connection.commit();
    return getCourseScholarshipDistributions(courseId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

/* =====================================================================
   SPECIALISATION MANAGEMENT MODEL METHODS
===================================================================== */

export const getAllSpecializations = async (queryParams = {}) => {
  const whereClauses = [];
  const params = [];

  if (queryParams.course_id) {
    whereClauses.push('s.course_id = ?');
    params.push(queryParams.course_id);
  }
  if (queryParams.status && queryParams.status !== 'all') {
    whereClauses.push('s.is_active = ?');
    params.push(queryParams.status === 'active' ? 1 : 0);
  }
  if (queryParams.search) {
    whereClauses.push('(s.name LIKE ? OR s.code LIKE ? OR c.name LIKE ?)');
    const q = `%${queryParams.search}%`;
    params.push(q, q, q);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const sql = `
    SELECT
      s.id,
      s.course_id,
      s.code,
      s.name,
      s.is_active,
      s.created_at,
      s.updated_at,
      c.name AS course_name,
      c.code AS course_code
    FROM specializations s
    INNER JOIN courses c ON c.id = s.course_id
    ${whereSql}
    ORDER BY s.course_id ASC, s.id ASC
  `;
  const rows = await query(sql, params);
  return rows.map(r => ({
    ...r,
    id: Number(r.id),
    course_id: Number(r.course_id),
    is_active: Boolean(r.is_active)
  }));
};

export const getSpecializationById = async (id) => {
  const sql = `
    SELECT
      s.id,
      s.course_id,
      s.code,
      s.name,
      s.is_active,
      s.created_at,
      s.updated_at,
      c.name AS course_name,
      c.code AS course_code
    FROM specializations s
    INNER JOIN courses c ON c.id = s.course_id
    WHERE s.id = ?
    LIMIT 1
  `;
  const rows = await query(sql, [id]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    ...r,
    id: Number(r.id),
    course_id: Number(r.course_id),
    is_active: Boolean(r.is_active)
  };
};

export const createSpecialization = async (payload) => {
  const res = await query(
    `INSERT INTO specializations (course_id, code, name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, NOW(), NOW())`,
    [payload.course_id, payload.code, payload.name, payload.is_active !== undefined ? payload.is_active : 1]
  );
  return getSpecializationById(res.insertId);
};

export const updateSpecialization = async (id, payload) => {
  const updates = [];
  const params = [];
  if (payload.course_id !== undefined) {
    updates.push('course_id = ?');
    params.push(payload.course_id);
  }
  if (payload.code !== undefined) {
    updates.push('code = ?');
    params.push(payload.code);
  }
  if (payload.name !== undefined) {
    updates.push('name = ?');
    params.push(payload.name);
  }
  if (payload.is_active !== undefined) {
    updates.push('is_active = ?');
    params.push(payload.is_active);
  }
  if (updates.length > 0) {
    updates.push('updated_at = NOW()');
    params.push(id);
    await query(`UPDATE specializations SET ${updates.join(', ')} WHERE id = ?`, params);
  }
  return getSpecializationById(id);
};

export const deleteOrDeactivateSpecialization = async (id) => {
  const enrollments = await query('SELECT COUNT(*) as count FROM enrollments WHERE specialization_id = ?', [id]);
  const count = Number(enrollments[0]?.count || 0);
  if (count > 0) {
    await query('UPDATE specializations SET is_active = 0, updated_at = NOW() WHERE id = ?', [id]);
    return {
      action: 'deactivated',
      id,
      message: `Specialisation is associated with ${count} student enrollment(s). It has been deactivated instead of deleted.`
    };
  }
  await query('DELETE FROM specializations WHERE id = ?', [id]);
  return {
    action: 'deleted',
    id,
    message: 'Specialisation deleted successfully.'
  };
};

export const updateSpecializationStatus = async (id, isActive) => {
  await query('UPDATE specializations SET is_active = ?, updated_at = NOW() WHERE id = ?', [isActive ? 1 : 0, id]);
  return getSpecializationById(id);
};

/* =====================================================================
   STUDENT SCHOLARSHIP DETAILS MODEL METHOD
===================================================================== */

export const getStudentScholarshipDetails = async (userId) => {
  const student = await getStudentById(userId);
  if (!student) return null;

  const claim = await getLatestScholarshipClaimByUserId(userId);
  const courseId = student.course_id || 1;
  const distributions = await query(
    'SELECT id, course_id, category, amount, is_active, eligibility_config FROM course_scholarship_distributions WHERE course_id = ? ORDER BY id ASC',
    [courseId]
  );

  return {
    student: {
      userId: student.user_id,
      studentId: student.student_id,
      applicationNo: student.application_no,
      fullName: student.full_name,
      email: student.email
    },
    course: {
      id: student.course_id,
      code: student.course_code,
      name: student.course_name,
      totalFee: parseFloat(student.total_fee || 0),
      registrationFee: parseFloat(student.registration_fee_amount || 0)
    },
    claim: claim ? {
      id: claim.id,
      status: claim.effective_status || claim.status,
      expiresAt: claim.expires_at,
      totalDiscount: parseFloat(claim.total_discount || 0),
      maxScholarship: parseFloat(claim.max_scholarship || 0),
      calculationSnapshot: claim.calculation_snapshot
        ? (typeof claim.calculation_snapshot === 'string'
            ? JSON.parse(claim.calculation_snapshot)
            : claim.calculation_snapshot)
        : null
    } : null,
    distributions: distributions.map(d => ({
      ...d,
      id: Number(d.id),
      course_id: Number(d.course_id),
      amount: parseFloat(d.amount || 0),
      is_active: Boolean(d.is_active),
      eligibility_config: typeof d.eligibility_config === 'string'
        ? JSON.parse(d.eligibility_config)
        : (d.eligibility_config || {})
    }))
  };
};



