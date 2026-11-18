import { query, getConnection } from '../../config/database.js';

export const findUserByEmail = async (email) => {
  const rows = await query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  return rows[0] || null;
};

export const findProfileByMobile = async (mobileNumber) => {
  const rows = await query('SELECT * FROM student_profiles WHERE mobile_number = ? LIMIT 1', [mobileNumber]);
  return rows[0] || null;
};

export const findUserById = async (userId) => {
  const sql = `
    SELECT 
      u.id AS user_id,
      u.email,
      u.role,
      u.is_active,
      u.is_verified,
      u.created_at AS user_created_at,
      sp.id AS profile_id,
      sp.student_id,
      sp.application_no,
      sp.first_name,
      sp.last_name,
      CONCAT(sp.first_name, IF(sp.last_name IS NOT NULL AND sp.last_name != '', CONCAT(' ', sp.last_name), '')) AS full_name,
      sp.country_code,
      sp.mobile_number,
      sp.application_status,
      c.id AS course_id,
      c.name AS course_name,
      s.id AS specialization_id,
      s.name AS specialization_name,
      e.enrollment_status
    FROM users u
    LEFT JOIN student_profiles sp ON sp.user_id = u.id
    LEFT JOIN enrollments e ON e.user_id = u.id
    LEFT JOIN courses c ON c.id = e.course_id
    LEFT JOIN specializations s ON s.id = e.specialization_id
    WHERE u.id = ?
    LIMIT 1
  `;
  const rows = await query(sql, [userId]);
  return rows[0] || null;
};

export const validateCourseAndSpecialization = async (courseId, specializationId) => {
  const sql = `
    SELECT s.id AS specialization_id, s.name AS specialization_name, c.id AS course_id, c.name AS course_name
    FROM specializations s
    INNER JOIN courses c ON c.id = s.course_id
    WHERE s.id = ? AND s.course_id = ? AND s.is_active = 1 AND c.is_active = 1
    LIMIT 1
  `;
  const rows = await query(sql, [specializationId, courseId]);
  return rows[0] || null;
};

export const verifyCourseAndSpecializationForRegistration = async (courseId, specializationId, connection = null) => {
  const cId = Number(courseId);
  const sId = Number(specializationId);

  // 1. Verify Course exists
  const courseSql = connection ? 'SELECT id, name, code, is_active FROM courses WHERE id = ? FOR UPDATE' : 'SELECT id, name, code, is_active FROM courses WHERE id = ?';
  const courseRows = connection ? (await connection.execute(courseSql, [cId]))[0] : await query(courseSql, [cId]);
  const course = courseRows[0];
  if (!course) {
    const error = new Error('Selected course does not exist');
    error.statusCode = 400;
    throw error;
  }

  // 2. Verify Course is active
  if (!course.is_active) {
    const error = new Error(`Course '${course.name}' is currently inactive and not accepting registrations`);
    error.statusCode = 400;
    throw error;
  }

  // 3. Verify Specialisation exists
  const specSql = connection ? 'SELECT id, course_id, name, code, is_active FROM specializations WHERE id = ? FOR UPDATE' : 'SELECT id, course_id, name, code, is_active FROM specializations WHERE id = ?';
  const specRows = connection ? (await connection.execute(specSql, [sId]))[0] : await query(specSql, [sId]);
  const spec = specRows[0];
  if (!spec) {
    const error = new Error('Selected specialisation does not exist');
    error.statusCode = 400;
    throw error;
  }

  // 4. Verify Specialisation belongs to selected course
  if (spec.course_id !== cId) {
    const error = new Error(`Selected specialisation '${spec.name}' does not belong to course '${course.name}'`);
    error.statusCode = 400;
    throw error;
  }

  // 5. Verify Specialisation is active
  if (!spec.is_active) {
    const error = new Error(`Specialisation '${spec.name}' is currently inactive and not accepting registrations`);
    error.statusCode = 400;
    throw error;
  }

  return {
    course_id: course.id,
    course_name: course.name,
    specialization_id: spec.id,
    specialization_name: spec.name
  };
};

export const getActiveSpecializationsByCourseId = async (courseId) => {
  const sql = `
    SELECT s.id, s.course_id, s.code, s.name, s.is_active
    FROM specializations s
    INNER JOIN courses c ON c.id = s.course_id
    WHERE s.course_id = ? AND s.is_active = 1 AND c.is_active = 1
    ORDER BY s.id ASC
  `;
  return query(sql, [courseId]);
};

export const getCourseFeeByCourseId = async (courseId) => {
  const rows = await query('SELECT * FROM course_fees WHERE course_id = ? LIMIT 1', [courseId]);
  return rows[0] || null;
};

