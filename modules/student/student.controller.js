import * as StudentService from './student.service.js';
import { env } from '../../config/env.js';
import { logException, withSafeHandler } from '../../services/errorLogger.service.js';

export const getProfile = async (req, res, next) => {
  try {
    const profile = await StudentService.getStudentProfile(req.user.userId || req.user.id);
    return res.status(200).json({
      success: true,
      message: 'Student profile retrieved successfully',
      data: profile
    });
  } catch (error) {
    next(error);
  }
};

export const getDashboard = async (req, res, next) => {
  try {
    const dashboard = await StudentService.getStudentDashboard(req.user.userId || req.user.id);
    return res.status(200).json({
      success: true,
      message: 'Student dashboard retrieved successfully',
      data: dashboard
    });
  } catch (error) {
    next(error);
  }
};

export const getPayments = async (req, res, next) => {
  try {
    const payments = await StudentService.getStudentPayments(req.user.userId || req.user.id);
    return res.status(200).json({
      success: true,
      message: 'Student payment history retrieved successfully',
      data: { payments }
    });
  } catch (error) {
    next(error);
  }
};

export const validateScholarshipCode = async (req, res, next) => {
  try {
    const { code, course, courseCode } = req.body;
    const result = await StudentService.validateScholarshipCode(code, course || courseCode);
    return res.status(200).json({
      success: true,
      message: 'Scholarship code verified successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const submitAcademicAndScholarship = async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.id;
    const result = await StudentService.submitAcademicAndScholarship(userId, {
      ...req.body,
      userEmail: req.user.email
    });
    return res.status(200).json({
      success: true,
      message: 'Academic details saved and counselor scholarship discount applied to course tuition fee!',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const getAcademicAndScholarship = async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.id;
    const result = await StudentService.getAcademicAndScholarship(userId, req.user.email);
    return res.status(200).json({
      success: true,
      message: 'Academic details and scholarship retrieved successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const getRegistrationFee = withSafeHandler(
  async (req, res) => {
    const userId = req.user.userId || req.user.id;
    const result = await StudentService.getRegistrationFee(userId);
    return res.status(200).json({
      success: true,
      message: 'Registration fee details retrieved successfully',
      data: result
    });
  },
  {
    context: 'students.registrationFee',
    fallbackMessage: 'Unable to load registration fee details right now. Please try again.'
  }
);

export const initiateRegistrationPayment = withSafeHandler(
  async (req, res) => {
    const userId = req.user.userId || req.user.id;
    const result = await StudentService.initiateRegistrationPayment(userId, req.body || {});
    return res.status(200).json({
      success: true,
      message: result.alreadyPaid ? result.message : 'Payment initiated successfully',
      data: result
    });
  },
  {
    context: 'payments.initiate',
    fallbackMessage: 'Payment service is temporarily unavailable. Please try again later.'
  }
);

export const handleCcavenueResponse = async (req, res) => {
  try {
    const encResp = req.body?.encResp || req.query?.encResp || '';
    const result = await StudentService.handleCcavenueResponse({ encResp });
    return res.redirect(302, result.redirectUrl);
  } catch (error) {
    logException(error, { req, endpoint: 'payments.ccavenue.response' });
    const frontendBase = (env.frontendUrl || 'http://localhost:8001').replace(/\/$/, '');
    return res.redirect(302, `${frontendBase}/student/payment-failed/?status=error`);
  }
};

export const getRegistrationStatus = async (req, res, next) => {
  try {
    const userId = req.user.userId || req.user.id;
    const result = await StudentService.getRegistrationStatus(userId);
    return res.status(200).json({
      success: true,
      message: 'Registration lifecycle status retrieved successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};
