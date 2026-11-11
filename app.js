import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { apiRoutes } from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/error.middleware.js';

const app = express();

// Security HTTP headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS Configuration
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const isAllowed = env.corsOrigins.some((allowed) => {
      if (allowed === origin) return true;
      try {
        return new URL(origin).hostname === new URL(allowed).hostname;
      } catch (e) {
        return false;
      }
    });

    if (isAllowed || !env.isProduction) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked request from origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
};
app.use(cors(corsOptions));

// Rate Limiting (100 requests per 15 minutes)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: {
    success: false,
    message: 'Too many requests, please try again later',
    errors: []
  }
});
app.use('/api', apiLimiter);

// Body parsers
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser(env.cookieSecret));

// Mount Versioned API Routes: /api/v1/...
app.use('/api/v1', apiRoutes);

// Root route
app.get('/', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'LIBA Online Backend API',
    data: {
      version: '1.0.0',
      health: '/api/v1/health'
    }
  });
});

// 404 & Global Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

export { app };

