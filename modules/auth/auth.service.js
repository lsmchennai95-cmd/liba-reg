import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import * as AuthModel from './auth.model.js';
import { sendOtpEmail } from '../../services/email.service.js';
import { triggerRegistrationNotification } from '../notification/notification.service.js';

const generateStudentId = () => {
  const year = new Date().getFullYear();
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `LIBA-STU-${year}-${randomSuffix}`;
};

const generateApplicationNo = () => {
  const year = new Date().getFullYear();
  const randomSuffix = Math.floor(10000 + Math.random() * 90000);
  return `LIBA-APP-${year}-${randomSuffix}`;
};

const signAuthToken = (user) => {
  return jwt.sign(
    {
      userId: user.id || user.user_id,
      email: user.email,
      role: user.role
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
};

export const registerStudent = async (data) => {
  // 1. Validate course & specialization belong together using real DB records
  const validCombo = await AuthModel.validateCourseAndSpecialization(
    data.courseId,
    data.specializationId
  );
  if (!validCombo) {
    const error = new Error('Selected specialization does not belong to the selected course');
    error.statusCode = 400;
    throw error;
  }

  // 2. Check duplicate email
  const existingUser = await AuthModel.findUserByEmail(data.email);
  if (existingUser) {
    const error = new Error('Email is already registered. Please log in or use a different email.');
    error.statusCode = 409;
    throw error;
  }

  // 3. Check duplicate mobile number
  const existingMobile = await AuthModel.findProfileByMobile(data.mobileNumber);
  if (existingMobile) {
    const error = new Error('Mobile number is already registered. Please use a different mobile number.');
    error.statusCode = 409;
    throw error;
  }

  // 4. Hash password with bcrypt
  const passwordHash = await bcrypt.hash(data.password, 10);

  // 5. Generate unique student ID and application number
  const studentId = generateStudentId();
  const applicationNo = generateApplicationNo();

  // 6. Retrieve course fee from database
  const feeRecord = await AuthModel.getCourseFeeByCourseId(data.courseId);
  const totalFee = feeRecord ? parseFloat(feeRecord.total_fee) : 350000.00;

  // 7. Persist user, profile, and enrollment in transaction (with is_verified = 0)
  const { userId } = await AuthModel.registerStudentTransaction({
    userData: {
      email: data.email,
      passwordHash
    },
    profileData: {
      studentId,
      applicationNo,
      firstName: data.firstName,
      lastName: data.lastName,
      countryCode: data.countryCode || '+91',
      mobileNumber: data.mobileNumber,
      termsAccepted: data.terms
    },
    enrollmentData: {
      courseId: data.courseId,
      specializationId: data.specializationId,
      totalFee
    }
  });

  // 8. Generate 4-digit OTP matching frontend format
  const otp = String(Math.floor(1000 + Math.random() * 9000));
  const otpHash = await bcrypt.hash(otp, 10);

  await AuthModel.createOtpRecord({
    userId,
    otpHash,
    purpose: 'registration',
    expiryMinutes: 10
  });

  // 9. Dispatch OTP notification
  await sendOtpEmail({
    to: data.email,
    name: data.firstName,
    otp,
    purpose: 'registration'
  });

  // 10. Trigger internal registration notification asynchronously (never blocks or rolls back registration)
  const fullName = [data.firstName, data.lastName]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  const phone = `${data.countryCode || '+91'} ${data.mobileNumber}`.trim();

  await triggerRegistrationNotification({
    userId,
    fullName,
    email: data.email,
    phone,
    courseName: validCombo.course_name,
    specializationName: validCombo.specialization_name,
    studentId,
    applicationNo,
    registrationStatus: 'pending_verification',
    registeredAt: new Date().toISOString()
  });

  // 11. Issue a server-signed pending verification token (valid for 15 minutes)
  const verificationToken = jwt.sign(
    {
      userId,
      email: data.email,
      purpose: 'otp_verification'
    },
    env.jwtSecret,
    { expiresIn: '15m' }
  );

  return {
    verificationToken,
    email: data.email,
    studentId,
    applicationNo,
    ...(env.nodeEnv !== 'production' ? { debugOtp: otp } : {})
  };
};

export const verifyOtp = async (verificationToken, otp) => {
  // 1. Verify and decode verification token
  let decoded;
  try {
    decoded = jwt.verify(verificationToken, env.jwtSecret);
  } catch (err) {
    const error = new Error('Verification session has expired or is invalid. Please request a new OTP.');
    error.statusCode = 401;
    throw error;
  }

  const isPasswordReset = decoded.purpose === 'password_reset';
  const isRegistration = decoded.purpose === 'otp_verification';

  if (!isPasswordReset && !isRegistration) {
    const error = new Error('Invalid verification token purpose.');
    error.statusCode = 401;
    throw error;
  }

  const userId = decoded.userId;
  const otpPurpose = isPasswordReset ? 'password_reset' : 'registration';

  // 2. Lookup active OTP
  const activeOtp = await AuthModel.findActiveOtp(userId, otpPurpose);
  if (!activeOtp) {
    const error = new Error('No active OTP found. Please request a new OTP.');
    error.statusCode = 400;
    throw error;
  }

  // 3. Check expiration
  if (activeOtp.is_expired) {
    const error = new Error('OTP has expired. Please request a new OTP.');
    error.statusCode = 400;
    throw error;
  }

  // 4. Check max attempts
  if (activeOtp.attempts >= activeOtp.max_attempts) {
    const error = new Error('Maximum verification attempts exceeded. Please request a new OTP.');
    error.statusCode = 400;
    throw error;
  }

  // 5. Increment attempt counter
  await AuthModel.incrementOtpAttempts(activeOtp.id);

  // 6. Compare OTP
  const isMatch = await bcrypt.compare(String(otp).trim(), activeOtp.otp_hash);
  if (!isMatch) {
    const remaining = activeOtp.max_attempts - (activeOtp.attempts + 1);
    const errorMsg = remaining > 0
      ? `Invalid OTP code. You have ${remaining} attempt(s) remaining.`
      : 'Invalid OTP code. Maximum attempts reached. Please request a new OTP.';
    const error = new Error(errorMsg);
    error.statusCode = 400;
    throw error;
  }

  // 7. Mark OTP as used
  await AuthModel.markOtpUsed(activeOtp.id);

  if (isPasswordReset) {
    // Generate a single-use password update token valid for 15 minutes
    const resetToken = jwt.sign(
      {
        userId,
        email: decoded.email,
        purpose: 'password_update'
      },
      env.jwtSecret,
      { expiresIn: '15m' }
    );

    return {
      verified: true,
      email: decoded.email,
      resetToken,
      flow: 'reset'
    };
  }

  // For registration: mark user as verified (account remains inactive until registration payment)
  await AuthModel.markUserVerified(userId);

  const student = await AuthModel.findUserById(userId);
  const token = signAuthToken({ id: student.user_id, email: student.email, role: student.role });

  return {
    verified: true,
    email: decoded.email,
    flow: 'registration',
    token,
    isActive: false,
    nextStep: 'payment',
    redirectUrl: '../payment/',
    user: {
      userId: student.user_id,
      email: student.email,
      role: student.role,
      isActive: false,
      applicationStatus: student.application_status || 'email_verified',
      studentId: student.student_id,
      applicationNo: student.application_no,
      firstName: student.first_name,
      lastName: student.last_name,
      fullName: student.full_name,
      courseName: student.course_name,
      specializationName: student.specialization_name
    }
  };
};

export const resendOtp = async (verificationToken) => {
  // 1. Verify verification token
  let decoded;
  try {
    decoded = jwt.verify(verificationToken, env.jwtSecret);
  } catch (err) {
    const error = new Error('Verification session has expired. Please request a new OTP.');
    error.statusCode = 401;
    throw error;
  }

  const isPasswordReset = decoded.purpose === 'password_reset';
  const isRegistration = decoded.purpose === 'otp_verification';

  if (!isPasswordReset && !isRegistration) {
    const error = new Error('Invalid verification token.');
    error.statusCode = 401;
    throw error;
  }

  const userId = decoded.userId;
  const purpose = isPasswordReset ? 'password_reset' : 'registration';

  // 2. Check user
  const user = await AuthModel.findUserById(userId);
  if (!user) {
    const error = new Error('User not found.');
    error.statusCode = 404;
    throw error;
  }

  if (isRegistration && user.is_verified) {
    const error = new Error('Account is already verified. Please proceed to login.');
    error.statusCode = 400;
    throw error;
  }

  // 3. Cooldown check (30-60 seconds)
  const latestOtp = await AuthModel.getLatestOtp(userId, purpose);
  if (latestOtp && latestOtp.elapsed_seconds != null) {
    const cooldownDuration = 30; // 30 seconds
    if (latestOtp.elapsed_seconds < cooldownDuration) {
      const waitRemaining = Math.ceil(cooldownDuration - latestOtp.elapsed_seconds);
      const error = new Error(`Please wait ${waitRemaining} second(s) before requesting another OTP.`);
      error.statusCode = 429;
      throw error;
    }
  }

  // 4. Generate new 4-digit OTP
  const otp = String(Math.floor(1000 + Math.random() * 9000));
  const otpHash = await bcrypt.hash(otp, 10);

  await AuthModel.createOtpRecord({
    userId,
    otpHash,
    purpose,
    expiryMinutes: 10
  });

  // 5. Send email
  await sendOtpEmail({
    to: decoded.email,
    name: user.first_name,
    otp,
    purpose
  });

  return {
    cooldownSeconds: 30,
    email: decoded.email,
    ...(env.nodeEnv !== 'production' ? { debugOtp: otp } : {})
  };
};

export const requestPasswordReset = async (email) => {
  // 1. Find user by email
  const user = await AuthModel.findUserByEmail(email);
  if (!user) {
    const error = new Error('No user found with the provided email address.');
    error.statusCode = 404;
    throw error;
  }

  if (!user.is_active) {
    const error = new Error('Account is inactive. Please contact administration.');
    error.statusCode = 403;
    throw error;
  }

  const profile = await AuthModel.findUserById(user.id);

  // 2. Generate 4-digit OTP
  const otp = String(Math.floor(1000 + Math.random() * 9000));
  const otpHash = await bcrypt.hash(otp, 10);

  await AuthModel.createOtpRecord({
    userId: user.id,
    otpHash,
    purpose: 'password_reset',
    expiryMinutes: 10
  });

  // 3. Send email with OTP
  await sendOtpEmail({
    to: user.email,
    name: profile ? profile.first_name : 'Student',
    otp,
    purpose: 'password_reset'
  });

  // 4. Sign pending reset verification token
  const verificationToken = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      purpose: 'password_reset'
    },
    env.jwtSecret,
    { expiresIn: '15m' }
  );

  return {
    verificationToken,
    email: user.email,
    ...(env.nodeEnv !== 'production' ? { debugOtp: otp } : {})
  };
};

