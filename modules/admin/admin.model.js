import { query } from '../../config/database.js';

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