export const registerStudentTransaction = async ({ userData, profileData, enrollmentData }) => {
  const connection = await getConnection();
  try {
    await connection.beginTransaction();

    // 0. Verify course & specialisation are valid and active within the transaction
    await verifyCourseAndSpecializationForRegistration(
      enrollmentData.courseId,
      enrollmentData.specializationId,
      connection
    );

    // 1. Insert into users with is_active = 0, is_verified = 0
    const [userResult] = await connection.execute(
      'INSERT INTO users (email, password_hash, role, is_active, is_verified) VALUES (?, ?, ?, 0, 0)',
      [userData.email, userData.passwordHash, 'student']
    );
    const userId = userResult.insertId;

    // 2. Insert into student_profiles with application_status = 'pending_verification'
    const [profileResult] = await connection.execute(
      `INSERT INTO student_profiles 
        (user_id, student_id, application_no, first_name, last_name, country_code, mobile_number, terms_accepted, application_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification')`,
      [
        userId,
        profileData.studentId,
        profileData.applicationNo,
        profileData.firstName,
        profileData.lastName || null,
        profileData.countryCode,
        profileData.mobileNumber,
        profileData.termsAccepted ? 1 : 0
      ]
    );
    const profileId = profileResult.insertId;

    // 3. Insert into enrollments
    await connection.execute(
      `INSERT INTO enrollments 
        (user_id, student_profile_id, course_id, specialization_id, enrollment_status, total_fee, original_total_fee, registration_fee, amount_paid, outstanding_balance)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, 0.00, ?)`,
      [
        userId,
        profileId,
        enrollmentData.courseId,
        enrollmentData.specializationId,
        enrollmentData.totalFee,
        enrollmentData.totalFee,
        enrollmentData.registrationFee != null ? enrollmentData.registrationFee : 0.00,
        enrollmentData.totalFee
      ]
    );

    await connection.commit();
    return { userId, profileId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const createOtpRecord = async ({ userId, otpHash, purpose = 'registration', expiryMinutes = 10 }) => {
  // Invalidate any existing unused OTPs for this user and purpose
  await query(
    'UPDATE user_otps SET is_used = 1 WHERE user_id = ? AND purpose = ? AND is_used = 0',
    [userId, purpose]
  );

  const result = await query(
    `INSERT INTO user_otps (user_id, otp_hash, purpose, expires_at, attempts, max_attempts, is_used, last_sent_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 0, 5, 0, NOW())`,
    [userId, otpHash, purpose, expiryMinutes]
  );
  return result.insertId;
};

export const findActiveOtp = async (userId, purpose = 'registration') => {
  const rows = await query(
    `SELECT *, (expires_at < NOW()) AS is_expired FROM user_otps 
     WHERE user_id = ? AND purpose = ? AND is_used = 0 
     ORDER BY created_at DESC 
     LIMIT 1`,
    [userId, purpose]
  );
  return rows[0] || null;
};

export const getLatestOtp = async (userId, purpose = 'registration') => {
  const rows = await query(
    `SELECT *, TIMESTAMPDIFF(SECOND, last_sent_at, NOW()) AS elapsed_seconds FROM user_otps 
     WHERE user_id = ? AND purpose = ? 
     ORDER BY created_at DESC 
     LIMIT 1`,
    [userId, purpose]
  );
  return rows[0] || null;
};

export const incrementOtpAttempts = async (otpId) => {
  return query('UPDATE user_otps SET attempts = attempts + 1 WHERE id = ?', [otpId]);
};

export const markOtpUsed = async (otpId) => {
  return query('UPDATE user_otps SET is_used = 1 WHERE id = ?', [otpId]);
};

export const markUserVerified = async (userId) => {
  await query('UPDATE users SET is_verified = 1, is_active = 1, updated_at = NOW() WHERE id = ?', [userId]);
  await query(
    "UPDATE student_profiles SET application_status = 'email_verified', updated_at = NOW() WHERE user_id = ? AND application_status = 'pending_verification'",
    [userId]
  );
  return true;
};

export const activateUser = async (userId) => {
  await query('UPDATE users SET is_active = 1 WHERE id = ?', [userId]);
  await query(
    "UPDATE student_profiles SET application_status = 'approved' WHERE user_id = ?",
    [userId]
  );
  return true;
};

export const updateApplicationStatus = async (userId, status) => {
  return query('UPDATE student_profiles SET application_status = ? WHERE user_id = ?', [status, userId]);
};

export const updateUserPassword = async (userId, passwordHash) => {
  return query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [passwordHash, userId]);
};

export const getAllActiveCoursesWithSpecializations = async () => {
  const sql = `
    SELECT 
      c.id, 
      c.code, 
      c.name, 
      c.description, 
      c.course_type,
      c.scholarship_amount,
      c.is_scholarship_active,
      COALESCE(cf.total_fee, 0.00) AS total_fee,
      COALESCE(cf.registration_fee, 0.00) AS registration_fee,
      COALESCE(cf.tuition_fee, 0.00) AS tuition_fee
    FROM courses c
    LEFT JOIN course_fees cf ON cf.course_id = c.id
    WHERE c.is_active = 1 
    ORDER BY c.id ASC
  `;
  const courses = await query(sql);
  const specializations = await query('SELECT id, course_id, code, name FROM specializations WHERE is_active = 1 ORDER BY course_id ASC, id ASC');

  return courses.map((course) => ({
    ...course,
    total_fee: parseFloat(course.total_fee || 0),
    registration_fee: parseFloat(course.registration_fee || 0),
    tuition_fee: parseFloat(course.tuition_fee || 0),
    scholarship_amount: parseFloat(course.scholarship_amount || 0),
    is_scholarship_active: Boolean(course.is_scholarship_active),
    specializations: specializations.filter((s) => s.course_id === course.id)
  }));
};

export const findCourseById = async (courseId) => {
  const rows = await query('SELECT id, name, code, is_active FROM courses WHERE id = ?', [courseId]);
  return rows[0] || null;
};
