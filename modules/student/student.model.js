import { query, getConnection } from '../../config/database.js';

export const getStudentProfile = async (identifier) => {
  if (!identifier) return null;
  const sql = `
    SELECT 
      u.id AS user_id,
      u.email,
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
      c.id AS course_id,
      c.code AS course_code,
      c.name AS course_name,
      s.id AS specialization_id,
      s.code AS specialization_code,
      s.name AS specialization_name
    FROM users u
    INNER JOIN student_profiles sp ON sp.user_id = u.id
    LEFT JOIN enrollments e ON e.user_id = u.id
    LEFT JOIN courses c ON c.id = e.course_id
    LEFT JOIN specializations s ON s.id = e.specialization_id
    WHERE u.id = ? OR u.email = ? OR sp.application_no = ? OR sp.student_id = ?
    LIMIT 1
  `;
  const rows = await query(sql, [identifier, identifier, identifier, identifier]);
  return rows[0] || null;
};

export const getStudentFeeAndPaymentSummary = async (userId) => {
  const sql = `
    SELECT 
      e.id AS enrollment_id,
      e.total_fee,
      e.amount_paid,
      e.outstanding_balance,
      e.scholarship_code,
      COALESCE(e.scholarship_amount, 0.00) AS scholarship_amount,
      COALESCE(e.original_total_fee, cf.total_fee, e.total_fee) AS original_total_fee,
      COALESCE(cf.total_fee, 350000.00) AS course_total_fee,
      COALESCE(cf.registration_fee, 3100.00) AS registration_fee,
      COALESCE(cf.admission_fee, 50000.00) AS admission_fee,
      COALESCE(cf.tuition_fee, 275000.00) AS tuition_fee,
      COALESCE(rp.final_reg_fee, 0.00) AS registration_fee_paid,
      rp.payment_status AS registration_payment_status,
      rp.payment_gateway AS registration_payment_gateway,
      rp.transaction_id AS registration_txn_id
    FROM enrollments e
    LEFT JOIN course_fees cf ON cf.course_id = e.course_id
    LEFT JOIN (
      SELECT user_id, final_reg_fee, payment_status, payment_gateway, transaction_id
      FROM registration_payments 
      WHERE user_id = ? AND payment_status = 'successful' 
      ORDER BY id DESC LIMIT 1
    ) rp ON rp.user_id = e.user_id
    WHERE e.user_id = ?
    LIMIT 1
  `;
  const rows = await query(sql, [userId, userId]);
  return rows[0] || null;
};

export const getStudentAcademicDetails = async (userId) => {
  const sql = `
    SELECT 
      sa.*,
      sp.student_id,
      sp.application_no,
      sp.first_name,
      sp.last_name,
      cf.total_fee AS course_total_fee,
      cf.registration_fee AS course_registration_fee,
      e.total_fee,
      e.amount_paid,
      c.name AS course_name,
      s.name AS specialization_name
    FROM student_academics sa
    LEFT JOIN student_profiles sp ON sp.user_id = sa.user_id
    LEFT JOIN enrollments e ON e.user_id = sa.user_id
    LEFT JOIN courses c ON c.id = e.course_id
    LEFT JOIN specializations s ON s.id = e.specialization_id
    LEFT JOIN course_fees cf ON cf.course_id = e.course_id
    WHERE sa.user_id = ?
    LIMIT 1
  `;
  const rows = await query(sql, [userId]);
  return rows[0] || null;
};

