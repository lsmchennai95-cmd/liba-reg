import crypto from 'crypto';
import * as StudentModel from './student.model.js';
import {
  getScholarshipByCode,
  getCourseScholarshipConfig,
  calculateScholarshipBreakdown
} from './scholarship.constants.js';
import { sendPaymentSuccessEmail } from '../../mail/payment-success-mail.js';
import { sendPaymentFailedEmail } from '../../mail/payment-failed-mail.js';
import { triggerPaymentSuccessNotification } from '../notification/notification.service.js';
import * as CcavenueService from '../../services/ccavenue.service.js';
import { createSafeError, logException, SAFE_MESSAGES } from '../../services/errorLogger.service.js';
import { env } from '../../config/env.js';

export const getStudentProfile = async (userId) => {
  const profile = await StudentModel.getStudentProfile(userId);
  if (!profile) {
    const error = new Error('Student profile not found');
    error.statusCode = 404;
    throw error;
  }

  const effectiveUserId = profile.user_id;
  const academicDetails = await StudentModel.getStudentAcademicDetails(effectiveUserId);
  const feeSummary = await StudentModel.getStudentFeeAndPaymentSummary(effectiveUserId);

  const courseCodeOrName = profile.course_code || profile.course_name || 'PGDM';
  const courseConfig = getCourseScholarshipConfig(courseCodeOrName);

  let scholarshipBreakdown = null;
  if (academicDetails && courseConfig.isEligible) {
    scholarshipBreakdown = calculateScholarshipBreakdown({
      courseCodeOrName,
      twelfthPercentage: academicDetails.twelfth_percentage,
      ugPercentage: academicDetails.ug_percentage,
      promoCodeAmount: academicDetails.scholarship_amount || 0
    });
  }

  return {
    studentInfo: {
      studentId: profile.student_id,
      applicationNumber: profile.application_no,
      firstName: profile.first_name,
      lastName: profile.last_name,
      fullName: profile.full_name,
      email: profile.email,
      countryCode: profile.country_code,
      mobileNumber: profile.mobile_number,
      registrationDate: profile.registration_date,
      isActive: Boolean(profile.is_active),
      isVerified: Boolean(profile.is_verified)
    },
    academicInfo: {
      courseId: profile.course_id,
      courseCode: profile.course_code,
      courseName: profile.course_name,
      courseType: courseConfig.type,
      isScholarshipEligible: courseConfig.isEligible,
      scholarshipCap: courseConfig.maxScholarship,
      scholarshipMessage: courseConfig.message,
      specializationId: profile.specialization_id,
      specializationCode: profile.specialization_code,
      specializationName: profile.specialization_name,
      applicationStatus: profile.application_status,
      enrollmentStatus: profile.enrollment_status
    },
    academics: academicDetails ? {
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
      },
      certifications: typeof academicDetails.certifications === 'string'
        ? JSON.parse(academicDetails.certifications || '[]')
        : (academicDetails.certifications || []),
      scholarship: {
        promoCode: academicDetails.promo_code,
        scholarshipAmount: parseFloat(academicDetails.scholarship_amount || 0),
        scholarshipStatus: academicDetails.scholarship_status,
        appliedAt: academicDetails.applied_at,
        breakdown: scholarshipBreakdown
      }
    } : null,
    feeInfo: feeSummary ? {
      originalTotalFee: parseFloat(feeSummary.original_total_fee || feeSummary.course_total_fee || 0),
      scholarshipAmount: parseFloat(feeSummary.scholarship_amount || 0),
      scholarshipBreakdown,
      totalCourseFee: parseFloat(feeSummary.total_fee || 0),
      registrationFeePaid: parseFloat(feeSummary.registration_fee_paid || 0),
      registrationPaymentStatus: feeSummary.registration_payment_status || 'unpaid',
      amountPaid: parseFloat(feeSummary.amount_paid || 0),
      outstandingBalance: parseFloat(feeSummary.outstanding_balance || 0)
    } : null
  };
};

