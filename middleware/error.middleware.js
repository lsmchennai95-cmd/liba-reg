export const notFoundHandler = (req, res, next) => {
  return res.status(404).json({
    success: false,
    message: `Resource not found: ${req.method} ${req.originalUrl}`,
    errors: []
  });
};

export const errorHandler = (err, req, res, next) => {
  // Never expose raw stack traces in responses
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[API ERROR] ${req.method} ${req.originalUrl} -`, err.message);
  }

  // Handle MySQL Duplicate Entry
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      success: false,
      message: 'A record with this information already exists',
      errors: []
    });
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid authorization token',
      errors: []
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Authorization token has expired',
      errors: []
    });
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  return res.status(statusCode).json({
    success: false,
    message,
    errors: err.errors || []
  });
};