export const saveStudentAcademicDetails = async ({
  userId,
  studentProfileId,
  twelfth,
  ug,
  certifications,
  certificateUploads,
  promoCode,
  scholarshipAmount,
  scholarshipStatus
}) => {
  const certsJson = certifications ? JSON.stringify(certifications) : null;
  const certUploadsJson = certificateUploads ? JSON.stringify(certificateUploads) : null;
  const appliedAt = scholarshipAmount > 0 ? new Date() : null;

  const sql = `
    INSERT INTO student_academics (
      user_id, student_profile_id,
      twelfth_school, twelfth_board, twelfth_stream, twelfth_year, twelfth_percentage,
      ug_degree, ug_college, ug_specialization, ug_year, ug_percentage,
      certifications, certificate_uploads, promo_code, scholarship_amount, scholarship_status, applied_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      twelfth_school = VALUES(twelfth_school),
      twelfth_board = VALUES(twelfth_board),
      twelfth_stream = VALUES(twelfth_stream),
      twelfth_year = VALUES(twelfth_year),
      twelfth_percentage = VALUES(twelfth_percentage),
      ug_degree = VALUES(ug_degree),
      ug_college = VALUES(ug_college),
      ug_specialization = VALUES(ug_specialization),
      ug_year = VALUES(ug_year),
      ug_percentage = VALUES(ug_percentage),
      certifications = VALUES(certifications),
      certificate_uploads = VALUES(certificate_uploads),
      promo_code = VALUES(promo_code),
      scholarship_amount = VALUES(scholarship_amount),
      scholarship_status = VALUES(scholarship_status),
      applied_at = IF(VALUES(scholarship_amount) > 0, COALESCE(applied_at, NOW()), applied_at),
      updated_at = NOW()
  `;

  await query(sql, [
    userId,
    studentProfileId || null,
    twelfth?.school || null,
    twelfth?.board || null,
    twelfth?.stream || null,
    twelfth?.year || null,
    twelfth?.percentage || null,
    ug?.degree || null,
    ug?.college || null,
    ug?.specialization || null,
    ug?.year || null,
    ug?.percentage || null,
    certsJson,
    certUploadsJson,
    promoCode || null,
    scholarshipAmount || 0.00,
    scholarshipStatus || (scholarshipAmount > 0 ? 'applied' : 'not_applied'),
    appliedAt
  ]);

  // Update application status to 'scholarship_submitted' while preserving approved status if active
  await query(
    "UPDATE student_profiles SET application_status = IF(application_status = 'approved', 'approved', 'scholarship_submitted'), updated_at = NOW() WHERE user_id = ?",
    [userId]
  );
};

export const applyScholarshipToCourseFee = async ({ userId, promoCode, scholarshipAmount }) => {
  const sql = `
    UPDATE enrollments e
    LEFT JOIN course_fees cf ON cf.course_id = e.course_id
    SET 
      e.original_total_fee = COALESCE(e.original_total_fee, cf.total_fee, e.total_fee),
      e.scholarship_code = ?,
      e.scholarship_amount = ?,
      e.total_fee = GREATEST(0, COALESCE(e.original_total_fee, cf.total_fee, e.total_fee) - ?),
      e.outstanding_balance = GREATEST(0, GREATEST(0, COALESCE(e.original_total_fee, cf.total_fee, e.total_fee) - ?) - e.amount_paid),
      e.updated_at = NOW()
    WHERE e.user_id = ?
  `;
  await query(sql, [promoCode, scholarshipAmount, scholarshipAmount, scholarshipAmount, userId]);
};