export const getStudentDashboard = async (userId) => {
  const profile = await StudentModel.getStudentProfile(userId);
  if (!profile) {
    const error = new Error('Student profile not found');
    error.statusCode = 404;
    throw error;
  }

  const feeSummary = await StudentModel.getStudentFeeAndPaymentSummary(userId);
  const regFeeDetails = await StudentModel.getRegistrationFeeDetails(userId);
  const payments = await StudentModel.getStudentPayments(userId);
  const academicDetails = await StudentModel.getStudentAcademicDetails(userId);

  const courseCodeOrName = profile.course_code || profile.course_name || 'PGDM';
  const courseConfig = getCourseScholarshipConfig(courseCodeOrName);

  // Financial Business Rule:
  // Registration Fee and Course Fee are two completely separate financial transactions.
  // Scholarship applies EXCLUSIVELY to the Course Fee, never to the Registration Fee.
  const originalTotalFee = feeSummary ? parseFloat(feeSummary.original_total_fee) : 350000.00;
  const scholarshipAmount = feeSummary ? parseFloat(feeSummary.scholarship_amount || 0.00) : 0.00;
  const scholarshipCode = feeSummary?.scholarship_code || null;
  const totalCourseFee = feeSummary
    ? parseFloat(feeSummary.total_fee)
    : Math.max(0, originalTotalFee - scholarshipAmount);
  const totalAmountPaid = feeSummary ? parseFloat(feeSummary.amount_paid || 0.00) : 0.00;
  const outstandingBalance = feeSummary
    ? parseFloat(feeSummary.outstanding_balance)
    : Math.max(0, totalCourseFee - totalAmountPaid);
  const registrationFeePaid = feeSummary ? parseFloat(feeSummary.registration_fee_paid || 0.00) : 0.00;

  let scholarshipBreakdown = null;
  if (academicDetails && courseConfig.isEligible) {
    scholarshipBreakdown = calculateScholarshipBreakdown({
      courseCodeOrName,
      twelfthPercentage: academicDetails.twelfth_percentage,
      ugPercentage: academicDetails.ug_percentage,
      promoCodeAmount: scholarshipAmount
    });
  }

  return {
    studentInfo: {
      studentId: profile.student_id,
      applicationNumber: profile.application_no,
      name: profile.full_name,
      email: profile.email,
      mobileNumber: `${profile.country_code} ${profile.mobile_number}`,
      registrationDate: profile.registration_date
    },
    academicInfo: {
      course: profile.course_name || 'N/A',
      courseCode: profile.course_code || 'N/A',
      courseType: courseConfig.type,
      isScholarshipEligible: courseConfig.isEligible,
      scholarshipCap: courseConfig.maxScholarship,
      scholarshipMessage: courseConfig.message,
      specialization: profile.specialization_name || 'N/A',
      specializationCode: profile.specialization_code || 'N/A',
      applicationStatus: profile.application_status,
      enrollmentStatus: profile.enrollment_status || 'pending',
      hasSubmittedAcademics: Boolean(academicDetails),
      hasScholarshipApplied: scholarshipAmount > 0
    },
    feeInfo: {
      totalCourseFee,
      originalTotalFee,
      scholarshipAmount,
      scholarshipCode,
      scholarshipBreakdown,
      totalAmountPaid,
      outstandingBalance,
      registrationFeePaid,
      registrationPaymentStatus: feeSummary?.registration_payment_status || 'unpaid'
    },
    paymentInfo: {
      latestPayment: payments.length > 0 ? payments[0] : null,
      registrationPayment: regFeeDetails ? {
        status: regFeeDetails.reg_payment_status || 'unpaid',
        amount: parseFloat(regFeeDetails.final_reg_fee || regFeeDetails.original_registration_fee || 0),
        currency: regFeeDetails.reg_currency || 'INR',
        orderId: regFeeDetails.order_id || null,
        transactionId: regFeeDetails.transaction_id || null,
        trackingId: regFeeDetails.tracking_id || null,
        bankRefNo: regFeeDetails.bank_ref_no || null,
        paymentMode: regFeeDetails.payment_mode || null,
        paymentGateway: regFeeDetails.reg_payment_gateway || null,
        paidAt: regFeeDetails.reg_paid_at || null
      } : null,
      totalPaymentsCount: payments.length,
      history: payments
    }
  };
};

export const getStudentPayments = async (userId) => {
  return StudentModel.getStudentPayments(userId);
};

export const validateScholarshipCode = async (rawCode, courseCodeOrName = null) => {
  if (!rawCode || !String(rawCode).trim()) {
    const error = new Error('Please enter a 6-digit scholarship code');
    error.statusCode = 400;
    throw error;
  }

  // If course is provided and is EDP, reject immediately
  if (courseCodeOrName) {
    const courseCfg = getCourseScholarshipConfig(courseCodeOrName);
    if (!courseCfg.isEligible) {
      const error = new Error('Executive Diploma Programmes (EDP) are not eligible for counselor/merit scholarships.');
      error.statusCode = 400;
      throw error;
    }
  }

  const codeStr = String(rawCode).trim();
  const dbCode = await StudentModel.getScholarshipCodeFromDb(codeStr);
  const fallback = getScholarshipByCode(codeStr);

  const matched = dbCode || fallback;
  if (!matched) {
    const error = new Error('Invalid scholarship code. Please verify the 6-digit code provided by your LIBA admissions counselor.');
    error.statusCode = 400;
    throw error;
  }

  const amount = parseFloat(matched.amount);
  const courseCfg = courseCodeOrName ? getCourseScholarshipConfig(courseCodeOrName) : null;

  return {
    code: matched.code,
    amount,
    formattedAmount: `₹${amount.toLocaleString('en-IN')}`,
    description: matched.description || 'Counselor Scholarship Grant',
    courseConfig: courseCfg,
    valid: true
  };
};

