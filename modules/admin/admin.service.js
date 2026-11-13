import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import * as AdminModel from './admin.model.js';
import * as StudentModel from '../student/student.model.js';

const parsePositiveId = (rawId, label = 'ID') => {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error(`Invalid ${label}`);
    error.statusCode = 400;
    throw error;
  }
  return id;
};

const safeParseGatewayResponse = (raw) => {
  if (!raw) return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { rawText: String(raw).slice(0, 500) };
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;

  // Strip any unexpected sensitive keys just in case
  const clone = { ...parsed };
  delete clone.password;
  delete clone.password_hash;
  delete clone.otp;
  delete clone.token;
  delete clone.verificationToken;
  return clone;
};

const extractTrackingId = (parsedResponse) => {
  if (!parsedResponse || typeof parsedResponse !== 'object') return null;
  return (
    parsedResponse.tracking_id ||
    parsedResponse.trackingId ||
    parsedResponse.bank_ref_no ||
    // Read-only fallback for preserved historical Razorpay rows
    parsedResponse.razorpay_payment_id ||
    null
  );
};

const formatPaymentRecord = (row) => {
  const gatewayResponse = safeParseGatewayResponse(row.raw_response);
  const trackingId = row.tracking_id || extractTrackingId(gatewayResponse);

  return {
    id: row.record_id,
    userId: row.user_id,
    studentId: row.student_id || null,
    applicationNo: row.application_no || null,
    studentName: row.full_name || null,
    email: row.email || null,
    courseName: row.course_name || null,
    paymentType: row.payment_type,
    orderId: row.order_id || null,
    transactionId: row.transaction_id || null,
    trackingId,
    bankRefNo: row.bank_ref_no || gatewayResponse?.bank_ref_no || null,
    paymentMode: row.payment_mode || gatewayResponse?.payment_mode || null,
    amount: parseFloat(row.amount || 0),
    currency: row.currency || 'INR',
    paymentGateway: row.payment_gateway || null,
    rawStatus: row.raw_payment_status,
    paymentStatus: row.display_status,
    paidAt: row.paid_at || null,
    createdAt: row.created_at,
    gatewayResponse
  };
};

export const loginAdmin = async (email, password) => {
  const user = await AdminModel.findAdminByEmail(email);
  if (!user) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  if (user.role !== 'admin') {
    const error = new Error('Access denied: Administrator privileges required.');
    error.statusCode = 403;
    throw error;
  }

  if (!user.is_active) {
    const error = new Error('Administrator account is disabled.');
    error.statusCode = 403;
    throw error;
  }

  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: 'admin'
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: Boolean(user.is_active),
      createdAt: user.created_at
    }
  };
};

export const getAdminMe = async (adminId) => {
  const user = await AdminModel.findAdminById(adminId);
  if (!user || user.role !== 'admin') {
    const error = new Error('Administrator account not found');
    error.statusCode = 404;
    throw error;
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    isActive: Boolean(user.is_active),
    createdAt: user.created_at,
    updatedAt: user.updated_at
  };
};

export const getDashboardStats = async (filters) => {
  return AdminModel.getDashboardStats(filters);
};

export const getStudents = async (filters) => {
  const result = await AdminModel.getStudentsPaginated(filters);

  const students = result.rows.map((row) => ({
    id: row.user_id,
    userId: row.user_id,
    studentId: row.student_id,
    applicationNo: row.application_no,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: row.full_name,
    email: row.email,
    countryCode: row.country_code,
    mobileNumber: row.mobile_number,
    phone: `${row.country_code || '+91'} ${row.mobile_number || ''}`.trim(),
    courseId: row.course_id || null,
    courseCode: row.course_code || null,
    courseName: row.course_name || 'N/A',
    specializationName: row.specialization_name || null,
    registrationDate: row.registration_date,
    emailVerified: Boolean(row.is_verified),
    isActive: Boolean(row.is_active),
    applicationStatus: row.application_status,
    registrationFeeAmount: parseFloat(row.registration_fee_amount || 0),
    paymentStatus: row.payment_status,
    paymentOrderId: row.payment_order_id || null,
    paymentTransactionId: row.payment_transaction_id || null,
    paymentGateway: row.payment_gateway || null,
    paymentDate: row.payment_date || null
  }));

  return {
    students,
    pagination: result.pagination
  };
};

