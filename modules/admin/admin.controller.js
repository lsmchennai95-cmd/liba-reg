import * as AdminService from './admin.service.js';
import { env } from '../../config/env.js';
import { withSafeHandler } from '../../services/errorLogger.service.js';

const getAdminCookieOptions = () => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.isProduction ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/'
});

export const loginAdmin = withSafeHandler(
  async (req, res) => {
    const { email, password } = req.body;
    const result = await AdminService.loginAdmin(email, password);

    res.cookie(env.adminCookieName || 'liba_admin_token', result.token, getAdminCookieOptions());

    return res.status(200).json({
      success: true,
      message: 'Admin login successful',
      data: result
    });
  },
  {
    context: 'admin.auth.login',
    fallbackMessage: 'Unable to sign in right now. Please try again.'
  }
);

export const logoutAdmin = (req, res) => {
  const options = getAdminCookieOptions();
  delete options.maxAge;
  res.clearCookie(env.adminCookieName || 'liba_admin_token', options);

  return res.status(200).json({
    success: true,
    message: 'Admin logged out successfully',
    data: {}
  });
};

export const getAdminMe = withSafeHandler(
  async (req, res) => {
    const user = await AdminService.getAdminMe(req.user.userId || req.user.id);
    return res.status(200).json({
      success: true,
      message: 'Admin profile retrieved successfully',
      data: { user }
    });
  },
  {
    context: 'admin.auth.me',
    fallbackMessage: 'Unable to verify administrator session.'
  }
);

export const getDashboardStats = withSafeHandler(
  async (req, res) => {
    const stats = await AdminService.getDashboardStats(req.validatedQuery || req.query);
    return res.status(200).json({
      success: true,
      message: 'Admin dashboard statistics retrieved successfully',
      data: stats
    });
  },
  {
    context: 'admin.dashboard.stats',
    fallbackMessage: 'Unable to load dashboard metrics right now. Please try again.'
  }
);

export const getStudents = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.getStudents(req.validatedQuery || req.query);
    return res.status(200).json({
      success: true,
      message: 'Students retrieved successfully',
      data
    });
  },
  {
    context: 'admin.students.list',
    fallbackMessage: 'Unable to load student records right now. Please try again.'
  }
);

export const getStudentById = withSafeHandler(
  async (req, res) => {
    const student = await AdminService.getStudentById(req.params.id);
    return res.status(200).json({
      success: true,
      message: 'Student details retrieved successfully',
      data: { student }
    });
  },
  {
    context: 'admin.students.detail',
    fallbackMessage: 'Unable to load student details right now. Please try again.'
  }
);

export const getStudentPayments = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.getStudentPayments(req.params.id);
    return res.status(200).json({
      success: true,
      message: 'Student payment history retrieved successfully',
      data
    });
  },
  {
    context: 'admin.students.payments',
    fallbackMessage: 'Unable to load student payment history right now. Please try again.'
  }
);

export const getPayments = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.getPayments(req.validatedQuery || req.query);
    return res.status(200).json({
      success: true,
      message: 'Payment transactions retrieved successfully',
      data
    });
  },
  {
    context: 'admin.payments.list',
    fallbackMessage: 'Unable to load payment transactions right now. Please try again.'
  }
);

export const getScholarshipTimer = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.getScholarshipTimer();
    return res.status(200).json({
      success: true,
      message: 'Scholarship timer setting retrieved successfully',
      data
    });
  },
  {
    context: 'admin.settings.getTimer',
    fallbackMessage: 'Unable to retrieve scholarship timer setting.'
  }
);

export const updateScholarshipTimer = withSafeHandler(
  async (req, res) => {
    const hours = req.body.hours ?? req.body.scholarship_timer_hours;
    const data = await AdminService.updateScholarshipTimer(hours);
    return res.status(200).json({
      success: true,
      message: 'Scholarship timer setting updated successfully',
      data
    });
  },
  {
    context: 'admin.settings.updateTimer',
    fallbackMessage: 'Unable to update scholarship timer setting.'
  }
);

export const reactivateStudentTimer = withSafeHandler(
  async (req, res) => {
    const minutes = req.body?.minutes ?? 10;
    const data = await AdminService.reactivateStudentTimer(req.params.id, minutes);
    return res.status(200).json({
      success: true,
      message: 'Scholarship timer reactivated successfully',
      data
    });
  },
  {
    context: 'admin.students.reactivateTimer',
    fallbackMessage: 'Unable to reactivate scholarship timer.'
  }
);