export const submitAcademicAndScholarship = async (userId, payload) => {
  let profile = await StudentModel.getStudentProfile(userId);
  if (!profile && payload.userEmail) {
    profile = await StudentModel.getStudentProfile(payload.userEmail);
  }
  if (!profile && payload.email) {
    profile = await StudentModel.getStudentProfile(payload.email);
  }
  if (!profile && payload.applicationNo) {
    profile = await StudentModel.getStudentProfile(payload.applicationNo);
  }

  if (!profile) {
    const error = new Error('Student profile not found');
    error.statusCode = 404;
    throw error;
  }

  // Security Rule: The student must not access or submit the scholarship page before successful registration fee payment and account activation
  if (!profile.is_active) {
    const error = new Error('Account inactive. Registration fee payment must be completed before applying for counselor scholarship.');
    error.statusCode = 403;
    throw error;
  }

  const effectiveUserId = profile.user_id;

  // Validate required 12th details
  if (!payload.twelfth || !payload.twelfth.school || !payload.twelfth.board || !payload.twelfth.stream || !payload.twelfth.year || !payload.twelfth.percentage) {
    const error = new Error('Class 12th details are required. Please complete all fields.');
    error.statusCode = 400;
    throw error;
  }

  // Validate required UG details
  if (!payload.ug || !payload.ug.degree || !payload.ug.college || !payload.ug.year || !payload.ug.percentage) {
    const error = new Error('Undergraduate degree details are required. Please complete all fields.');
    error.statusCode = 400;
    throw error;
  }

  const courseCodeOrName = profile.course_code || profile.course_name || payload.course || 'PGDM';
  const courseConfig = getCourseScholarshipConfig(courseCodeOrName);

  // Business Rule: EDP (Executive Diploma) does not have scholarship eligibility
  if (!courseConfig.isEligible) {
    if (payload.promoCode && String(payload.promoCode).trim()) {
      const error = new Error('Executive Diploma Programmes (EDP) are not eligible for counselor/merit scholarships.');
      error.statusCode = 400;
      throw error;
    }

    // Save academic details with zero scholarship
    await StudentModel.saveStudentAcademicDetails({
      userId: effectiveUserId,
      studentProfileId: profile.student_profile_pk || effectiveUserId,
      twelfth: payload.twelfth,
      ug: payload.ug,
      certifications: payload.certifications || [],
      certificateUploads: payload.certificateUploads || payload.certificates || [],
      promoCode: null,
      scholarshipAmount: 0.00,
      scholarshipStatus: 'not_eligible'
    });

    const feeSummary = await StudentModel.getStudentFeeAndPaymentSummary(effectiveUserId);
    const originalCourseFee = feeSummary ? parseFloat(feeSummary.original_total_fee) : 128428.00;

    return {
      applicationCompleted: true,
      scholarshipApplied: false,
      isScholarshipEligible: false,
      courseType: courseConfig.type,
      scholarshipAmount: 0.00,
      scholarshipCode: null,
      formattedAmount: '₹0',
      message: 'Academic details submitted successfully. EDP programmes are not eligible for scholarships.',
      courseFee: {
        originalCourseFee,
        scholarshipAmount: 0.00,
        finalCourseFee: originalCourseFee,
        formattedOriginal: `₹${originalCourseFee.toLocaleString('en-IN')}`,
        formattedDiscount: '₹0',
        formattedFinal: `₹${originalCourseFee.toLocaleString('en-IN')}`,
        note: 'Executive Diploma Programmes do not qualify for scholarship grants.'
      },
      registrationFee: {
        paid: true,
        amount: feeSummary?.registration_fee || 2500.00,
        note: 'Registration fee was paid separately.'
      },
      nextStep: 'dashboard',
      redirectUrl: '../dashboard/'
    };
  }

  let rawPromoAmount = 0.00;
  let promoCode = null;

  if (payload.promoCode && String(payload.promoCode).trim()) {
    promoCode = String(payload.promoCode).trim();
    const verifiedDb = await StudentModel.getScholarshipCodeFromDb(promoCode);
    const verifiedConst = getScholarshipByCode(promoCode);
    const verified = verifiedDb || verifiedConst;
    if (!verified) {
      const error = new Error('The promo code entered is invalid. Please check the 6-digit code provided by your LIBA counselor.');
      error.statusCode = 400;
      throw error;
    }
    rawPromoAmount = parseFloat(verified.amount);
  }

  const breakdown = calculateScholarshipBreakdown({
    courseCodeOrName,
    twelfthPercentage: payload.twelfth.percentage,
    ugPercentage: payload.ug.percentage,
    promoCodeAmount: rawPromoAmount
  });

  const scholarshipAmount = breakdown.totalScholarshipAmount;
  const scholarshipStatus = scholarshipAmount > 0 ? 'applied' : 'not_applied';

  // Save academic details
  await StudentModel.saveStudentAcademicDetails({
    userId: effectiveUserId,
    studentProfileId: profile.student_profile_pk || effectiveUserId,
    twelfth: payload.twelfth,
    ug: payload.ug,
    certifications: payload.certifications || [],
    certificateUploads: payload.certificateUploads || payload.certificates || [],
    promoCode,
    scholarshipAmount,
    scholarshipStatus
  });

  // Critical Financial Rule: Apply scholarship discount EXCLUSIVELY to course fee in enrollments
  if (scholarshipAmount > 0) {
    await StudentModel.applyScholarshipToCourseFee({
      userId: effectiveUserId,
      promoCode: promoCode || 'MERIT',
      scholarshipAmount
    });
  }

  const feeSummary = await StudentModel.getStudentFeeAndPaymentSummary(effectiveUserId);
  const originalCourseFee = feeSummary ? parseFloat(feeSummary.original_total_fee) : 350000.00;
  const finalCourseFee = feeSummary ? parseFloat(feeSummary.total_fee) : Math.max(0, originalCourseFee - scholarshipAmount);

  return {
    applicationCompleted: true,
    scholarshipApplied: scholarshipAmount > 0,
    isScholarshipEligible: true,
    courseType: courseConfig.type,
    scholarshipAmount,
    scholarshipCode: promoCode,
    scholarshipBreakdown: breakdown,
    formattedAmount: `₹${scholarshipAmount.toLocaleString('en-IN')}`,
    courseFee: {
      originalCourseFee,
      scholarshipAmount,
      finalCourseFee,
      formattedOriginal: `₹${originalCourseFee.toLocaleString('en-IN')}`,
      formattedDiscount: `-₹${scholarshipAmount.toLocaleString('en-IN')}`,
      formattedFinal: `₹${finalCourseFee.toLocaleString('en-IN')}`,
      note: 'Scholarship discount has been applied exclusively to your course tuition fee.'
    },
    registrationFee: {
      paid: true,
      amount: feeSummary?.registration_fee || 3100.00,
      note: 'Registration fee was already paid separately with ₹0 scholarship deduction.'
    },
    nextStep: 'dashboard',
    redirectUrl: '../dashboard/'
  };
};