export const getStudentById = async (rawId) => {
  const userId = parsePositiveId(rawId, 'student ID');
  const student = await AdminModel.getStudentById(userId);
  if (!student) {
    const error = new Error('Student not found');
    error.statusCode = 404;
    throw error;
  }

  const academicDetails = await StudentModel.getStudentAcademicDetails(userId);
  const paymentRows = await AdminModel.getPaymentsByStudentId(userId);
  const parsedLatestGateway = safeParseGatewayResponse(student.latest_raw_response);
  const claim = await AdminModel.getLatestScholarshipClaimByUserId(userId);

  return {
    personalInfo: {
      id: student.user_id,
      userId: student.user_id,
      studentId: student.student_id,
      applicationNo: student.application_no,
      firstName: student.first_name,
      lastName: student.last_name,
      fullName: student.full_name,
      email: student.email,
      countryCode: student.country_code,
      mobileNumber: student.mobile_number,
      phone: `${student.country_code || '+91'} ${student.mobile_number || ''}`.trim()
    },
    registrationInfo: {
      registrationDate: student.registration_date,
      emailVerified: Boolean(student.is_verified),
      isActive: Boolean(student.is_active),
      applicationStatus: student.application_status,
      enrollmentStatus: student.enrollment_status || 'pending'
    },
    courseInfo: {
      courseId: student.course_id,
      courseCode: student.course_code,
      courseName: student.course_name || 'N/A',
      specializationId: student.specialization_id,
      specializationCode: student.specialization_code,
      specializationName: student.specialization_name || 'N/A',
      originalTotalFee: parseFloat(student.original_total_fee || 0),
      totalCourseFee: parseFloat(student.total_fee || 0),
      amountPaid: parseFloat(student.amount_paid || 0),
      outstandingBalance: parseFloat(student.outstanding_balance || 0)
    },
    scholarshipInfo: academicDetails
      ? {
          promoCode: academicDetails.promo_code || student.scholarship_code || null,
          scholarshipAmount: parseFloat(
            academicDetails.scholarship_amount || student.enrollment_scholarship_amount || 0
          ),
          scholarshipStatus: academicDetails.scholarship_status || 'not_applied',
          appliedAt: academicDetails.applied_at || null,
          twelfth: {
            school: academicDetails.twelfth_school,
            board: academicDetails.twelfth_board,
            stream: academicDetails.twelfth_stream,
            year: academicDetails.twelfth_year,
            percentage: academicDetails.twelfth_percentage
          },
          ug: {
            degree: academicDetails.ug_degree,
            college: academicDetails.ug_college,
            specialization: academicDetails.ug_specialization,
            year: academicDetails.ug_year,
            percentage: academicDetails.ug_percentage
          }
        }
      : {
          promoCode: student.scholarship_code || null,
          scholarshipAmount: parseFloat(student.enrollment_scholarship_amount || 0),
          scholarshipStatus: student.enrollment_scholarship_amount > 0 ? 'applied' : 'not_applied',
          appliedAt: null
        },
    scholarshipClaim: claim
      ? {
          id: claim.id,
          totalDiscount: parseFloat(claim.total_discount || 0),
          status: claim.effective_status || claim.status,
          rawStatus: claim.status,
          expiresAt: claim.expires_at,
          isExpired: (claim.effective_status || claim.status) === 'expired',
          createdAt: claim.created_at
        }
      : null,
    registrationPayment: {
      paymentStatus: student.effective_payment_status,
      rawStatus: student.raw_payment_status || null,
      amount: parseFloat(student.registration_fee_amount || 0),
      orderId: student.latest_order_id || null,
      transactionId: student.latest_transaction_id || null,
      trackingId: student.latest_tracking_id || extractTrackingId(parsedLatestGateway),
      bankRefNo: student.latest_bank_ref_no || parsedLatestGateway?.bank_ref_no || null,
      paymentMode: student.latest_payment_mode || parsedLatestGateway?.payment_mode || null,
      paymentGateway: student.payment_gateway || null,
      paidAt: student.latest_paid_at || null,
      gatewayResponse: parsedLatestGateway
    },
    transactions: paymentRows.map(formatPaymentRecord)
  };
};

