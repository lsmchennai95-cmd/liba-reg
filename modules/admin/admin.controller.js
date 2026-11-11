import * as AdminService from './admin.service.js';
import { env } from '../../config/env.js';

const getAdminCookieOptions = () => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.isProduction ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/'
});

export const loginAdmin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await AdminService.loginAdmin(email, password);

    res.cookie(env.adminCookieName, result.token, getAdminCookieOptions());

    return res.status(200).json({
      success: true,
      message: 'Admin login successful',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const logoutAdmin = (req, res) => {
  const options = getAdminCookieOptions();
  delete options.maxAge;
  res.clearCookie(env.adminCookieName, options);

  return res.status(200).json({
    success: true,
    message: 'Admin logged out successfully',
    data: {}
  });
};

export const getAdminMe = async (req, res, next) => {
  try {
    const user = await AdminService.getAdminMe(req.user.userId || req.user.id);
    return res.status(200).json({
      success: true,
      message: 'Admin profile retrieved successfully',
      data: { user }
    });
  } catch (error) {
    next(error);
  }
};

export const getDashboardStats = async (req, res, next) => {
  try {
    const stats = await AdminService.getDashboardStats(req.validatedQuery || req.query);
    return res.status(200).json({
      success: true,
      message: 'Admin dashboard statistics retrieved successfully',
      data: stats
    });
  } catch (error) {
    next(error);
  }
};

export const getStudents = async (req, res, next) => {
  try {
    const data = await AdminService.getStudents(req.validatedQuery || req.query);
    return res.status(200).json({
      success: true,
      message: 'Students retrieved successfully',
      data
    });
  } catch (error) {
    next(error);
  }
};

export const getStudentById = async (req, res, next) => {
  try {
    const student = await AdminService.getStudentById(req.params.id);
    return res.status(200).json({
      success: true,
      message: 'Student details retrieved successfully',
      data: { student }
    });
  } catch (error) {
    next(error);
  }
};

export const getStudentPayments = async (req, res, next) => {
  try {
    const data = await AdminService.getStudentPayments(req.params.id);
    return res.status(200).json({
      success: true,
      message: 'Student payment history retrieved successfully',
      data
    });
  } catch (error) {
    next(error);
  }
};

export const getPayments = async (req, res, next) => {
  try {
    const data = await AdminService.getPayments(req.validatedQuery || req.query);
    return res.status(200).json({
      success: true,
      message: 'Payment transactions retrieved successfully',
      data
    });
  } catch (error) {
    next(error);
  }
};

