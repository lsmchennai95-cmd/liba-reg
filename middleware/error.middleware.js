import { sendSafeErrorResponse } from '../services/errorLogger.service.js';

export const notFoundHandler = (req, res, next) => {
  return res.status(404).json({
    success: false,
    message: 'Requested endpoint not found.',
    errors: []
  });
};

export const errorHandler = (err, req, res, next) => {
  return sendSafeErrorResponse(err, req, res, {
    context: `${req.method} ${req.originalUrl}`
  });
};