export const getAcademicAndScholarship = async (userId, userEmail = null) => {
  let profile = await StudentModel.getStudentProfile(userId);
  if (!profile && userEmail) {
    profile = await StudentModel.getStudentProfile(userEmail);
  }

  if (!profile) {
    const error = new Error('Student profile not found');
    error.statusCode = 404;
    throw error;
  }

  const effectiveUserId = profile.user_id;
  const details = await StudentModel.getStudentAcademicDetails(effectiveUserId);
  const feeSummary = await StudentModel.getStudentFeeAndPaymentSummary(effectiveUserId);

  const courseCodeOrName = profile.course_code || profile.course_name || 'PGDM';
  const courseConfig = getCourseScholarshipConfig(courseCodeOrName);

  const originalCourseFee = feeSummary ? parseFloat(feeSummary.original_total_fee) : 350000.00;
  const scholarshipAmount = details ? parseFloat(details.scholarship_amount || 0.00) : 0.00;
  const finalCourseFee = feeSummary ? parseFloat(feeSummary.total_fee) : Math.max(0, originalCourseFee - scholarshipAmount);

  let breakdown = null;
  if (details && courseConfig.isEligible) {
    breakdown = calculateScholarshipBreakdown({
      courseCodeOrName,
      twelfthPercentage: details.twelfth_percentage,
      ugPercentage: details.ug_percentage,
      promoCodeAmount: details.promo_code ? scholarshipAmount : 0
    });
  }

  return {
    student: {
      name: profile.full_name,
      studentId: profile.student_id,
      applicationNo: profile.application_no,
      email: profile.email,
      course: profile.course_name,
      courseCode: profile.course_code,
      courseType: courseConfig.type,
      isScholarshipEligible: courseConfig.isEligible,
      specialization: profile.specialization_name,
      applicationStatus: profile.application_status,
      isActive: Boolean(profile.is_active)
    },
    courseConfig,
    isScholarshipEligible: courseConfig.isEligible,
    scholarshipBreakdown: breakdown,
    courseFee: {
      originalCourseFee,
      scholarshipCode: details?.promo_code || null,
      scholarshipAmount,
      finalCourseFee,
      formattedOriginal: `₹${originalCourseFee.toLocaleString('en-IN')}`,
      formattedDiscount: `-₹${scholarshipAmount.toLocaleString('en-IN')}`,
      formattedFinal: `₹${finalCourseFee.toLocaleString('en-IN')}`
    },
    registrationFee: {
      amount: feeSummary?.registration_fee || 3100.00,
      paid: feeSummary?.registration_payment_status === 'successful'
    },
    academics: details ? {
      twelfth: {
        school: details.twelfth_school,
        board: details.twelfth_board,
        stream: details.twelfth_stream,
        year: details.twelfth_year,
        percentage: details.twelfth_percentage
      },
      ug: {
        degree: details.ug_degree,
        college: details.ug_college,
        specialization: details.ug_specialization,
        year: details.ug_year,
        percentage: details.ug_percentage
      },
      certifications: typeof details.certifications === 'string'
        ? JSON.parse(details.certifications || '[]')
        : (details.certifications || []),
      promoCode: details.promo_code,
      scholarshipAmount: details.scholarship_amount,
      scholarshipStatus: details.scholarship_status
    } : null
  };
};