export const getRegistrationFeeDetails = async (userId) => {
  const sql = `
    SELECT 
      u.id AS user_id,
      u.email,
      u.is_active,
      u.is_verified,
      sp.id AS student_profile_id,
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
      s.id AS specialization_id,
      s.name AS specialization_name,
      COALESCE(cf.total_fee, 350000.00) AS course_total_fee,
      COALESCE(cf.registration_fee, 3100.00) AS original_registration_fee,
      sa.promo_code,
      COALESCE(sa.scholarship_amount, 0.00) AS scholarship_amount,
      sa.scholarship_status,
      rp.id AS reg_payment_id,
      rp.order_id,
      rp.tid,
      rp.transaction_id,
      rp.tracking_id,
      rp.bank_ref_no,
      rp.payment_mode,
      COALESCE(rp.currency, 'INR') AS reg_currency,
      rp.original_reg_fee,
      rp.scholarship_discount,
      rp.final_reg_fee,
      rp.payment_status AS reg_payment_status,
      rp.payment_gateway AS reg_payment_gateway,
      rp.paid_at AS reg_paid_at
    FROM users u
    INNER JOIN student_profiles sp ON sp.user_id = u.id
    LEFT JOIN enrollments e ON e.user_id = u.id
    LEFT JOIN courses c ON c.id = e.course_id
    LEFT JOIN specializations s ON s.id = e.specialization_id
    LEFT JOIN course_fees cf ON cf.course_id = c.id
    LEFT JOIN student_academics sa ON sa.user_id = u.id
    LEFT JOIN (
      SELECT * FROM registration_payments
      WHERE user_id = ?
      ORDER BY (CASE WHEN payment_status = 'successful' THEN 0 ELSE 1 END), id DESC
      LIMIT 1
    ) rp ON rp.user_id = u.id
    WHERE u.id = ?
    LIMIT 1
  `;
  const rows = await query(sql, [userId, userId]);
  return rows[0] || null;
};

export const recordRegistrationPaymentOrder = async ({
  userId,
  studentProfileId,
  studentId,
  courseId,
  originalRegFee,
  scholarshipCode,
  scholarshipDiscount,
  finalRegFee,
  orderId,
  tid,
  merchantId,
  currency = 'INR',
  redirectUrl,
  cancelUrl,
  language = 'EN',
  billingName,
  billingEmail,
  courses,
  requestType = 'payment_initiation',
  paymentGateway = 'ccavenue'
}) => {
  const sql = `
    INSERT INTO registration_payments (
      user_id, student_profile_id, student_id, course_id,
      original_reg_fee, scholarship_code, scholarship_discount, final_reg_fee, amount,
      order_id, tid, merchant_id, currency, redirect_url, cancel_url, language,
      billing_name, billing_email, courses, request_type,
      payment_gateway, payment_type, payment_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registration_fee', 'pending')
  `;
  const result = await query(sql, [
    userId,
    studentProfileId || null,
    studentId || null,
    courseId,
    originalRegFee,
    scholarshipCode || null,
    scholarshipDiscount || 0.00,
    finalRegFee,
    finalRegFee,
    orderId,
    tid || null,
    merchantId || null,
    currency,
    redirectUrl || null,
    cancelUrl || null,
    language,
    billingName || null,
    billingEmail || null,
    courses || null,
    requestType,
    paymentGateway
  ]);

  // Update application_status to 'payment_pending' unless already approved
  await query(
    "UPDATE student_profiles SET application_status = IF(application_status = 'approved', 'approved', 'payment_pending') WHERE user_id = ?",
    [userId]
  );

  return result.insertId;
};

export const findRegistrationPaymentById = async (id) => {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;

  const sql = `
    SELECT 
      rp.*,
      u.email,
      u.is_active,
      sp.student_id,
      sp.application_no,
      sp.first_name,
      sp.last_name,
      sp.country_code,
      sp.mobile_number,
      CONCAT(sp.first_name, IF(sp.last_name IS NOT NULL AND sp.last_name != '', CONCAT(' ', sp.last_name), '')) AS full_name,
      c.name AS course_name,
      s.name AS specialization_name
    FROM registration_payments rp
    INNER JOIN users u ON u.id = rp.user_id
    LEFT JOIN student_profiles sp ON sp.user_id = u.id
    LEFT JOIN courses c ON c.id = rp.course_id
    LEFT JOIN enrollments e ON e.user_id = u.id AND e.course_id = rp.course_id
    LEFT JOIN specializations s ON s.id = e.specialization_id
    WHERE rp.id = ?
    LIMIT 1
  `;
  const rows = await query(sql, [numericId]);
  return rows[0] || null;
};

