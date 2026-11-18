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
  const latestClaim = await StudentModel.getLatestScholarshipClaim(userId);

  const courseCodeOrName = profile.course_code || profile.course_name || 'PGDM';
  const courseConfig = getCourseScholarshipConfig(courseCodeOrName);

  const courseRecord = profile.course_id ? await StudentModel.getCourseById(profile.course_id) : await StudentModel.getCourseByCodeOrName(courseCodeOrName);
  const isCourseScholarshipActive = courseRecord ? (Number(courseRecord.is_scholarship_active) === 1) : Boolean(courseConfig.isEligible);
  const maxCourseScholarship = courseRecord ? (parseFloat(courseRecord.scholarship_amount) || 0) : (courseConfig.maxScholarship || 0);

  if (courseRecord && !isCourseScholarshipActive) {
    courseConfig.isEligible = false;
    courseConfig.message = 'Scholarship applications are currently unavailable for this course.';
  }

  const claimStatus = latestClaim?.status || 'not_applied';
  const isLockedIn = claimStatus === 'locked_in' || claimStatus === 'used';
  const isRegPaid = Boolean(
    regFeeDetails?.reg_payment_status === 'successful' ||
    (await StudentModel.hasSuccessfulRegistrationPayment(userId))
  );

  // Financial Rule 1, 2, 3:
  // Registration Fee and Course Fee are completely separate financial transactions.
  // Registration Fee is mandatory before Course Fee payment.
  // The scholarship discount applies EXCLUSIVELY to the Course Fee only when:
  // 1. Registration Fee is paid, AND
  // 2. Scholarship claim status is `locked_in`.
  // An `active` or `expired` claim must NOT reduce the Course Fee.
  // A saved total_discount of 0 in a locked_in claim must remain 0 and NEVER fall back to course discount.
  const originalTotalFee = feeSummary && feeSummary.original_total_fee != null ? parseFloat(feeSummary.original_total_fee) : null;
  const savedClaimDiscount = (latestClaim != null && latestClaim.total_discount !== null && latestClaim.total_discount !== undefined)
    ? Math.max(0, parseFloat(latestClaim.total_discount) || 0)
    : 0.00;
  const rawScholarshipAmount = savedClaimDiscount;
  const applicableDiscount = (isRegPaid && isLockedIn) ? savedClaimDiscount : 0.00;
  const totalCourseFee = originalTotalFee !== null ? Math.max(0, originalTotalFee - applicableDiscount) : null;
  const totalAmountPaid = feeSummary ? parseFloat(feeSummary.amount_paid || 0.00) : 0.00;
  const outstandingBalance = totalCourseFee !== null ? Math.max(0, totalCourseFee - totalAmountPaid) : null;
  const registrationFeePaid = isRegPaid
    ? parseFloat(feeSummary?.registration_fee_paid || regFeeDetails?.original_registration_fee || 0.00)
    : 0.00;

  let scholarshipBreakdown = null;
  if (academicDetails && courseConfig.isEligible) {
    scholarshipBreakdown = calculateScholarshipBreakdown({
      courseCodeOrName,
      twelfthPercentage: academicDetails.twelfth_percentage,
      ugPercentage: academicDetails.ug_percentage,
      promoCodeAmount: applicableDiscount
    });
  }

  return {
    registration_fee_paid: isRegPaid,
    scholarship_status: claimStatus,
    total_discount: rawScholarshipAmount,
    expires_at: latestClaim?.expires_at || null,
    course_fee: originalTotalFee,
    applicable_scholarship_discount: applicableDiscount,
    course_fee_payable: totalCourseFee,
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
      isScholarshipActive: isCourseScholarshipActive,
      isScholarshipEligible: isCourseScholarshipActive && courseConfig.isEligible,
      scholarshipCap: maxCourseScholarship,
      scholarshipMessage: isCourseScholarshipActive
        ? courseConfig.message
        : 'Scholarship applications are currently unavailable for this course.',
      specialization: profile.specialization_name || 'N/A',
      specializationCode: profile.specialization_code || 'N/A',
      applicationStatus: profile.application_status,
      enrollmentStatus: profile.enrollment_status || 'pending',
      hasSubmittedAcademics: Boolean(academicDetails),
      hasScholarshipApplied: applicableDiscount > 0,
      scholarshipStatus: claimStatus,
      scholarship_status: claimStatus,
      expiresAt: latestClaim?.expires_at || null,
      expires_at: latestClaim?.expires_at || null
    },
    is_scholarship_active: isCourseScholarshipActive,
    isScholarshipActive: isCourseScholarshipActive,
    scholarship_status: claimStatus,
    expires_at: latestClaim?.expires_at || null,
    scholarshipStatus: claimStatus,
    expiresAt: latestClaim?.expires_at || null,
    scholarshipClaim: latestClaim ? {
      id: latestClaim.id,
      status: claimStatus,
      totalDiscount: rawScholarshipAmount,
      expiresAt: latestClaim.expires_at,
      createdAt: latestClaim.created_at,
      calculationSnapshot: typeof latestClaim.calculation_snapshot === 'string'
        ? JSON.parse(latestClaim.calculation_snapshot)
        : latestClaim.calculation_snapshot
    } : null,
    feeInfo: {
      totalCourseFee,
      originalTotalFee,
      scholarshipAmount: applicableDiscount,
      scholarshipCode: isLockedIn ? (feeSummary?.scholarship_code || null) : null,
      scholarshipBreakdown,
      scholarship_status: claimStatus,
      expires_at: latestClaim?.expires_at || null,
      scholarshipStatus: claimStatus,
      expiresAt: latestClaim?.expires_at || null,
      totalAmountPaid,
      outstandingBalance,
      registrationFeePaid,
      registrationPaymentStatus: isRegPaid ? 'successful' : (feeSummary?.registration_payment_status || 'unpaid')
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

export const evaluateCertifications = (rawCerts = [], certUploads = []) => {
  const certs = Array.isArray(rawCerts) ? rawCerts : (rawCerts ? [rawCerts] : []);
  const uploads = Array.isArray(certUploads) ? certUploads : (certUploads ? [certUploads] : []);

  const validExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];
  const isValidFile = (fileStr) => {
    if (!fileStr || typeof fileStr !== 'string') return false;
    const str = fileStr.toLowerCase().trim();
    if (str.startsWith('data:image/jpeg') || str.startsWith('data:image/png') || str.startsWith('data:application/pdf')) {
      return true;
    }
    return validExtensions.some(ext => str.endsWith(ext) || str.includes(ext));
  };

  let validCount = 0;
  let hasIncomplete = false;
  const processedCerts = [];

  certs.forEach((c, idx) => {
    if (!c) return;
    if (typeof c === 'string') {
      const trimmed = c.trim();
      if (!trimmed) return;
      const upload = uploads[idx] || uploads[0];
      if (upload && isValidFile(upload)) {
        validCount++;
        processedCerts.push({ name: trimmed, valid: true });
      } else if (uploads.length > 0) {
        validCount++;
        processedCerts.push({ name: trimmed, valid: true });
      } else {
        hasIncomplete = true;
      }
      return;
    }

    if (typeof c === 'object') {
      const name = (c.name || c.title || '').trim();
      const institution = (c.institution || c.organization || c.issuingOrganization || '').trim();
      const year = (c.year || c.completionYear || '').toString().trim();
      const file = (c.fileName || c.file || c.fileData || c.document || uploads[idx] || uploads[0] || '').toString().trim();

      const hasAnyField = Boolean(name || institution || year || file);
      if (!hasAnyField) return; // Completely blank entry

      const hasAllFields = Boolean(name && institution && year && file && isValidFile(file));
      if (hasAllFields) {
        validCount++;
        processedCerts.push({ name, institution, year, fileName: c.fileName || file, valid: true });
      } else {
        hasIncomplete = true;
      }
    }
  });

  if (certs.length === 0 && uploads.length > 0) {
    const validUploads = uploads.filter(u => isValidFile(u));
    if (validUploads.length > 0) {
      validCount += validUploads.length;
    }
  }

  // A student has valid certification ONLY if there is at least one valid certification and NO incomplete certification cards
  const hasValidCert = validCount > 0 && !hasIncomplete;

  return {
    hasValidCert,
    hasIncomplete,
    validCount,
    processedCerts
  };
};