export const getStudentPayments = async (rawId) => {
  const userId = parsePositiveId(rawId, 'student ID');
  const student = await AdminModel.getStudentById(userId);
  if (!student) {
    const error = new Error('Student not found');
    error.statusCode = 404;
    throw error;
  }

  const rows = await AdminModel.getPaymentsByStudentId(userId);
  return {
    student: {
      userId: student.user_id,
      studentId: student.student_id,
      applicationNo: student.application_no,
      fullName: student.full_name,
      email: student.email
    },
    payments: rows.map(formatPaymentRecord)
  };
};

export const getPayments = async (filters) => {
  const result = await AdminModel.getPaymentsPaginated(filters);
  return {
    payments: result.rows.map(formatPaymentRecord),
    summary: result.summary,
    pagination: result.pagination
  };
};

export const getScholarshipTimer = async () => {
  const val = await AdminModel.getSystemSetting('scholarship_timer_hours');
  const hours = val !== null && !isNaN(parseInt(val, 10)) ? parseInt(val, 10) : 2;
  return {
    hours,
    scholarship_timer_hours: hours
  };
};

export const updateScholarshipTimer = async (hoursInput) => {
  const hours = parseInt(hoursInput, 10);
  if (isNaN(hours) || hours < 1 || hours > 168) {
    const error = new Error('Scholarship timer hours must be an integer between 1 and 168 (1 week).');
    error.statusCode = 400;
    throw error;
  }
  await AdminModel.upsertSystemSetting('scholarship_timer_hours', hours);
  return {
    hours,
    scholarship_timer_hours: hours
  };
};

export const reactivateStudentTimer = async (rawId, minutesInput) => {
  const userId = parsePositiveId(rawId, 'student ID');
  const student = await AdminModel.getStudentById(userId);
  if (!student) {
    const error = new Error('Student not found');
    error.statusCode = 404;
    throw error;
  }

  const minutes = parseInt(minutesInput, 10);
  if (isNaN(minutes) || minutes < 1 || minutes > 10080) {
    const error = new Error('Please enter a valid duration between 1 and 10080 minutes (max 7 days).');
    error.statusCode = 400;
    throw error;
  }

  const claim = await AdminModel.getLatestScholarshipClaimByUserId(userId);
  if (!claim) {
    const error = new Error('No scholarship claim found for this student to reactivate.');
    error.statusCode = 404;
    throw error;
  }

  // Prevent reactivating locked_in or used claims
  if (claim.status === 'locked_in') {
    const error = new Error('Cannot reactivate scholarship: claim is already locked in.');
    error.statusCode = 400;
    throw error;
  }
  if (claim.status === 'used') {
    const error = new Error('Cannot reactivate scholarship: claim has already been used.');
    error.statusCode = 400;
    throw error;
  }

  // Only allow reactivation for expired claims
  const isExpired = claim.status === 'expired' || claim.effective_status === 'expired';
  if (!isExpired) {
    const error = new Error('Scholarship timer is currently active. Reactivation is only available for expired claims.');
    error.statusCode = 400;
    throw error;
  }

  const updatedClaim = await AdminModel.reactivateScholarshipClaim(claim.id, minutes);

  return {
    studentId: student.student_id,
    userId,
    claimId: updatedClaim?.id,
    status: 'active',
    total_discount: parseFloat(updatedClaim?.total_discount || 0),
    minutes,
    expiresAt: updatedClaim?.expires_at,
    expires_at: updatedClaim?.expires_at
  };
};


