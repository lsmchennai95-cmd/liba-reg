import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------
// Load .env — walk up from this file until we find one.
// Works whether env.js lives in /config, /src/config, or /src.
// ---------------------------------------------------------------
function findEnv(startDir) {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const envPath = findEnv(__dirname);
if (envPath) {
  dotenv.config({ path: envPath });
  console.log(`[env.js] ✅ Loaded .env from ${envPath}`);
} else {
  console.warn(`[env.js] ⚠️  No .env found walking up from ${__dirname}`);
}

// ---------------------------------------------------------------
// CORS origin parsing
// - In production: ONLY explicit origins (no localhost fallback).
// - In development: localhost origins are always allowed for DX.
// ---------------------------------------------------------------
const parseOrigins = (raw) => {
  const devDefaults = [
    'http://localhost:8000',
    'http://localhost:8001',
    'http://127.0.0.1:8000',
    'http://127.0.0.1:8001'
  ];
  const prodDefaults = [
    'https://info.onlineliba.com',
    'https://www.info.onlineliba.com',
    'https://libaonline.com',
    'https://www.libaonline.com',
    'https://secure.ccavenue.com'
  ];

  const isProd = process.env.NODE_ENV === 'production';
  const defaults = isProd ? prodDefaults : [...prodDefaults, ...devDefaults];

  const parsed = (raw || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // In production, ignore any localhost entries that sneak into CORS_ORIGIN
  const cleanedParsed = isProd
    ? parsed.filter((o) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(o))
    : parsed;

  return Array.from(new Set([...defaults, ...cleanedParsed]));
};
const parseNotificationRecipients = (raw) => {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, idx) => {
      const match = entry.match(/^(.+?)\s*<([^>]+)>$/);
      if (match) {
        return {
          recipientName: match[1].trim(),
          email: match[2].trim().toLowerCase()
        };
      }
      return {
        recipientName: `Admin ${idx + 1}`,
        email: entry.toLowerCase()
      };
    })
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email));
};
export const env = {
  // -------------------------------------------------------------
  // Server
  // -------------------------------------------------------------
  port: (() => {
    const raw = process.env.PORT;
    if (!raw) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('[env.js] PORT env var is required in production');
      }
      return 5000;
    }
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n <= 0 || n > 65535) {
      throw new Error(`[env.js] Invalid PORT value: "${raw}"`);
    }
    return n;
  })(),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // -------------------------------------------------------------
  // Database
  // -------------------------------------------------------------
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'liba_online',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
    waitForConnections: true,
    queueLimit: 0,
    decimalNumbers: true
  },

  // -------------------------------------------------------------
  // CORS & Frontend
  // -------------------------------------------------------------
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:8001',
  corsOrigins: parseOrigins(process.env.CORS_ORIGIN || process.env.FRONTEND_URL),

  // -------------------------------------------------------------
  // Auth & JWT
  // -------------------------------------------------------------
  jwtSecret: process.env.JWT_SECRET || 'liba_online_default_jwt_secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  cookieSecret: process.env.COOKIE_SECRET || 'liba_online_cookie_secret',
  cookieName: 'liba_auth_token',

  // -------------------------------------------------------------
  // Email / SMTP
  // -------------------------------------------------------------
  email: {
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
    smtpSecure: process.env.SMTP_SECURE === 'true',
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    fromEmail: process.env.EMAIL_FROM || 'noreply@libaonline.com'
  },

  ccavenue: {
    merchantId: (process.env.CCAVENUE_MERCHANT_ID || '').trim(),
    accessCode: (process.env.CCAVENUE_ACCESS_CODE || '').trim(),
    workingKey: (process.env.CCAVENUE_WORKING_KEY || '').trim(),
    env: (process.env.CCAVENUE_ENV || 'sandbox').trim().toLowerCase(),
    sandboxUrl: (process.env.CCAVENUE_SANDBOX_URL || '').trim(),
    productionUrl: (
      process.env.CCAVENUE_PRODUCTION_URL ||
      'https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction'
    ).trim(),
    redirectUrl: (process.env.CCAVENUE_REDIRECT_URL || '').trim(),
    cancelUrl: (process.env.CCAVENUE_CANCEL_URL || '').trim()
  },


  // Default Seeder Configuration (from environment variables)
  seed: {
    adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
    adminPassword: process.env.ADMIN_PASSWORD || '',
    notificationRecipients: parseNotificationRecipients(process.env.NOTIFICATION_RECIPIENTS)
  }
};