export const getRegistrationFee = async (userId) => {
  const feeDetails = await StudentModel.getRegistrationFeeDetails(userId);
  if (!feeDetails) {
    const error = new Error('Student registration details not found');
    error.statusCode = 404;
    throw error;
  }

  // Critical Financial Rule: Registration fee comes from course_fees and receives ZERO scholarship discount
  const originalRegFee = parseFloat(feeDetails.original_registration_fee) || 3100.00;
  const scholarshipDiscount = 0.00;
  const finalRegFee = originalRegFee;

  const isPaid = feeDetails.reg_payment_status === 'successful';

  return {
    student: {
      userId: feeDetails.user_id,
      name: feeDetails.full_name,
      email: feeDetails.email,
      studentId: feeDetails.student_id,
      applicationNo: feeDetails.application_no,
      courseId: feeDetails.course_id,
      courseName: feeDetails.course_name,
      specializationName: feeDetails.specialization_name,
      applicationStatus: feeDetails.application_status,
      isActive: Boolean(feeDetails.is_active)
    },
    feeBreakdown: {
      originalRegFee,
      scholarshipDiscount: 0.00,
      finalRegFee,
      formattedOriginal: `₹${originalRegFee.toLocaleString('en-IN')}`,
      formattedDiscount: '₹0',
      formattedFinal: `₹${finalRegFee.toLocaleString('en-IN')}`,
      note: 'Registration fee is separate from the course fee and receives ₹0 scholarship discount.'
    },
    courseFee: {
      totalCourseFee: parseFloat(feeDetails.course_total_fee) || 350000.00,
      note: 'Course fee is payable after account activation and receives Counselor Scholarship.'
    },
    paymentStatus: {
      isPaid,
      status: feeDetails.reg_payment_status || 'unpaid',
      orderId: feeDetails.order_id || null,
      tid: feeDetails.tid || null,
      transactionId: feeDetails.transaction_id || null,
      trackingId: feeDetails.tracking_id || null,
      bankRefNo: feeDetails.bank_ref_no || null,
      paymentMode: feeDetails.payment_mode || null,
      paymentGateway: feeDetails.reg_payment_gateway || null,
      currency: feeDetails.reg_currency || 'INR',
      paidAt: feeDetails.reg_paid_at || null
    }
  };
};

const generateCcavenueOrderId = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const suffix = String(Date.now()).slice(-6) + String(crypto.randomInt(100, 999));
  return `LIBA${y}${m}${d}${suffix}`;
};

const generateCcavenueTid = () => {
  return `${Date.now()}${crypto.randomInt(100, 999)}`;
};