export const validateScholarshipCode = async (rawCode, courseCodeOrName = null, courseId = null, options = {}) => {
  if (!rawCode || !String(rawCode).trim()) {
    const error = new Error('Please enter a 6-digit scholarship code');
    error.statusCode = 400;
    throw error;
  }

  let courseRecord = null;
  if (courseId) {
    courseRecord = await StudentModel.getCourseById(courseId);
  } else if (courseCodeOrName) {
    courseRecord = await StudentModel.getCourseByCodeOrName(courseCodeOrName);
  }

  if (courseRecord && Number(courseRecord.is_scholarship_active) === 0) {
    const error = new Error('Scholarship applications are currently unavailable for this course.');
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

  let amount = parseFloat(matched.amount);
  let configuredCounselor = amount;
  let effectiveCounselor = amount;
  let transferredCert = 0;

  if (courseRecord) {
    const dbDistributions = await StudentModel.getCourseScholarshipDistributions(courseRecord.id);
    const counselorDist = dbDistributions ? dbDistributions.find(d => d.category === 'counselor') : null;
    const certDist = dbDistributions ? dbDistributions.find(d => d.category === 'certification') : null;

    if (counselorDist) {
      if (Number(counselorDist.is_active) === 0) {
        const error = new Error('Counselor scholarship codes are currently unavailable for this course.');
        error.statusCode = 400;
        throw error;
      }
      configuredCounselor = parseFloat(counselorDist.amount) || 0;
      const isCertActive = certDist && Number(certDist.is_active) === 1;
      const configuredCert = isCertActive ? (parseFloat(certDist.amount) || 0) : 0;

      // Determine if student has submitted or entered a valid certification
      let hasCertification = false;
      if (options.hasCertification !== undefined) {
        hasCertification = Boolean(options.hasCertification);
      } else if (options.hasValidCert !== undefined) {
        hasCertification = Boolean(options.hasValidCert);
      } else if (Array.isArray(options.certifications) || Array.isArray(options.certificateUploads)) {
        const evaluation = evaluateCertifications(options.certifications, options.certificateUploads || options.certificates);
        hasCertification = evaluation.hasValidCert;
      }

      transferredCert = hasCertification ? 0 : configuredCert;
      effectiveCounselor = configuredCounselor + transferredCert;

      if (amount > effectiveCounselor) {
        amount = effectiveCounselor;
      }
    }
  }

  const courseCfg = courseCodeOrName ? getCourseScholarshipConfig(courseCodeOrName) : null;

  return {
    code: matched.code,
    amount,
    formattedAmount: `₹${amount.toLocaleString('en-IN')}`,
    description: matched.description || 'Counselor Scholarship Grant',
    courseConfig: courseCfg,
    configuredCounselorAllocation: configuredCounselor,
    effectiveCounselorAllocation: effectiveCounselor,
    transferredCertificationAllocation: transferredCert,
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

  // Security Rule: Student account must be verified before submitting scholarship
  if (!profile.is_active && !profile.is_verified) {
    const error = new Error('Account inactive. Email verification must be completed before applying for counselor scholarship.');
    error.statusCode = 403;
    throw error;
  }

  const effectiveUserId = profile.user_id;

  // Mandatory Backend Enforcement: Prevent duplicate scholarship applications based on claim state machine
  const existingClaim = await StudentModel.getLatestScholarshipClaim(effectiveUserId);
  if (existingClaim) {
    if (existingClaim.status === 'expired') {
      const error = new Error('Your scholarship reservation period has ended. You cannot reapply for a scholarship.');
      error.statusCode = 409;
      error.code = 'SCHOLARSHIP_CLAIM_EXPIRED';
      throw error;
    }
    if (existingClaim.status === 'active') {
      const error = new Error('You already have an active scholarship reservation.');
      error.statusCode = 409;
      error.code = 'SCHOLARSHIP_CLAIM_ACTIVE';
      throw error;
    }
    if (existingClaim.status === 'locked_in') {
      const error = new Error('Your scholarship discount is already secured and locked in.');
      error.statusCode = 409;
      error.code = 'SCHOLARSHIP_CLAIM_LOCKED_IN';
      throw error;
    }
    if (existingClaim.status === 'used') {
      const error = new Error('Your scholarship discount has already been used.');
      error.statusCode = 409;
      error.code = 'SCHOLARSHIP_CLAIM_USED';
      throw error;
    }
  }

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

  const courseRecord = profile.course_id ? await StudentModel.getCourseById(profile.course_id) : await StudentModel.getCourseByCodeOrName(courseCodeOrName);
  const isCourseScholarshipActive = courseRecord ? (Number(courseRecord.is_scholarship_active) === 1) : Boolean(courseConfig.isEligible);
  const maxCourseScholarship = courseRecord ? (parseFloat(courseRecord.scholarship_amount) || 0) : (courseConfig.maxScholarship || 0);

  // Business Rule: Check if course or category is not eligible or disabled
  if (!courseConfig.isEligible || !isCourseScholarshipActive) {
    if (payload.promoCode && String(payload.promoCode).trim()) {
      const errorMsg = !courseConfig.isEligible
        ? 'Executive Diploma Programmes (EDP) are not eligible for counselor/merit scholarships.'
        : 'Scholarship applications are currently unavailable for this course.';
      const error = new Error(errorMsg);
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
    const isRegPaid = await StudentModel.hasSuccessfulRegistrationPayment(effectiveUserId);

    return {
      applicationCompleted: true,
      scholarshipApplied: false,
      isScholarshipEligible: false,
      isScholarshipActive: isCourseScholarshipActive,
      courseId: profile.course_id,
      courseName: profile.course_name,
      courseCode: profile.course_code,
      courseType: courseConfig.type,
      scholarshipAmount: 0.00,
      scholarshipCode: null,
      formattedAmount: '₹0',
      message: !courseConfig.isEligible
        ? 'Academic details submitted successfully. EDP programmes are not eligible for scholarships.'
        : 'Academic details submitted successfully. Scholarship applications are currently unavailable for this course.',
      courseFee: {
        courseId: profile.course_id,
        courseName: profile.course_name,
        originalCourseFee,
        scholarshipAmount: 0.00,
        finalCourseFee: originalCourseFee,
        formattedOriginal: `₹${originalCourseFee.toLocaleString('en-IN')}`,
        formattedDiscount: '₹0',
        formattedFinal: `₹${originalCourseFee.toLocaleString('en-IN')}`,
        note: !courseConfig.isEligible
          ? 'Executive Diploma Programmes do not qualify for scholarship grants.'
          : 'Scholarship applications are currently unavailable for this course.'
      },
      registrationFee: {
        paid: isRegPaid,
        amount: feeSummary?.registration_fee || 2500.00,
        note: 'Registration fee was paid separately.'
      },
      nextStep: isRegPaid ? 'dashboard' : 'payment',
      redirectUrl: isRegPaid ? '../dashboard/' : '../payment/'
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

  // Additive calculation model using course scholarship distributions
  const dbDistributions = await StudentModel.getCourseScholarshipDistributions(
    profile.course_id || (courseRecord ? courseRecord.id : null)
  );

  let awarded12th = 0;
  let awardedUG = 0;
  let awardedCert = 0;
  let awardedCounselor = 0;
  let calculationSnapshot = null;
  let breakdown = null;
  let scholarshipAmount = 0.00;

  if (dbDistributions && dbDistributions.length > 0) {
    const twelfthDist = dbDistributions.find(d => d.category === 'twelfth');
    const ugDist = dbDistributions.find(d => d.category === 'ug');
    const certDist = dbDistributions.find(d => d.category === 'certification');
    const counselorDist = dbDistributions.find(d => d.category === 'counselor');

    const isTwelfthActive = twelfthDist && Number(twelfthDist.is_active) === 1;
    const isUgActive = ugDist && Number(ugDist.is_active) === 1;
    const isCertActive = certDist && Number(certDist.is_active) === 1;
    const isCounselorActive = counselorDist && Number(counselorDist.is_active) === 1;

    const configuredTwelfth = isTwelfthActive ? (parseFloat(twelfthDist.amount) || 0) : 0;
    const configuredUg = isUgActive ? (parseFloat(ugDist.amount) || 0) : 0;
    const configuredCert = isCertActive ? (parseFloat(certDist.amount) || 0) : 0;
    const configuredCounselor = isCounselorActive ? (parseFloat(counselorDist.amount) || 0) : 0;

    // 12th qualification
    const twelfthPct = parseFloat(payload.twelfth.percentage) || 0;
    const twelfthMin = (typeof twelfthDist?.eligibility_config === 'string'
      ? JSON.parse(twelfthDist.eligibility_config)
      : twelfthDist?.eligibility_config)?.min_percentage ?? 65;
    if (isTwelfthActive && twelfthPct >= twelfthMin) {
      awarded12th = configuredTwelfth;
    }

    // UG qualification
    const ugPct = parseFloat(payload.ug.percentage) || 0;
    const ugMin = (typeof ugDist?.eligibility_config === 'string'
      ? JSON.parse(ugDist.eligibility_config)
      : ugDist?.eligibility_config)?.min_percentage ?? 65;
    if (isUgActive && ugPct >= ugMin) {
      awardedUG = configuredUg;
    }

    // Additional certification evaluation
    const certEvaluation = evaluateCertifications(
      payload.certifications || [],
      payload.certificateUploads || payload.certificates || []
    );
    const hasValidCert = certEvaluation.hasValidCert;

    let transferredCertAllocation = 0;
    let effectiveCertAllocation = 0;
    let effectiveCounselorAllocation = configuredCounselor;

    if (hasValidCert && isCertActive) {
      effectiveCertAllocation = configuredCert;
      awardedCert = configuredCert;
      transferredCertAllocation = 0;
      effectiveCounselorAllocation = configuredCounselor;
    } else {
      awardedCert = 0;
      effectiveCertAllocation = 0;
      if (isCounselorActive) {
        transferredCertAllocation = configuredCert;
        effectiveCounselorAllocation = configuredCounselor + transferredCertAllocation;
      } else {
        transferredCertAllocation = 0;
        effectiveCounselorAllocation = 0;
      }
    }

    // Counselor code
    if (isCounselorActive && promoCode && rawPromoAmount > 0) {
      awardedCounselor = Math.min(rawPromoAmount, effectiveCounselorAllocation);
    } else {
      awardedCounselor = 0;
    }

    const totalCalculated = awarded12th + awardedUG + awardedCert + awardedCounselor;
    scholarshipAmount = Math.min(totalCalculated, maxCourseScholarship);

    calculationSnapshot = {
      course_id: profile.course_id || (courseRecord ? courseRecord.id : null),
      max_scholarship: maxCourseScholarship,
      course_max_scholarship: maxCourseScholarship,
      certification_submitted: hasValidCert,
      certification_allocation: configuredCert,
      certification_benefit: awardedCert,
      transferred_certification_allocation: transferredCertAllocation,
      configured_counselor_allocation: configuredCounselor,
      effective_counselor_allocation: effectiveCounselorAllocation,
      categories: [
        {
          category: 'twelfth',
          label: '12th Qualification',
          allocated: configuredTwelfth,
          awarded: awarded12th,
          eligible: awarded12th > 0
        },
        {
          category: 'ug',
          label: 'Undergraduate Qualification',
          allocated: configuredUg,
          awarded: awardedUG,
          eligible: awardedUG > 0
        },
        {
          category: 'certification',
          label: 'Additional Certification',
          allocated: configuredCert,
          effective_allocated: effectiveCertAllocation,
          awarded: awardedCert,
          eligible: awardedCert > 0,
          submitted: hasValidCert,
          transferred_to_counselor: transferredCertAllocation
        },
        {
          category: 'counselor',
          label: 'Counselor Scholarship Code',
          allocated: configuredCounselor,
          effective_allocated: effectiveCounselorAllocation,
          awarded: awardedCounselor,
          eligible: awardedCounselor > 0,
          code: promoCode,
          transferred_from_certification: transferredCertAllocation
        }
      ],
      total_awarded: scholarshipAmount,
      calculated_at: new Date().toISOString()
    };

    breakdown = {
      courseName: profile.course_name,
      courseCode: profile.course_code,
      maxCap: maxCourseScholarship,
      courseMaxScholarship: maxCourseScholarship,
      categories: calculationSnapshot.categories,
      twelfthAmount: awarded12th,
      ugAmount: awardedUG,
      certificationAmount: awardedCert,
      promoAmount: awardedCounselor,
      totalScholarshipAmount: scholarshipAmount,
      certificationSubmitted: hasValidCert,
      certificationAllocation: configuredCert,
      certificationBenefit: awardedCert,
      transferredCertificationAllocation: transferredCertAllocation,
      configuredCounselorAllocation: configuredCounselor,
      effectiveCounselorAllocation: effectiveCounselorAllocation
    };
  } else {
    // Fallback if no database distributions exist
    breakdown = calculateScholarshipBreakdown({
      courseCodeOrName,
      twelfthPercentage: payload.twelfth.percentage,
      ugPercentage: payload.ug.percentage,
      promoCodeAmount: rawPromoAmount
    });
    scholarshipAmount = Math.min(breakdown.totalScholarshipAmount, maxCourseScholarship);
    calculationSnapshot = {
      course_id: profile.course_id,
      max_scholarship: maxCourseScholarship,
      course_max_scholarship: maxCourseScholarship,
      certification_submitted: false,
      certification_allocation: 0,
      certification_benefit: 0,
      transferred_certification_allocation: 0,
      configured_counselor_allocation: 0,
      effective_counselor_allocation: 0,
      total_awarded: scholarshipAmount,
      calculated_at: new Date().toISOString()
    };
  }

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
  let claim = null;
  const isRegPaid = await StudentModel.hasSuccessfulRegistrationPayment(effectiveUserId);
  const timerSetting = await StudentModel.getSystemSetting('scholarship_timer_hours');
  const timerHours = timerSetting !== null && !isNaN(parseInt(timerSetting, 10)) ? parseInt(timerSetting, 10) : 2;

  if (scholarshipAmount > 0) {
    await StudentModel.applyScholarshipToCourseFee({
      userId: effectiveUserId,
      promoCode: promoCode || 'MERIT',
      scholarshipAmount
    });

    claim = await StudentModel.createOrUpdateScholarshipClaim({
      userId: effectiveUserId,
      courseId: profile.course_id || null,
      totalDiscount: scholarshipAmount,
      hours: timerHours,
      isRegFeePaid: isRegPaid,
      maxScholarship: maxCourseScholarship,
      calculationSnapshot
    });
  }

  const feeSummary = await StudentModel.getStudentFeeAndPaymentSummary(effectiveUserId);
  const originalCourseFee = feeSummary && feeSummary.original_total_fee != null ? parseFloat(feeSummary.original_total_fee) : null;
  const finalCourseFee = feeSummary && feeSummary.total_fee != null
    ? parseFloat(feeSummary.total_fee)
    : (originalCourseFee !== null ? Math.max(0, originalCourseFee - scholarshipAmount) : null);

  const claimStatus = claim ? claim.status : (scholarshipAmount > 0 ? (isRegPaid ? 'locked_in' : 'active') : 'none');
  const nextStep = isRegPaid ? 'dashboard' : 'payment';
  const redirectUrl = isRegPaid ? '../dashboard/' : '../payment/';

  return {
    applicationCompleted: true,
    scholarshipApplied: scholarshipAmount > 0,
    isScholarshipEligible: true,
    courseId: profile.course_id,
    courseName: profile.course_name,
    courseCode: profile.course_code,
    courseType: courseConfig.type,
    scholarshipAmount,
    scholarshipCode: promoCode,
    breakdown,
    scholarshipBreakdown: breakdown,
    formattedAmount: `₹${scholarshipAmount.toLocaleString('en-IN')}`,
    registration_fee_paid: isRegPaid,
    scholarship_status: claimStatus,
    total_discount: scholarshipAmount,
    expires_at: claim ? claim.expires_at : null,
    timer_hours: timerHours,
    nextStep,
    redirectUrl,
    courseFee: {
      courseId: profile.course_id,
      courseName: profile.course_name,
      originalCourseFee,
      scholarshipAmount,
      finalCourseFee,
      formattedOriginal: `₹${originalCourseFee.toLocaleString('en-IN')}`,
      formattedDiscount: `-₹${scholarshipAmount.toLocaleString('en-IN')}`,
      formattedFinal: `₹${finalCourseFee.toLocaleString('en-IN')}`,
      note: 'Scholarship discount has been applied exclusively to your course tuition fee.'
    },
    registrationFee: {
      paid: isRegPaid,
      amount: feeSummary?.registration_fee != null ? parseFloat(feeSummary.registration_fee) : null,
      note: isRegPaid ? 'Registration fee was paid.' : 'Registration fee must be paid within timer to lock in scholarship.'
    }
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
  const latestClaim = await StudentModel.getLatestScholarshipClaim(effectiveUserId);
  const details = await StudentModel.getStudentAcademicDetails(effectiveUserId);
  const feeSummary = await StudentModel.getStudentFeeAndPaymentSummary(effectiveUserId);

  const courseCodeOrName = profile.course_code || profile.course_name || 'PGDM';
  const defaultStaticConfig = getCourseScholarshipConfig(courseCodeOrName);

  const courseRecord = profile.course_id
    ? await StudentModel.getCourseById(profile.course_id)
    : await StudentModel.getCourseByCodeOrName(courseCodeOrName);

  const isCourseScholarshipActive = courseRecord
    ? (Number(courseRecord.is_scholarship_active) === 1)
    : Boolean(defaultStaticConfig.isEligible);

  const maxCourseScholarship = courseRecord
    ? (parseFloat(courseRecord.scholarship_amount) || 0)
    : (defaultStaticConfig.maxScholarship || 0);

  const dbDistributions = await StudentModel.getCourseScholarshipDistributions(
    profile.course_id || (courseRecord ? courseRecord.id : null)
  );

  let twelfthDist = null;
  let ugDist = null;
  let certDist = null;
  let counselorDist = null;

  if (dbDistributions && dbDistributions.length > 0) {
    twelfthDist = dbDistributions.find(d => d.category === 'twelfth');
    ugDist = dbDistributions.find(d => d.category === 'ug');
    certDist = dbDistributions.find(d => d.category === 'certification');
    counselorDist = dbDistributions.find(d => d.category === 'counselor');
  }

  const isEligibleCourse = defaultStaticConfig.isEligible && isCourseScholarshipActive;

  const dynamicTwelfthMerit = (twelfthDist && Number(twelfthDist.is_active) === 1)
    ? parseFloat(twelfthDist.amount)
    : (defaultStaticConfig.twelfthMerit || 0);

  const dynamicUgMerit = (ugDist && Number(ugDist.is_active) === 1)
    ? parseFloat(ugDist.amount)
    : (defaultStaticConfig.ugMerit || 0);

  const isCertActive = Boolean(certDist && Number(certDist.is_active) === 1);
  const isCounselorActive = Boolean(counselorDist && Number(counselorDist.is_active) === 1);

  const configuredCertAllocation = isCertActive ? (parseFloat(certDist.amount) || 0) : 0;
  const configuredCounselorAllocation = isCounselorActive
    ? (parseFloat(counselorDist.amount) || 0)
    : (defaultStaticConfig.maxPromoBalance || 0);

  const twelfthMinPct = (typeof twelfthDist?.eligibility_config === 'string'
    ? JSON.parse(twelfthDist.eligibility_config)
    : twelfthDist?.eligibility_config)?.min_percentage ?? 65;

  const ugMinPct = (typeof ugDist?.eligibility_config === 'string'
    ? JSON.parse(ugDist.eligibility_config)
    : ugDist?.eligibility_config)?.min_percentage ?? 65;

  const dynamicCourseConfig = {
    ...defaultStaticConfig,
    name: courseRecord?.name || profile.course_name || defaultStaticConfig.name,
    type: courseRecord?.code || profile.course_code || defaultStaticConfig.type,
    isEligible: isEligibleCourse,
    isScholarshipActive: isCourseScholarshipActive,
    maxScholarship: maxCourseScholarship,
    twelfthMerit: dynamicTwelfthMerit,
    ugMerit: dynamicUgMerit,
    certMerit: configuredCertAllocation,
    counselorAllocation: configuredCounselorAllocation,
    configuredCertAllocation,
    configuredCounselorAllocation,
    twelfthMinPercentage: twelfthMinPct,
    ugMinPercentage: ugMinPct,
    distributions: (dbDistributions || []).map(d => ({
      category: d.category,
      amount: parseFloat(d.amount),
      is_active: Number(d.is_active) === 1,
      isActive: Number(d.is_active) === 1,
      eligibility_config: typeof d.eligibility_config === 'string' ? JSON.parse(d.eligibility_config) : d.eligibility_config,
      eligibilityConfig: typeof d.eligibility_config === 'string' ? JSON.parse(d.eligibility_config) : d.eligibility_config
    }))
  };

  const originalCourseFee = feeSummary && feeSummary.original_total_fee != null ? parseFloat(feeSummary.original_total_fee) : null;
  const claimStatus = latestClaim?.status || 'not_applied';
  const isLockedIn = claimStatus === 'locked_in' || claimStatus === 'used';
  const isRegPaid = Boolean(
    feeSummary?.registration_payment_status === 'successful' ||
    (await StudentModel.hasSuccessfulRegistrationPayment(effectiveUserId))
  );
  const applicableDiscount = (isRegPaid && isLockedIn && latestClaim?.total_discount != null)
    ? Math.max(0, parseFloat(latestClaim.total_discount) || 0)
    : 0.00;
  const finalCourseFee = originalCourseFee !== null
    ? Math.max(0, originalCourseFee - applicableDiscount)
    : null;

  let breakdown = null;
  let hasValidCert = false;
  let transferredCert = 0;
  let effectiveCounselor = configuredCounselorAllocation;

  if (details && isEligibleCourse) {
    const twelfthPct = parseFloat(details.twelfth_percentage) || 0;
    const ugPct = parseFloat(details.ug_percentage) || 0;
    const awarded12th = (twelfthPct >= twelfthMinPct && dynamicTwelfthMerit > 0) ? dynamicTwelfthMerit : 0;
    const awardedUG = (ugPct >= ugMinPct && dynamicUgMerit > 0) ? dynamicUgMerit : 0;

    const rawCerts = typeof details.certifications === 'string' ? JSON.parse(details.certifications || '[]') : (details.certifications || []);
    const certUploads = typeof details.certificate_uploads === 'string' ? JSON.parse(details.certificate_uploads || '[]') : (details.certificate_uploads || []);
    const certEvaluation = evaluateCertifications(rawCerts, certUploads);
    hasValidCert = certEvaluation.hasValidCert;

    let awardedCert = 0;
    if (hasValidCert && isCertActive) {
      awardedCert = configuredCertAllocation;
      transferredCert = 0;
      effectiveCounselor = configuredCounselorAllocation;
    } else {
      awardedCert = 0;
      if (isCounselorActive) {
        transferredCert = configuredCertAllocation;
        effectiveCounselor = configuredCounselorAllocation + transferredCert;
      } else {
        transferredCert = 0;
        effectiveCounselor = 0;
      }
    }

    const savedScholarshipAmt = parseFloat(details.scholarship_amount) || 0;
    const promoAmt = details.promo_code ? (savedScholarshipAmt - (awarded12th + awardedUG + awardedCert)) : 0;
    const awardedCounselor = Math.max(0, Math.min(promoAmt, effectiveCounselor));

    breakdown = {
      courseName: profile.course_name,
      courseCode: profile.course_code,
      maxCap: maxCourseScholarship,
      courseMaxScholarship: maxCourseScholarship,
      twelfthAmount: awarded12th,
      ugAmount: awardedUG,
      certificationAmount: awardedCert,
      promoAmount: awardedCounselor,
      totalScholarshipAmount: savedScholarshipAmt,
      certificationSubmitted: hasValidCert,
      certificationAllocation: configuredCertAllocation,
      transferredCertificationAllocation: transferredCert,
      configuredCounselorAllocation,
      effectiveCounselorAllocation: effectiveCounselor
    };
  } else if (isEligibleCourse) {
    if (isCounselorActive) {
      transferredCert = configuredCertAllocation;
      effectiveCounselor = configuredCounselorAllocation + transferredCert;
    }
  }

  return {
    student: {
      name: profile.full_name,
      studentId: profile.student_id,
      applicationNo: profile.application_no,
      email: profile.email,
      course: profile.course_name,
      courseCode: profile.course_code,
      courseId: profile.course_id,
      courseType: dynamicCourseConfig.type,
      isScholarshipEligible: isEligibleCourse,
      isScholarshipActive: isCourseScholarshipActive,
      specialization: profile.specialization_name,
      applicationStatus: profile.application_status,
      isActive: Boolean(profile.is_active)
    },
    courseConfig: dynamicCourseConfig,
    isScholarshipEligible: isEligibleCourse,
    is_scholarship_active: isCourseScholarshipActive,
    isScholarshipActive: isCourseScholarshipActive,
    scholarship_status: claimStatus,
    scholarshipStatus: claimStatus,
    expires_at: latestClaim?.expires_at || null,
    expiresAt: latestClaim?.expires_at || null,
    scholarshipClaim: latestClaim ? {
      id: latestClaim.id,
      status: claimStatus,
      totalDiscount: parseFloat(latestClaim.total_discount || 0),
      expiresAt: latestClaim.expires_at,
      createdAt: latestClaim.created_at
    } : null,
    distributions: dynamicCourseConfig.distributions,
    max_scholarship: maxCourseScholarship,
    maxScholarship: maxCourseScholarship,
    configuredCertAllocation,
    configuredCounselorAllocation,
    transferredCertificationAllocation: transferredCert,
    effectiveCounselorAllocation: effectiveCounselor,
    certificationSubmitted: hasValidCert,
    scholarshipBreakdown: breakdown,
    courseFee: {
      originalCourseFee,
      scholarshipCode: isLockedIn ? (details?.promo_code || null) : null,
      scholarshipAmount: applicableDiscount,
      finalCourseFee,
      formattedOriginal: originalCourseFee !== null ? `₹${originalCourseFee.toLocaleString('en-IN')}` : '₹0',
      formattedDiscount: `-₹${applicableDiscount.toLocaleString('en-IN')}`,
      formattedFinal: finalCourseFee !== null ? `₹${finalCourseFee.toLocaleString('en-IN')}` : '₹0'
    },
    registrationFee: {
      amount: feeSummary?.registration_fee != null ? parseFloat(feeSummary.registration_fee) : null,
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

  const latestClaim = await StudentModel.getLatestScholarshipClaim(userId);

  // Critical Financial Rule: Registration fee comes from student enrollment snapshot and receives ZERO scholarship discount
  const originalRegFee = (feeDetails.original_registration_fee !== null && feeDetails.original_registration_fee !== undefined)
    ? parseFloat(feeDetails.original_registration_fee)
    : null;
  const scholarshipDiscount = 0.00;
  const finalRegFee = originalRegFee;

  const isPaid = feeDetails.reg_payment_status === 'successful';

  return {
    scholarship_status: latestClaim ? latestClaim.status : 'none',
    expires_at: latestClaim ? latestClaim.expires_at : null,
    scholarshipStatus: latestClaim ? latestClaim.status : 'none',
    expiresAt: latestClaim ? latestClaim.expires_at : null,
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
      totalCourseFee: feeDetails.course_total_fee != null ? parseFloat(feeDetails.course_total_fee) : null,
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

const generateCcavenueOrderId = (prefix = 'LIBA') => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const suffix = String(Date.now()).slice(-6) + String(crypto.randomInt(100, 999));
  return `${prefix}${y}${m}${d}${suffix}`;
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

  // Critical Financial Rule: Fee comes strictly from server DB enrollment snapshot, never frontend input or guessed fallbacks
  if (feeDetails.fee_snapshot_missing || feeDetails.original_registration_fee === null || feeDetails.original_registration_fee === undefined || isNaN(parseFloat(feeDetails.original_registration_fee))) {
    const error = new Error('Student enrollment registration fee snapshot is missing and requires administrator reconciliation.');
    error.statusCode = 409;
    error.code = 'FEE_SNAPSHOT_MISSING';
    throw error;
  }
  const originalRegFee = parseFloat(feeDetails.original_registration_fee);
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

const MIN_COURSE_FEE_PAYMENT = 20000;

export const initiateCoursePayment = async (userId, requestOptions = {}) => {
  const ctx = await StudentModel.getCourseFeePaymentContext(userId);
  if (!ctx) {
    const error = new Error('Student enrollment details not found.');
    error.statusCode = 404;
    throw error;
  }

  const requestedEnrollmentId = requestOptions.enrollmentId || requestOptions.enrollment_id;
  if (requestedEnrollmentId && Number(requestedEnrollmentId) !== Number(ctx.enrollment_id)) {
    const error = new Error('Enrollment does not match authenticated student.');
    error.statusCode = 403;
    error.code = 'ENROLLMENT_OWNERSHIP_MISMATCH';
    throw error;
  }

  if (ctx.fee_snapshot_missing || ctx.original_total_fee === null) {
    const error = new Error('Student enrollment course fee snapshot is missing and requires administrator reconciliation.');
    error.statusCode = 409;
    error.code = 'FEE_SNAPSHOT_MISSING';
    throw error;
  }

  const isRegPaid = Boolean(
    ctx.registration_fee_paid ||
    (await StudentModel.hasSuccessfulRegistrationPayment(userId))
  );

  if (!isRegPaid) {
    const error = new Error('Complete your registration fee payment to unlock Course Fee payment.');
    error.statusCode = 403;
    error.code = 'REGISTRATION_FEE_REQUIRED';
    error.redirectUrl = '../payment/';
    throw error;
  }

  const claim = await StudentModel.getLatestScholarshipClaim(userId);
  const isLockedIn = claim && claim.status === 'locked_in';
  const originalCourseFee = Math.max(0, Number(ctx.original_total_fee || ctx.total_fee) || 0);
  const savedClaimDiscount = (claim != null && claim.total_discount !== null && claim.total_discount !== undefined)
    ? Math.max(0, parseFloat(claim.total_discount) || 0)
    : 0;
  const applicableDiscount = isLockedIn ? savedClaimDiscount : 0;
  const totalFee = Math.max(0, originalCourseFee - applicableDiscount);
  const amountPaid = Math.min(totalFee, Math.max(0, Number(ctx.amount_paid) || 0));
  const balance = Math.max(0, Math.round((totalFee - amountPaid) * 100) / 100);

  if (balance <= 0) {
    return {
      alreadyPaid: true,
      message: 'Course fee is already fully paid.',
      redirectUrl: '../dashboard/'
    };
  }

  const minPayable = Math.min(MIN_COURSE_FEE_PAYMENT, balance);
  const rawAmount = Number(requestOptions.amount);
  const payableAmount = Number.isFinite(rawAmount) ? Math.round(rawAmount * 100) / 100 : NaN;

  if (!Number.isFinite(payableAmount) || payableAmount <= 0) {
    const error = new Error('Please enter a valid payment amount.');
    error.statusCode = 400;
    throw error;
  }
  if (payableAmount < minPayable) {
    const error = new Error(`Minimum payable course fee amount is INR ${minPayable.toFixed(2)}.`);
    error.statusCode = 400;
    throw error;
  }
  if (payableAmount > balance) {
    const error = new Error(`Amount cannot exceed your pending course fee balance of INR ${balance.toFixed(2)}.`);
    error.statusCode = 400;
    throw error;
  }

  const gatewayConfig = CcavenueService.assertCcavenueReady();

  const formattedAmount = payableAmount.toFixed(2);
  const currency = 'INR';
  const language = requestOptions.language || 'EN';
  const requestType = requestOptions.request_type || 'payment_initiation';
  const billingName = ctx.full_name || ctx.first_name || 'Student';
  const billingEmail = ctx.email;
  const courseTitle = ctx.course_name || 'LIBA Online Programme';

  if (!billingName || !billingEmail || !ctx.enrollment_id) {
    const error = new Error('Incomplete student enrollment details for payment initiation.');
    error.statusCode = 400;
    throw error;
  }

  const orderId = generateCcavenueOrderId('LIBACRS');
  const tid = generateCcavenueTid();

  const insertedId = await StudentModel.recordCoursePaymentOrder({
    userId: ctx.user_id,
    enrollmentId: ctx.enrollment_id,
    amount: payableAmount,
    orderId,
    tid,
    currency,
    paymentGateway: 'ccavenue'
  });

  const billingPhone = ctx.mobile_number
    ? `${ctx.country_code || '+91'}${ctx.mobile_number}`
    : '';

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
    merchant_param3: 'course_fee',
    merchant_param4: billingPhone
  });

  let encRequest;
  try {
    encRequest = CcavenueService.encrypt(merchantData, gatewayConfig.workingKey);
  } catch (encryptErr) {
    await StudentModel.updateNonSuccessCoursePayment({
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

export const initiatePayment = async (userId, requestOptions = {}) => {
  if (requestOptions && requestOptions.paymentType === 'course_fee') {
    return initiateCoursePayment(userId, requestOptions);
  }
  return initiateRegistrationPayment(userId, requestOptions);
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
    merchantParam1,
    merchantParam3
  } = extracted;

  let isCourseFee = merchantParam3 === 'course_fee' || orderId.startsWith('LIBACRS');
  const findById = (id) => (isCourseFee ? StudentModel.findCoursePaymentById(id) : StudentModel.findRegistrationPaymentById(id));
  const findByOrderId = (oid) => (isCourseFee ? StudentModel.findCoursePaymentByOrderId(oid) : StudentModel.findRegistrationPaymentByOrderId(oid));
  const updateNonSuccess = (payload) => (isCourseFee
    ? StudentModel.updateNonSuccessCoursePayment(payload)
    : StudentModel.updateNonSuccessRegistrationPayment(payload));

  // Locate payment record via merchant_param1 first (per PHP handler flow), then fallback to order_id
  let existingOrder = null;
  if (merchantParam1) {
    existingOrder = await findById(merchantParam1);
    if (!existingOrder && !isCourseFee) {
      const courseOrder = await StudentModel.findCoursePaymentByOrderId(orderId);
      if (courseOrder) {
        isCourseFee = true;
        existingOrder = courseOrder;
      }
    }
    if (!existingOrder || existingOrder.order_id !== orderId) {
      if (existingOrder) {
        await updateNonSuccess({
          orderId: existingOrder.order_id,
          paymentStatus: 'failed',
          trackingId,
          bankRefNo,
          paymentMode,
          rawResponse: { ...parsed, verificationError: 'order_id mismatch with merchant_param1' }
        });
      }
      const typeSuffix = isCourseFee ? '&type=course_fee' : '';
      return {
        statusCode: 400,
        outcome: 'ownership_mismatch',
        redirectUrl: `${failedBaseUrl}?status=invalid_response&orderId=${encodeURIComponent(orderId)}${typeSuffix}`,
        message: 'Order reference mismatch with payment record ID.'
      };
    }
  } else {
    existingOrder = await findByOrderId(orderId);
    if (!existingOrder && !isCourseFee) {
      const courseOrder = await StudentModel.findCoursePaymentByOrderId(orderId);
      if (courseOrder) {
        isCourseFee = true;
        existingOrder = courseOrder;
      }
    }
  }

  const typeSuffix = isCourseFee ? '&type=course_fee' : '';
  const paymentTypeLabel = isCourseFee ? 'Course Fee' : 'Registration Fee';

  if (!existingOrder) {
    return {
      statusCode: 404,
      redirectUrl: `${failedBaseUrl}?status=unknown_order&orderId=${encodeURIComponent(orderId)}${typeSuffix}`,
      outcome: 'unknown_order',
      message: `Order ${orderId} not found.`
    };
  }

  const normalizedStatus = orderStatus.toLowerCase();
  const returnedAmount = returnedAmountStr !== null ? parseFloat(returnedAmountStr) : NaN;

  // Idempotency & never overwrite an already successful transaction
  const alreadyVerified = isCourseFee
    ? existingOrder.payment_status === 'successful'
    : (existingOrder.payment_status === 'successful' && existingOrder.is_active);

  if (alreadyVerified) {
    return {
      statusCode: 302,
      alreadyProcessed: true,
      outcome: 'already_paid',
      redirectUrl: `${successBaseUrl}?orderId=${encodeURIComponent(orderId)}&trackingId=${encodeURIComponent(existingOrder.tracking_id || existingOrder.transaction_id || '')}&duplicate=1${typeSuffix}`,
      message: isCourseFee ? 'Course fee payment already verified.' : 'Payment already verified and account is active.'
    };
  }

  const expectedAmount = parseFloat(isCourseFee ? existingOrder.amount : existingOrder.final_reg_fee);
  const expectedCurrency = String(existingOrder.currency || 'INR').trim().toUpperCase();

  if (normalizedStatus === 'success') {
    const amountValid = Number.isFinite(returnedAmount) && Math.abs(returnedAmount - expectedAmount) <= 0.01;
    const currencyValid = returnedCurrency === expectedCurrency;

    if (!amountValid || !currencyValid) {
      await (isCourseFee ? StudentModel.updateNonSuccessCoursePayment : StudentModel.updateNonSuccessRegistrationPayment)({
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
        redirectUrl: `${failedBaseUrl}?status=amount_mismatch&orderId=${encodeURIComponent(orderId)}${typeSuffix}`,
        message: 'Payment amount or currency verification failed.'
      };
    }

    // For registration payments: also strictly verify against student's saved enrollment registration fee snapshot
    if (!isCourseFee) {
      const regFeeDetails = await StudentModel.getRegistrationFeeDetails(existingOrder.user_id);
      const savedRegFee = regFeeDetails && regFeeDetails.original_registration_fee != null
        ? parseFloat(regFeeDetails.original_registration_fee)
        : null;

      if (savedRegFee !== null && Math.abs(returnedAmount - savedRegFee) > 0.01) {
        await StudentModel.updateNonSuccessRegistrationPayment({
          orderId,
          paymentStatus: 'failed',
          trackingId,
          bankRefNo,
          paymentMode,
          rawResponse: {
            ...parsed,
            verificationError: `Payment amount ₹${returnedAmount.toFixed(2)} differs from student saved Registration Fee snapshot ₹${savedRegFee.toFixed(2)}.`
          }
        });

        return {
          statusCode: 400,
          outcome: 'amount_mismatch',
          redirectUrl: `${failedBaseUrl}?status=amount_mismatch&orderId=${encodeURIComponent(orderId)}`,
          message: 'Payment amount does not match student authoritative registration fee snapshot.'
        };
      }
    }

    let actualGatewayDate = null;
    if (parsed.trans_date) {
      const parts = String(parsed.trans_date).trim().split(/[\s/:-]+/);
      if (parts.length >= 6) {
        if (parts[0].length === 4) {
          actualGatewayDate = `${parts[0]}-${parts[1]}-${parts[2]} ${parts[3]}:${parts[4]}:${parts[5]}`;
        } else if (parts[2].length === 4) {
          actualGatewayDate = `${parts[2]}-${parts[1]}-${parts[0]} ${parts[3]}:${parts[4]}:${parts[5]}`;
        }
      }
    }

    let result;
    try {
      result = await (isCourseFee ? StudentModel.completeCoursePayment : StudentModel.completeRegistrationPayment)({
        orderId,
        transactionId: trackingId || bankRefNo || orderId,
        trackingId,
        bankRefNo,
        paymentMode,
        actualPaymentDate: actualGatewayDate,
        rawResponse: parsed
      });
    } catch (completeErr) {
      if (completeErr.code === 'DUPLICATE_TRANSACTION_REFERENCE') {
        await (isCourseFee ? StudentModel.updateNonSuccessCoursePayment : StudentModel.updateNonSuccessRegistrationPayment)({
          orderId,
          paymentStatus: 'failed',
          trackingId,
          bankRefNo,
          paymentMode,
          rawResponse: { ...parsed, verificationError: completeErr.message }
        });
        return {
          statusCode: 409,
          outcome: 'duplicate_reference',
          redirectUrl: `${failedBaseUrl}?status=duplicate_reference&orderId=${encodeURIComponent(orderId)}${typeSuffix}`,
          message: completeErr.message
        };
      }
      throw completeErr;
    }

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
          paymentType: paymentTypeLabel,
          courseName,
          applicationNumber: existingOrder.application_no || 'N/A',
          paidAt
        });
      } catch (mailErr) {
        console.error('[EMAIL-ERROR] Failed to send payment success email:', mailErr.message);
      }

      if (!isCourseFee) {
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
    }

    const queryParams = new URLSearchParams({
      orderId,
      trackingId: trackingId || result.order?.transaction_id || '',
      bankRefNo: bankRefNo || '',
      status: 'success'
    });
    if (isCourseFee) queryParams.set('type', 'course_fee');

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

  const updateRes = await (isCourseFee ? StudentModel.updateNonSuccessCoursePayment : StudentModel.updateNonSuccessRegistrationPayment)({
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
      redirectUrl: `${successBaseUrl}?orderId=${encodeURIComponent(orderId)}&trackingId=${encodeURIComponent(updateRes.order.tracking_id || updateRes.order.transaction_id || '')}&duplicate=1${typeSuffix}`,
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
        paymentType: paymentTypeLabel,
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
  if (isCourseFee) failQuery.set('type', 'course_fee');

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
