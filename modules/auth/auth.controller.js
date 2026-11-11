import * as AuthService from './auth.service.js';
import { env } from '../../config/env.js';

const getCookieOptions = () => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.isProduction ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/'
});

const setAuthCookie = (res, token) => {
  res.cookie(env.cookieName, token, getCookieOptions());
};

const clearAuthCookie = (res) => {
  const options = getCookieOptions();
  delete options.maxAge;
  res.clearCookie(env.cookieName, options);
};

export const register = async (req, res, next) => {
  try {
    const result = await AuthService.registerStudent(req.body);

    // Note: Per security requirements, NO authenticated session cookie is issued prior to OTP verification.
    return res.status(201).json({
      success: true,
      message: 'Student registered successfully. Please verify your OTP to activate your account.',
      data: {
        verificationToken: result.verificationToken,
        email: result.email,
        studentId: result.studentId,
        applicationNo: result.applicationNo,
        ...(result.debugOtp ? { debugOtp: result.debugOtp } : {})
      }
    });
  } catch (error) {
    next(error);
  }
};

export const verifyOtp = async (req, res, next) => {
  try {
    const { verificationToken, otp } = req.body;
    const result = await AuthService.verifyOtp(verificationToken, otp);

    if (result.token) {
      setAuthCookie(res, result.token);
    }

    return res.status(200).json({
      success: true,
      message: result.flow === 'registration'
        ? 'Account verified successfully. Please submit your academic details and counselor scholarship code.'
        : 'OTP verified successfully.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const resendOtp = async (req, res, next) => {
  try {
    const { verificationToken } = req.body;
    const result = await AuthService.resendOtp(verificationToken);

    return res.status(200).json({
      success: true,
      message: 'A new OTP has been sent to your email.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await AuthService.loginStudent(email, password);

    // Set secure HTTP-only cookie if token exists
    if (result.token) {
      setAuthCookie(res, result.token);
    }

    return res.status(200).json({
      success: true,
      message: result.message || 'Login successful',
      data: {
        token: result.token,
        user: result.user,
        isActive: result.isActive,
        isVerified: result.isVerified,
        requiresAction: result.requiresAction,
        nextStep: result.nextStep,
        redirectUrl: result.redirectUrl,
        verificationToken: result.verificationToken,
        email: result.email
      }
    });
  } catch (error) {
    next(error);
  }
};

export const logout = (req, res) => {
  clearAuthCookie(res);

  return res.status(200).json({
    success: true,
    message: 'Logged out successfully',
    data: {}
  });
};

export const getMe = async (req, res, next) => {
  try {
    const user = await AuthService.getCurrentUser(req.user.userId);
    return res.status(200).json({
      success: true,
      message: 'Current student profile retrieved successfully',
      data: { user }
    });
  } catch (error) {
    next(error);
  }
};

export const getCourses = async (req, res, next) => {
  try {
    const courses = await AuthService.getCoursesAndSpecializations();
    return res.status(200).json({
      success: true,
      message: 'Courses and specializations retrieved successfully',
      data: { courses }
    });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const result = await AuthService.requestPasswordReset(email);

    return res.status(200).json({
      success: true,
      message: 'Password reset OTP has been sent to your registered email.',
      data: {
        verificationToken: result.verificationToken,
        email: result.email,
        ...(result.debugOtp ? { debugOtp: result.debugOtp } : {})
      }
    });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const { resetToken, newPassword } = req.body;
    const result = await AuthService.resetPassword(resetToken, newPassword);

    return res.status(200).json({
      success: true,
      message: 'Password updated successfully. Please log in with your new credentials.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};