export const findRegistrationPaymentByOrderId = async (orderId) => {
  const sql = `
    SELECT 
      rp.*,
      u.email,
      u.is_active,
      sp.student_id,
      sp.application_no,
      sp.first_name,
      sp.last_name,
      sp.country_code,
      sp.mobile_number,
      CONCAT(sp.first_name, IF(sp.last_name IS NOT NULL AND sp.last_name != '', CONCAT(' ', sp.last_name), '')) AS full_name,
      c.name AS course_name,
      s.name AS specialization_name
    FROM registration_payments rp
    INNER JOIN users u ON u.id = rp.user_id
    LEFT JOIN student_profiles sp ON sp.user_id = u.id
    LEFT JOIN courses c ON c.id = rp.course_id
    LEFT JOIN enrollments e ON e.user_id = u.id AND e.course_id = rp.course_id
    LEFT JOIN specializations s ON s.id = e.specialization_id
    WHERE rp.order_id = ?
    LIMIT 1
  `;
  const rows = await query(sql, [orderId]);
  return rows[0] || null;
};

export const completeRegistrationPayment = async ({
  orderId,
  transactionId,
  trackingId,
  bankRefNo,
  paymentMode,
  rawResponse
}) => {
  const connection = await getConnection();
  try {
    await connection.beginTransaction();

    // 1. Fetch order lock
    const [orders] = await connection.execute(
      'SELECT * FROM registration_payments WHERE order_id = ? FOR UPDATE',
      [orderId]
    );

    if (orders.length === 0) {
      throw new Error(`Registration payment order ${orderId} not found`);
    }

    const order = orders[0];

    // Idempotency check: if already successful, return early without duplicate side effects
    if (order.payment_status === 'successful') {
      await connection.commit();
      return {
        alreadyProcessed: true,
        order
      };
    }

    const rawResponseStr = rawResponse ? JSON.stringify(rawResponse) : null;
    const resolvedTxnId = transactionId || trackingId || bankRefNo || orderId;

    // 2. Update registration_payments to successful
    await connection.execute(
      `UPDATE registration_payments 
       SET payment_status = 'successful',
           paid_at = NOW(),
           transaction_id = ?,
           tracking_id = COALESCE(?, tracking_id),
           bank_ref_no = COALESCE(?, bank_ref_no),
           payment_mode = COALESCE(?, payment_mode),
           payment_type = 'registration_fee',
           raw_response = ?,
           gateway_response = ?,
           updated_at = NOW()
       WHERE order_id = ?`,
      [
        resolvedTxnId,
        trackingId || null,
        bankRefNo || null,
        paymentMode || null,
        rawResponseStr,
        rawResponseStr,
        orderId
      ]
    );

    // 3. Update student_profiles application_status to 'approved'
    await connection.execute(
      "UPDATE student_profiles SET application_status = 'approved', updated_at = NOW() WHERE user_id = ?",
      [order.user_id]
    );

    // 4. Update users is_active = 1 (Account Activated!)
    await connection.execute(
      "UPDATE users SET is_active = 1, updated_at = NOW() WHERE id = ?",
      [order.user_id]
    );

    await connection.commit();

    return {
      alreadyProcessed: false,
      activated: true,
      order: {
        ...order,
        payment_status: 'successful',
        transaction_id: resolvedTxnId,
        tracking_id: trackingId || order.tracking_id || null,
        bank_ref_no: bankRefNo || order.bank_ref_no || null,
        payment_mode: paymentMode || order.payment_mode || null,
        paid_at: new Date()
      }
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const updateNonSuccessRegistrationPayment = async ({
  orderId,
  paymentStatus = 'failed',
  trackingId,
  bankRefNo,
  paymentMode,
  rawResponse
}) => {
  const connection = await getConnection();
  try {
    await connection.beginTransaction();

    const [orders] = await connection.execute(
      'SELECT * FROM registration_payments WHERE order_id = ? FOR UPDATE',
      [orderId]
    );

    if (orders.length === 0) {
      await connection.commit();
      return null;
    }

    const order = orders[0];

    // Security guard: never overwrite an already successful transaction with failed/stale/cancelled status
    if (order.payment_status === 'successful') {
      await connection.commit();
      return {
        alreadySuccessful: true,
        order
      };
    }

    const allowedStatuses = ['pending', 'failed', 'cancelled'];
    const targetStatus = allowedStatuses.includes(paymentStatus) ? paymentStatus : 'failed';
    const rawResponseStr = rawResponse ? JSON.stringify(rawResponse) : null;

    await connection.execute(
      `UPDATE registration_payments
       SET payment_status = ?,
           tracking_id = COALESCE(?, tracking_id),
           bank_ref_no = COALESCE(?, bank_ref_no),
           payment_mode = COALESCE(?, payment_mode),
           raw_response = ?,
           gateway_response = ?,
           updated_at = NOW()
       WHERE order_id = ?`,
      [
        targetStatus,
        trackingId || null,
        bankRefNo || null,
        paymentMode || null,
        rawResponseStr,
        rawResponseStr,
        orderId
      ]
    );

    const nextAppStatus = targetStatus === 'pending' ? 'payment_pending' : 'payment_failed';
    await connection.execute(
      "UPDATE student_profiles SET application_status = IF(application_status = 'approved', 'approved', ?), updated_at = NOW() WHERE user_id = ?",
      [nextAppStatus, order.user_id]
    );

    await connection.commit();

    return {
      alreadySuccessful: false,
      order: {
        ...order,
        payment_status: targetStatus,
        tracking_id: trackingId || order.tracking_id || null,
        bank_ref_no: bankRefNo || order.bank_ref_no || null,
        payment_mode: paymentMode || order.payment_mode || null
      }
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const getScholarshipCodeFromDb = async (code) => {
  const rows = await query('SELECT * FROM scholarship_codes WHERE code = ? AND is_active = 1 LIMIT 1', [code]);
  return rows[0] || null;
};

export const getStudentPayments = async (userId) => {
  const coursePaymentsSql = `
    SELECT 
      p.id AS payment_id,
      NULL AS order_id,
      p.transaction_id,
      NULL AS tracking_id,
      NULL AS bank_ref_no,
      p.payment_method AS payment_mode,
      p.amount,
      p.currency,
      p.payment_method,
      'course_fee' AS payment_type,
      p.payment_status,
      p.receipt_url,
      p.paid_at,
      p.created_at
    FROM payments p
    WHERE p.user_id = ?
    ORDER BY p.paid_at DESC
  `;

  const regPaymentsSql = `
    SELECT 
      CONCAT('REG-', rp.id) AS payment_id,
      rp.order_id,
      COALESCE(rp.transaction_id, rp.tracking_id, rp.order_id) AS transaction_id,
      rp.tracking_id,
      rp.bank_ref_no,
      rp.payment_mode,
      rp.final_reg_fee AS amount,
      COALESCE(rp.currency, 'INR') AS currency,
      rp.payment_gateway AS payment_method,
      'registration_fee' AS payment_type,
      rp.payment_status,
      NULL AS receipt_url,
      COALESCE(rp.paid_at, rp.created_at) AS paid_at,
      rp.created_at
    FROM registration_payments rp
    WHERE rp.user_id = ?
    ORDER BY COALESCE(rp.paid_at, rp.created_at) DESC
  `;

  const coursePayments = await query(coursePaymentsSql, [userId]);
  let regPayments = [];
  try {
    regPayments = await query(regPaymentsSql, [userId]);
  } catch (err) {
    // Fallback if registration_payments table is unavailable in an older schema
    regPayments = [];
  }

  return [...coursePayments, ...regPayments].sort((a, b) => {
    const dateA = new Date(a.paid_at || a.created_at || 0).getTime();
    const dateB = new Date(b.paid_at || b.created_at || 0).getTime();
    return dateB - dateA;
  });
};
