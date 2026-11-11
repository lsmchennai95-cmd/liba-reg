import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_LOG_DIR = path.resolve(__dirname, '../logs');
const getLogDir = () => (process.env.ERROR_LOG_DIR ? path.resolve(process.env.ERROR_LOG_DIR) : DEFAULT_LOG_DIR);
const getErrorLogPath = () => path.join(getLogDir(), 'error.log');

export const SAFE_MESSAGES = {
  400: 'Invalid request. Please check your input and try again.',
  401: 'Authentication required. Please log in and try again.',
  403: 'You do not have permission to perform this action.',
  404: 'The requested resource was not found.',
  409: 'A record with this information already exists.',
  429: 'Too many requests. Please wait a moment and try again.',
  500: 'An unexpected server error occurred. Please try again later.',
  503: 'Service is temporarily unavailable. Please try again later.',
  GATEWAY_UNAVAILABLE: 'Payment gateway is temporarily unavailable. Please try again later or contact support.',
  DATABASE_ERROR: 'A temporary service error occurred while processing your request. Please try again later.'
};

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH'
]);

const SENSITIVE_PATTERNS = [
  /\b(?:CCAVENUE|DB|JWT|SMTP|COOKIE|ADMIN|NODE|PORT|CORS|FRONTEND|EMAIL|NOTIFICATION)_[A-Z0-9_]+\b/,
  /\bNODE_ENV\b/,
  /\b(?:sqlState|sqlMessage|Unknown database|Unknown column|ER_[A-Z0-9_]+|PROTOCOL_[A-Z0-9_]+)\b/i,
  /Table\s+'[^']+'\s+doesn't exist/i,
  /\b(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b[\s\S]*\b(?:FROM|INTO|TABLE|WHERE|SET)\b/i,
  /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|AggregateError|TypeError|ReferenceError|SyntaxError)\b/,
  /\bat\s+[^\n]+\s+\([^\n]+:\d+:\d+\)/,
  /[A-Za-z]:\\[^\s]+|\/(?:src|node_modules|modules|services)\/[^\s]+/
];

/**
 * Create an Error carrying a safe public message and separate internal diagnostics for logging.
 */
export const createSafeError = ({
  message,
  internalMessage,
  statusCode = 500,
  code = 'INTERNAL_ERROR',
  isOperational = true,
  isGatewayConfigError = false,
  metadata = null,
  errors = []
}) => {
  const safeMessage = message || SAFE_MESSAGES[statusCode] || SAFE_MESSAGES[500];
  const err = new Error(safeMessage);
  err.publicMessage = safeMessage;
  err.internalMessage = internalMessage || safeMessage;
  err.statusCode = statusCode;
  err.code = code;
  err.isOperational = isOperational;
  err.isGatewayConfigError = isGatewayConfigError;
  if (metadata) err.metadata = metadata;
  if (Array.isArray(errors) && errors.length > 0) err.errors = errors;
  return err;
};

export const isDatabaseError = (err) => {
  if (!err || typeof err !== 'object') return false;
  if (err.sqlState || err.sqlMessage || typeof err.errno === 'number') return true;
  if (typeof err.code === 'string') {
    if (err.code.startsWith('ER_') || err.code.startsWith('PROTOCOL_') || CONNECTION_ERROR_CODES.has(err.code)) {
      return true;
    }
  }
  if (err.name === 'AggregateError' && Array.isArray(err.errors)) {
    return err.errors.some((sub) => isDatabaseError(sub));
  }
  return false;
};

export const isGatewayConfigError = (err) => {
  if (!err || typeof err !== 'object') return false;
  if (err.isGatewayConfigError) return true;
  if (typeof err.code === 'string' && err.code.startsWith('CCAVENUE_') && err.code !== 'CCAVENUE_DECRYPT_FAILED') {
    return true;
  }
  const combined = `${err.internalMessage || ''} ${err.message || ''}`;
  return /\bCCAVENUE_[A-Z0-9_]+\b|Crypto\.php/i.test(combined);
};

export const containsSensitiveDetails = (text) => {
  if (!text || typeof text !== 'string') return false;
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
};

const sanitizeValidationErrors = (errors) => {
  if (!Array.isArray(errors)) return [];
  return errors
    .filter((item) => item && typeof item === 'object' && typeof item.message === 'string')
    .map((item) => ({
      field: typeof item.field === 'string' ? item.field : '',
      message: containsSensitiveDetails(item.message) ? SAFE_MESSAGES[400] : item.message
    }));
};