export const initiateRegistrationPayment = async (userId, requestOptions = {}) => {
  const feeDetails = await StudentModel.getRegistrationFeeDetails(userId);
  if (!feeDetails) {
    const error = new Error('Student registration details not found');
    error.statusCode = 404;
    throw error;
  }

  // If already paid and active, redirect to dashboard
  if (feeDetails.is_active && feeDetails.reg_payment_status === 'successful') {
    return {
      alreadyPaid: true,
      activated: true,
      message: 'Registration fee already paid and account is active.',
      redirectUrl: '../dashboard/'
    };
  }

  // Validate CCAvenue credentials, gateway URL, and Crypto.php availability before creating gateway request
  const gatewayConfig = CcavenueService.assertCcavenueReady();

  // Critical Financial Rule: Fee comes strictly from server DB configuration, never frontend input
  const originalRegFee = parseFloat(feeDetails.original_registration_fee) || 3100.00;
  const finalRegFee = originalRegFee;
  const formattedAmount = finalRegFee.toFixed(2);
  const currency = 'INR';
  const language = requestOptions.language || 'EN';
  const requestType = requestOptions.request_type || 'payment_initiation';
  const billingName = feeDetails.full_name || feeDetails.first_name || 'Student';
  const billingEmail = feeDetails.email;
  const courseTitle = feeDetails.course_name || 'LIBA Online Programme';

  if (!billingName || !billingEmail || !feeDetails.course_id) {
    const error = new Error('Incomplete student registration details for payment initiation');
    error.statusCode = 400;
    throw error;
  }

  const orderId = generateCcavenueOrderId();
  const tid = generateCcavenueTid();

  // Insert pending transaction record first so we obtain last_id for merchant_param1
  const insertedId = await StudentModel.recordRegistrationPaymentOrder({
    userId: feeDetails.user_id,
    studentProfileId: feeDetails.student_profile_id,
    studentId: feeDetails.student_id,
    courseId: feeDetails.course_id,
    originalRegFee,
    scholarshipCode: null,
    scholarshipDiscount: 0.00,
    finalRegFee,
    orderId,
    tid,
    merchantId: gatewayConfig.merchantId,
    currency,
    redirectUrl: gatewayConfig.redirectUrl,
    cancelUrl: gatewayConfig.cancelUrl,
    language,
    billingName,
    billingEmail,
    courses: courseTitle,
    requestType,
    paymentGateway: 'ccavenue'
  });

  const billingPhone = feeDetails.mobile_number
    ? `${feeDetails.country_code || '+91'}${feeDetails.mobile_number}`
    : '';

  // Match reference PHP field set + merchant_param1 (inserted payment ID), merchant_param2 (course), merchant_param4 (phone)
  const merchantData = CcavenueService.buildMerchantData({
    request_type: requestType,
    tid,
    merchant_id: gatewayConfig.merchantId,
    order_id: orderId,
    currency,
    redirect_url: gatewayConfig.redirectUrl,
    cancel_url: gatewayConfig.cancelUrl,
    language,
    amount: formattedAmount,
    billing_name: billingName,
    billing_email: billingEmail,
    billing_tel: billingPhone,
    courses: courseTitle,
    merchant_param1: insertedId,
    merchant_param2: courseTitle,
    merchant_param4: billingPhone
  });

  let encRequest;
  try {
    encRequest = CcavenueService.encrypt(merchantData, gatewayConfig.workingKey);
  } catch (encryptErr) {
    await StudentModel.updateNonSuccessRegistrationPayment({
      orderId,
      paymentStatus: 'failed',
      rawResponse: { error: encryptErr.message, code: encryptErr.code || 'ENCRYPTION_FAILED' }
    });
    throw encryptErr;
  }

  return {
    order_id: orderId,
    tid,
    gateway_url: gatewayConfig.gatewayUrl,
    encRequest,
    access_code: gatewayConfig.accessCode
  };
};

