import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query } from '../config/database.js';

export const authenticate = (req, res, next) => {
  try {
    let token = null;

    // 1. Check Authorization Bearer header first (explicit client token)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const candidate = authHeader.split(' ')[1];
      if (candidate && candidate !== 'null' && candidate !== 'undefined') {
        token = candidate;
      }
    }

    // 2. Fallback to HTTP-only cookie (prefer admin cookie on admin/notification routes)
    if (!token && req.cookies) {
      const isAdminRoute =
        req.baseUrl.startsWith('/api/v1/admin') ||
        req.baseUrl.startsWith('/api/v1/notifications');
      if (isAdminRoute && req.cookies[env.adminCookieName]) {
        token = req.cookies[env.adminCookieName];
      } else if (req.cookies[env.cookieName]) {
        token = req.cookies[env.cookieName];
      }
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.',
        errors: []
      });
    }

    const decoded = jwt.verify(token, env.jwtSecret);
    const userId = decoded.userId || decoded.id || decoded.sub;
    req.user = {
      ...decoded,
      userId,
      id: userId
    };
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please log in again.',
        errors: []
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid authentication token.',
      errors: []
    });
  }
};

export const requireStudent = (req, res, next) => {
  if (!req.user || req.user.role !== 'student') {
    return res.status(403).json({
      success: false,
      message: 'Access denied: Student access required.',
      errors: []
    });
  }
  next();
};

export const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Administrator access required.',
        errors: []
      });
    }

    const userId = req.user.userId || req.user.id;
    const rows = await query(
      'SELECT id, role FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    if (!rows || rows.length === 0 || rows[0].role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Administrator access required.',
        errors: []
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const requireActiveStudent = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'student') {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Student access required.',
        errors: []
      });
    }

    const userId = req.user.userId || req.user.id;
    const rows = await query(
      `SELECT u.is_active, u.is_verified, sp.application_status 
       FROM users u 
       LEFT JOIN student_profiles sp ON sp.user_id = u.id 
       WHERE u.id = ? 
       LIMIT 1`,
      [userId]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
        errors: []
      });
    }

    const user = rows[0];

    if (!user.is_active) {
      let nextStep = 'scholarship';
      let redirectUrl = '../scholarship/';
      let message = 'Account activation required. Please complete your application.';

      if (
        user.application_status === 'awaiting_payment' ||
        user.application_status === 'payment_pending' ||
        user.application_status === 'payment_failed'
      ) {
        nextStep = 'payment';
        redirectUrl = '../payment/';
        message = 'Account activation required. Please complete your registration fee payment.';
      } else if (!user.is_verified) {
        nextStep = 'otp';
        redirectUrl = '../otpfor/';
        message = 'Please verify your email address to proceed.';
      }

      return res.status(403).json({
        success: false,
        isActive: false,
        applicationStatus: user.application_status,
        nextStep,
        redirectUrl,
        message,
        errors: []
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};