export const classifyError = (err, options = {}) => {
  if (err?.code === 'ER_DUP_ENTRY') {
    return {
      statusCode: 409,
      category: 'DATABASE_CONFLICT',
      code: 'DUPLICATE_ENTRY',
      publicMessage: SAFE_MESSAGES[409],
      errors: []
    };
  }

  if (isDatabaseError(err)) {
    return {
      statusCode: 500,
      category: 'DATABASE_ERROR',
      code: 'DATABASE_ERROR',
      publicMessage: options.fallbackMessage || SAFE_MESSAGES.DATABASE_ERROR,
      errors: []
    };
  }

  if (isGatewayConfigError(err)) {
    const statusCode = Number(err.statusCode) >= 500 ? Number(err.statusCode) : 503;
    return {
      statusCode,
      category: 'GATEWAY_CONFIG_ERROR',
      code: err.code || 'GATEWAY_CONFIG_ERROR',
      publicMessage:
        err.publicMessage && !containsSensitiveDetails(err.publicMessage)
          ? err.publicMessage
          : SAFE_MESSAGES.GATEWAY_UNAVAILABLE,
      errors: []
    };
  }

  if (err?.name === 'JsonWebTokenError') {
    return {
      statusCode: 401,
      category: 'AUTH_ERROR',
      code: 'INVALID_TOKEN',
      publicMessage: 'Invalid authorization token.',
      errors: []
    };
  }

  if (err?.name === 'TokenExpiredError') {
    return {
      statusCode: 401,
      category: 'AUTH_ERROR',
      code: 'TOKEN_EXPIRED',
      publicMessage: 'Authorization token has expired.',
      errors: []
    };
  }

  if (err?.name === 'ZodError') {
    return {
      statusCode: 400,
      category: 'VALIDATION_ERROR',
      code: 'VALIDATION_ERROR',
      publicMessage: SAFE_MESSAGES[400],
      errors: []
    };
  }

  if (err?.type === 'entity.parse.failed') {
    return {
      statusCode: 400,
      category: 'BAD_REQUEST',
      code: 'INVALID_JSON',
      publicMessage: 'Invalid JSON request payload.',
      errors: []
    };
  }

  const rawStatus = Number(err?.statusCode || err?.status || 500);
  const statusCode = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;

  if (statusCode >= 500) {
    const explicitSafe =
      err?.publicMessage && !containsSensitiveDetails(err.publicMessage) ? err.publicMessage : null;
    return {
      statusCode,
      category: 'UNHANDLED_EXCEPTION',
      code: err?.code || 'INTERNAL_SERVER_ERROR',
      publicMessage: options.fallbackMessage || explicitSafe || SAFE_MESSAGES[statusCode] || SAFE_MESSAGES[500],
      errors: []
    };
  }

  const candidate = typeof err?.publicMessage === 'string' ? err.publicMessage : err?.message;
  const safeClientMessage =
    candidate && !containsSensitiveDetails(candidate)
      ? candidate
      : options.fallbackMessage || SAFE_MESSAGES[statusCode] || SAFE_MESSAGES[400];

  return {
    statusCode,
    category: 'CLIENT_ERROR',
    code: err?.code || 'BAD_REQUEST',
    publicMessage: safeClientMessage,
    errors: sanitizeValidationErrors(err?.errors)
  };
};

export const extractRequestContext = (req) => {
  if (!req || typeof req !== 'object') return null;
  return {
    method: req.method || null,
    path: req.originalUrl || req.url || null,
    ip: req.ip || req.socket?.remoteAddress || null,
    userId: req.user?.userId || req.user?.id || null,
    userRole: req.user?.role || null,
    userAgent: typeof req.get === 'function' ? req.get('user-agent') : req.headers?.['user-agent'] || null
  };
};

const writeLogToFile = async (entry) => {
  try {
    const logDir = getLogDir();
    await fs.mkdir(logDir, { recursive: true });
    await fs.appendFile(getErrorLogPath(), `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (writeErr) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[ERROR-LOGGER] Failed to write error.log:', writeErr.message);
    }
  }
};

/**
 * Securely log exceptions with timestamp, category, and request context to stderr and logs/error.log.
 */
export const logException = (err, context = {}) => {
  const classified = classifyError(err, context);
  const subErrors =
    err?.name === 'AggregateError' && Array.isArray(err.errors)
      ? err.errors.map((sub) => ({
          name: sub?.name || 'Error',
          code: sub?.code || null,
          message: sub?.message || String(sub)
        }))
      : undefined;

  const entry = {
    timestamp: new Date().toISOString(),
    level: classified.statusCode >= 500 ? 'ERROR' : 'WARN',
    category: classified.category,
    code: classified.code,
    statusCode: classified.statusCode,
    endpoint: context.endpoint || null,
    request: extractRequestContext(context.req),
    error: {
      name: err?.name || 'Error',
      internalMessage: err?.internalMessage || err?.message || String(err),
      code: err?.code || null,
      errno: typeof err?.errno === 'number' ? err.errno : undefined,
      sqlState: err?.sqlState || undefined,
      missingFields: Array.isArray(err?.missingFields) ? err.missingFields : undefined,
      metadata: err?.metadata || undefined,
      subErrors,
      stack: err?.stack || null
    }
  };

  if (process.env.NODE_ENV !== 'test') {
    const reqSummary = entry.request ? `${entry.request.method} ${entry.request.path}` : entry.endpoint || 'SYSTEM';
    console.error(
      `[${entry.timestamp}] [${entry.level}] [${entry.category}] ${reqSummary} -> ${entry.error.internalMessage}`
    );
    if (entry.statusCode >= 500 && entry.error.stack) {
      console.error(entry.error.stack);
    }
  }

  void writeLogToFile(entry);
  return classified;
};

export const sendSafeErrorResponse = (err, req, res, options = {}) => {
  const alreadyLogged = Boolean(err && typeof err === 'object' && err.__logged);
  const classified = alreadyLogged
    ? classifyError(err, options)
    : logException(err, { req, endpoint: options.context, fallbackMessage: options.fallbackMessage });

  if (err && typeof err === 'object') {
    err.__logged = true;
  }

  if (res.headersSent) {
    return;
  }

  return res.status(classified.statusCode).json({
    success: false,
    message: classified.publicMessage,
    errors: classified.errors
  });
};

/**
 * Wrap an async Express controller with centralized exception logging and safe JSON responses.
 */
export const withSafeHandler = (handler, options = {}) => {
  return async (req, res, next) => {
    try {
      return await handler(req, res, next);
    } catch (error) {
      return sendSafeErrorResponse(error, req, res, options);
    }
  };
};