export const resetPassword = async (resetToken, newPassword) => {
  // 1. Verify reset token
  let decoded;
  try {
    decoded = jwt.verify(resetToken, env.jwtSecret);
  } catch (err) {
    const error = new Error('Password reset session has expired. Please restart the forgot password process.');
    error.statusCode = 401;
    throw error;
  }

  if (decoded.purpose !== 'password_update') {
    const error = new Error('Invalid reset token.');
    error.statusCode = 401;
    throw error;
  }

  const userId = decoded.userId;

  // 2. Hash new password
  const passwordHash = await bcrypt.hash(newPassword, 10);

  // 3. Update password in database
  await AuthModel.updateUserPassword(userId, passwordHash);

  // 4. Invalidate all active OTPs for security
  await AuthModel.createOtpRecord({
    userId,
    otpHash: 'INVALIDATED',
    purpose: 'password_reset',
    expiryMinutes: 0
  });

  return {
    success: true,
    email: decoded.email
  };
};

export const loginStudent = async (email, password) => {
  // 1. Find user by email
  const user = await AuthModel.findUserByEmail(email);
  if (!user) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  // 2. Verify password
  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  // 3. Ensure student login cannot access admin accounts
  if (user.role !== 'student') {
    const error = new Error('Access denied: Student credentials required.');
    error.statusCode = 403;
    throw error;
  }

  // 4. Check email verification: if unverified, send fresh OTP and redirect to OTP page
  if (!user.is_verified) {
    const otp = String(Math.floor(1000 + Math.random() * 9000));
    const otpHash = await bcrypt.hash(otp, 10);
    await AuthModel.createOtpRecord({
      userId: user.id,
      otpHash,
      purpose: 'registration',
      expiryMinutes: 10
    });
    await sendOtpEmail({
      to: user.email,
      name: 'Student',
      otp,
      purpose: 'registration'
    });

    const verificationToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        purpose: 'otp_verification'
      },
      env.jwtSecret,
      { expiresIn: '15m' }
    );

    return {
      success: true,
      requiresAction: true,
      isVerified: false,
      isActive: false,
      nextStep: 'otp',
      redirectUrl: '../otpfor/',
      message: 'Account pending verification. A fresh OTP has been sent to your email.',
      verificationToken,
      email: user.email,
      ...(env.nodeEnv !== 'production' ? { debugOtp: otp } : {})
    };
  }

  // 5. Retrieve full student profile
  const profile = await AuthModel.findUserById(user.id);
  const token = signAuthToken(user);

  // 6. Check account activation: If inactive, student must pay registration fee to activate account
  if (!user.is_active) {
    const nextStep = 'payment';
    const redirectUrl = '../payment/';
    const message = 'Please complete your registration fee payment to activate your account.';

    return {
      success: true,
      requiresAction: true,
      isActive: false,
      isVerified: true,
      nextStep,
      redirectUrl,
      message,
      token,
      user: profile
    };
  }

  // 7. Active account: Proceed to dashboard
  return {
    success: true,
    isActive: true,
    isVerified: true,
    nextStep: 'dashboard',
    redirectUrl: '../dashboard/',
    token,
    user: profile
  };
};

export const getCurrentUser = async (userId) => {
  const profile = await AuthModel.findUserById(userId);
  if (!profile) {
    const error = new Error('Student not found');
    error.statusCode = 404;
    throw error;
  }
  return profile;
};

export const getCoursesAndSpecializations = async () => {
  return AuthModel.getAllActiveCoursesWithSpecializations();
};