export const handleCcavenueResponse = async ({ encResp }) => {
  const frontendBase = (env.frontendUrl || 'http://localhost:8001').replace(/\/$/, '');
  const successBaseUrl = `${frontendBase}/student/payment-success/`;
  const failedBaseUrl = `${frontendBase}/student/payment-failed/`;

  if (!encResp || typeof encResp !== 'string' || !encResp.trim()) {
    return {
      statusCode: 400,
      redirectUrl: `${failedBaseUrl}?status=invalid_response`,
      outcome: 'invalid_response',
      message: 'Missing encrypted CCAvenue response (encResp).'
    };
  }

  const gatewayConfig = CcavenueService.getGatewayConfig();
  if (!gatewayConfig.workingKey || !CcavenueService.isCryptoConfigured()) {
    logException(
      createSafeError({
        message: SAFE_MESSAGES.GATEWAY_UNAVAILABLE,
        internalMessage: 'CCAvenue decryption cannot proceed: Crypto kit or CCAVENUE_WORKING_KEY is missing.',
        statusCode: 503,
        code: 'CCAVENUE_ENV_INCOMPLETE',
        isGatewayConfigError: true
      }),
      { endpoint: 'payments.ccavenue.response' }
    );
    return {
      statusCode: 503,
      redirectUrl: `${failedBaseUrl}?status=gateway_not_configured`,
      outcome: 'gateway_not_configured',
      message: SAFE_MESSAGES.GATEWAY_UNAVAILABLE
    };
  }

  let decryptedString;
  try {
    decryptedString = CcavenueService.decrypt(encResp.trim(), gatewayConfig.workingKey);
  } catch (decryptErr) {
    logException(decryptErr, { endpoint: 'payments.ccavenue.response' });
    return {
      statusCode: 400,
      redirectUrl: `${failedBaseUrl}?status=invalid_response`,
      outcome: 'invalid_response',
      message: 'Invalid encrypted payment gateway response.'
    };
  }

  const parsed = CcavenueService.parseResponseParams(decryptedString);
  const extracted = CcavenueService.extractResponseFields(parsed);

  if (!extracted || !extracted.orderId) {
    return {
      statusCode: 400,
      redirectUrl: `${failedBaseUrl}?status=invalid_response`,
      outcome: 'invalid_response',
      message: 'Malformed decrypted CCAvenue response: missing order_id.'
    };
  }

  const {
    orderStatus,
    orderId,
    amount: returnedAmountStr,
    currency: returnedCurrency,
    statusMessage,
    failureMessage,
    trackingId,
    bankRefNo,
    paymentMode,
    merchantParam1
  } = extracted;

  // Locate payment record via merchant_param1 first (per PHP handler flow), then fallback to order_id
  let existingOrder = null;
  if (merchantParam1) {
    existingOrder = await StudentModel.findRegistrationPaymentById(merchantParam1);
    if (!existingOrder || existingOrder.order_id !== orderId) {
      if (existingOrder) {
        await StudentModel.updateNonSuccessRegistrationPayment({
          orderId: existingOrder.order_id,
          paymentStatus: 'failed',
          trackingId,
          bankRefNo,
          paymentMode,
          rawResponse: { ...parsed, verificationError: 'order_id mismatch with merchant_param1' }
        });
      }
      return {
        statusCode: 400,
        outcome: 'ownership_mismatch',
        redirectUrl: `${failedBaseUrl}?status=invalid_response&orderId=${encodeURIComponent(orderId)}`,
        message: 'Order reference mismatch with payment record ID.'
      };
    }
  } else {
    existingOrder = await StudentModel.findRegistrationPaymentByOrderId(orderId);
  }

  if (!existingOrder) {
    return {
      statusCode: 404,
      redirectUrl: `${failedBaseUrl}?status=unknown_order&orderId=${encodeURIComponent(orderId)}`,
      outcome: 'unknown_order',
      message: `Order ${orderId} not found.`
    };
  }

  const normalizedStatus = orderStatus.toLowerCase();
  const returnedAmount = returnedAmountStr !== null ? parseFloat(returnedAmountStr) : NaN;

  // Idempotency & never overwrite an already successful transaction
  if (existingOrder.payment_status === 'successful' && existingOrder.is_active) {
    return {
      statusCode: 302,
      alreadyProcessed: true,
      outcome: 'already_paid',
      redirectUrl: `${successBaseUrl}?orderId=${encodeURIComponent(orderId)}&trackingId=${encodeURIComponent(existingOrder.tracking_id || existingOrder.transaction_id || '')}&duplicate=1`,
      message: 'Payment already verified and account is active.'
    };
  }

  const expectedAmount = parseFloat(existingOrder.final_reg_fee);
  const expectedCurrency = String(existingOrder.currency || 'INR').trim().toUpperCase();

  if (normalizedStatus === 'success') {
    const amountValid = Number.isFinite(returnedAmount) && Math.abs(returnedAmount - expectedAmount) <= 0.01;
    const currencyValid = returnedCurrency === expectedCurrency;

    if (!amountValid || !currencyValid) {
      await StudentModel.updateNonSuccessRegistrationPayment({
        orderId,
        paymentStatus: 'failed',
        trackingId,
        bankRefNo,
        paymentMode,
        rawResponse: {
          ...parsed,
          verificationError: `Amount/currency mismatch (expected ${expectedCurrency} ${expectedAmount.toFixed(2)}, got ${returnedCurrency} ${returnedAmountStr})`
        }
      });

      return {
        statusCode: 400,
        outcome: 'amount_mismatch',
        redirectUrl: `${failedBaseUrl}?status=amount_mismatch&orderId=${encodeURIComponent(orderId)}`,
        message: 'Payment amount or currency verification failed.'
      };
    }

    const result = await StudentModel.completeRegistrationPayment({
      orderId,
      transactionId: trackingId || bankRefNo || orderId,
      trackingId,
      bankRefNo,
      paymentMode,
      rawResponse: parsed
    });

    if (!result.alreadyProcessed) {
      const studentName = existingOrder.full_name || existingOrder.first_name || 'Student';
      const resolvedTransactionId = result.order?.transaction_id || trackingId || orderId;
      const paidAt = result.order?.paid_at || new Date();
      const courseName = existingOrder.course_name || 'LIBA Online Programme';

      try {
        await sendPaymentSuccessEmail({
          to: existingOrder.email,
          name: studentName,
          orderId,
          transactionId: resolvedTransactionId,
          amount: expectedAmount,
          paymentType: 'Registration Fee',
          courseName,
          applicationNumber: existingOrder.application_no || 'N/A',
          paidAt
        });
      } catch (mailErr) {
        console.error('[EMAIL-ERROR] Failed to send payment success email:', mailErr.message);
      }

      const studentPhone = existingOrder.mobile_number
        ? `${existingOrder.country_code || '+91'} ${existingOrder.mobile_number}`.trim()
        : 'N/A';

      await triggerPaymentSuccessNotification({
        userId: existingOrder.user_id,
        fullName: studentName,
        email: existingOrder.email,
        phone: studentPhone,
        courseName,
        specializationName: existingOrder.specialization_name || null,
        studentId: existingOrder.student_id || null,
        applicationNo: existingOrder.application_no || null,
        orderId,
        transactionId: resolvedTransactionId,
        amount: expectedAmount,
        paymentMode: paymentMode || result.order?.payment_mode || null,
        paidAt
      });
    }

    const queryParams = new URLSearchParams({
      orderId,
      trackingId: trackingId || result.order?.transaction_id || '',
      bankRefNo: bankRefNo || '',
      status: 'success'
    });

    return {
      statusCode: 302,
      alreadyProcessed: result.alreadyProcessed,
      outcome: 'success',
      redirectUrl: `${successBaseUrl}?${queryParams.toString()}`,
      message: 'Payment verified successfully.'
    };
  }

  let mappedDbStatus = 'failed';
  let resultStatusParam = 'failed';

  if (normalizedStatus === 'aborted') {
    mappedDbStatus = 'cancelled';
    resultStatusParam = 'cancelled';
  } else if (['initiated', 'awaited', 'pending'].includes(normalizedStatus)) {
    mappedDbStatus = 'pending';
    resultStatusParam = 'pending';
  }

  const updateRes = await StudentModel.updateNonSuccessRegistrationPayment({
    orderId,
    paymentStatus: mappedDbStatus,
    trackingId,
    bankRefNo,
    paymentMode,
    rawResponse: parsed
  });

  if (updateRes?.alreadySuccessful) {
    return {
      statusCode: 302,
      alreadyProcessed: true,
      outcome: 'already_paid',
      redirectUrl: `${successBaseUrl}?orderId=${encodeURIComponent(orderId)}&trackingId=${encodeURIComponent(updateRes.order.tracking_id || updateRes.order.transaction_id || '')}&duplicate=1`,
      message: 'Transaction already verified as successful.'
    };
  }

  if (mappedDbStatus === 'failed') {
    try {
      await sendPaymentFailedEmail({
        to: existingOrder.email,
        name: existingOrder.full_name || existingOrder.first_name || 'Student',
        orderId,
        amount: expectedAmount,
        paymentType: 'Registration Fee',
        courseName: existingOrder.course_name || 'LIBA Online Programme',
        applicationNumber: existingOrder.application_no || 'N/A',
        reason: failureMessage || statusMessage || `Transaction ${orderStatus || 'failed'} at CCAvenue gateway`
      });
    } catch (mailErr) {
      console.error('[EMAIL-ERROR] Failed to send payment failed email:', mailErr.message);
    }
  }

  const failQuery = new URLSearchParams({
    status: resultStatusParam,
    orderId
  });
  if (trackingId) failQuery.set('trackingId', trackingId);

  return {
    statusCode: 302,
    outcome: resultStatusParam,
    redirectUrl: `${failedBaseUrl}?${failQuery.toString()}`,
    message: `Payment ${resultStatusParam}.`
  };
};

export const getRegistrationStatus = async (userId) => {
  const profile = await StudentModel.getStudentProfile(userId);
  if (!profile) {
    const error = new Error('Student not found');
    error.statusCode = 404;
    throw error;
  }

  const feeDetails = await StudentModel.getRegistrationFeeDetails(userId);
  const isPaid = feeDetails?.reg_payment_status === 'successful';
  const isActive = Boolean(profile.is_active);

  let nextStep = 'dashboard';
  let redirectUrl = '../dashboard/';

  if (!profile.is_verified) {
    nextStep = 'otp';
    redirectUrl = '../otpfor/';
  } else if (!isActive || !isPaid) {
    nextStep = 'payment';
    redirectUrl = '../payment/';
  } else {
    nextStep = 'dashboard';
    redirectUrl = '../dashboard/';
  }

  return {
    isVerified: Boolean(profile.is_verified),
    isActive,
    applicationStatus: profile.application_status,
    nextStep,
    redirectUrl,
    registrationPayment: feeDetails ? {
      orderId: feeDetails.order_id,
      tid: feeDetails.tid || null,
      transactionId: feeDetails.transaction_id,
      trackingId: feeDetails.tracking_id || null,
      bankRefNo: feeDetails.bank_ref_no || null,
      paymentMode: feeDetails.payment_mode || null,
      paymentGateway: feeDetails.reg_payment_gateway || null,
      currency: feeDetails.reg_currency || 'INR',
      originalRegFee: feeDetails.original_reg_fee,
      scholarshipDiscount: feeDetails.scholarship_discount,
      finalRegFee: feeDetails.final_reg_fee,
      paymentType: 'registration_fee',
      status: feeDetails.reg_payment_status || 'unpaid',
      paidAt: feeDetails.reg_paid_at
    } : null
  };
};
