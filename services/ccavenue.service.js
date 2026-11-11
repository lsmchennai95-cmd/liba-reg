import crypto from 'node:crypto';
import { env } from '../config/env.js';

const createGatewayConfigError = (message, code = 'CCAVENUE_CONFIG_MISSING', statusCode = 503) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

// Fixed IV used by the CCAvenue PHP kit: bytes 0x00..0x0f
const CCAVENUE_IV = Buffer.from([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f
]);

// AES-128 requires a 16-byte key. PHP does: hextobin(md5($key)) -> 16 raw bytes.
const deriveKey = (workingKey) => {
  const hex = crypto.createHash('md5').update(String(workingKey), 'utf8').digest('hex');
  return Buffer.from(hex, 'hex'); // 16 bytes
};

export const isCryptoConfigured = () => true;

export const getGatewayConfig = () => {
  const cfg = env.ccavenue || {};
  const isProd = cfg.env === 'production';

  const gatewayUrl = isProd ? cfg.productionUrl : cfg.sandboxUrl;
  const missing = [];

  if (!cfg.merchantId) missing.push('CCAVENUE_MERCHANT_ID');
  if (!cfg.accessCode) missing.push('CCAVENUE_ACCESS_CODE');
  if (!cfg.workingKey) missing.push('CCAVENUE_WORKING_KEY');
  if (!gatewayUrl) {
    missing.push(isProd ? 'CCAVENUE_PRODUCTION_URL' : 'CCAVENUE_SANDBOX_URL');
  }
  if (!cfg.redirectUrl) missing.push('CCAVENUE_REDIRECT_URL');
  if (!cfg.cancelUrl) missing.push('CCAVENUE_CANCEL_URL');

  return {
    env: isProd ? 'production' : 'sandbox',
    merchantId: cfg.merchantId || '',
    accessCode: cfg.accessCode || '',
    workingKey: cfg.workingKey || '',
    gatewayUrl: gatewayUrl || '',
    redirectUrl: cfg.redirectUrl || '',
    cancelUrl: cfg.cancelUrl || '',
    missingFields: missing,
    isReady: missing.length === 0
  };
};

export const assertCcavenueReady = () => {
  const config = getGatewayConfig();
  if (!config.isReady) {
    throw createGatewayConfigError(
      `CCAvenue configuration incomplete. Missing environment variable(s): ${config.missingFields.join(', ')}.`,
      'CCAVENUE_ENV_INCOMPLETE',
      503
    );
  }
  return config;
};

export const buildMerchantData = (fields) => {
  const pairs = [];
  for (const [key, value] of Object.entries(fields || {})) {
    if (value === undefined || value === null) continue;
    pairs.push(`${key}=${String(value)}`);
  }
  return `${pairs.join('&')}&`;
};

/**
 * Mirrors PHP Crypto.php encrypt($plainText, $key):
 *   key  = hextobin(md5($key))          -> 16 raw bytes
 *   iv   = pack("C*", 0x00..0x0f)
 *   c    = openssl_encrypt(pt, AES-128-CBC, key, OPENSSL_RAW_DATA, iv)
 *   out  = bin2hex(c)
 *
 * PHP's openssl_encrypt applies PKCS#7 padding by default, which
 * matches Node's default auto-padding for createCipheriv.
 */
export const encrypt = (plainText, workingKey) => {
  if (!workingKey) {
    throw createGatewayConfigError(
      'CCAVENUE_WORKING_KEY is required for CCAvenue request encryption.',
      'CCAVENUE_WORKING_KEY_MISSING',
      503
    );
  }
  if (!plainText) {
    throw createGatewayConfigError('Merchant data payload cannot be empty.', 'CCAVENUE_EMPTY_PAYLOAD', 400);
  }

  const key = deriveKey(workingKey);
  const cipher = crypto.createCipheriv('aes-128-cbc', key, CCAVENUE_IV);
  const encrypted = Buffer.concat([
    cipher.update(String(plainText), 'utf8'),
    cipher.final()
  ]);
  return encrypted.toString('hex');
};

/**
 * Mirrors PHP Crypto.php decrypt($encryptedText, $key):
 *   key  = hextobin(md5($key))
 *   iv   = pack("C*", 0x00..0x0f)
 *   data = hextobin($encryptedText)
 *   out  = openssl_decrypt(data, AES-128-CBC, key, OPENSSL_RAW_DATA, iv)
 *
 * PHP's openssl_decrypt strips PKCS#7 padding automatically, which
 * matches Node's default auto-padding for createDecipheriv.
 */
export const decrypt = (encryptedText, workingKey) => {
  if (!workingKey) {
    throw createGatewayConfigError(
      'CCAVENUE_WORKING_KEY is required to decrypt CCAvenue response.',
      'CCAVENUE_WORKING_KEY_MISSING',
      503
    );
  }
  if (!encryptedText || typeof encryptedText !== 'string') {
    throw createGatewayConfigError('Missing or invalid encrypted CCAvenue response (encResp).', 'INVALID_ENC_RESP', 400);
  }

  const cleanHex = encryptedText.trim();
  if (cleanHex.length === 0 || cleanHex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(cleanHex)) {
    throw createGatewayConfigError('encResp is not a valid hex string.', 'INVALID_ENC_RESP', 400);
  }

  const key = deriveKey(workingKey);
  const data = Buffer.from(cleanHex, 'hex');

  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, CCAVENUE_IV);
    const decrypted = Buffer.concat([
      decipher.update(data),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw createGatewayConfigError(
      'Failed to decrypt CCAvenue response. Check CCAVENUE_WORKING_KEY.',
      'CCAVENUE_DECRYPT_FAILED',
      400
    );
  }
};

/**
 * Parses decrypted CCAvenue key=value&... response string safely into key-value pairs
 * matching PHP: explode('&', $rcvdString) + explode('=', $pair, 2) + urldecode().
 */
export const parseResponseParams = (plainText) => {
  if (!plainText || typeof plainText !== 'string') {
    return null;
  }

  const safeDecode = (str) => {
    const plusFixed = String(str).replace(/\+/g, ' ');
    try {
      return decodeURIComponent(plusFixed);
    } catch {
      return plusFixed;
    }
  };

  const parsed = {};
  const parts = plainText.split('&');
  for (const part of parts) {
    if (!part) continue;
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) continue;
    const rawKey = safeDecode(part.slice(0, eqIndex)).trim();
    const rawVal = safeDecode(part.slice(eqIndex + 1));
    if (!rawKey) continue;
    parsed[rawKey] = rawVal;
  }

  return Object.keys(parsed).length > 0 ? parsed : null;
};

/**
 * Extracts normalized transaction and merchant reference fields from parsed CCAvenue response.
 */
export const extractResponseFields = (parsed) => {
  if (!parsed || typeof parsed !== 'object') return null;
  const trimOrNull = (val) => {
    if (val === undefined || val === null) return null;
    const trimmed = String(val).trim();
    return trimmed || null;
  };

  return {
    orderStatus: trimOrNull(parsed.order_status) || '',
    orderId: trimOrNull(parsed.order_id) || '',
    amount: trimOrNull(parsed.amount),
    currency: (trimOrNull(parsed.currency) || 'INR').toUpperCase(),
    statusMessage: trimOrNull(parsed.status_message),
    failureMessage: trimOrNull(parsed.failure_message),
    trackingId: trimOrNull(parsed.tracking_id),
    bankRefNo: trimOrNull(parsed.bank_ref_no),
    paymentMode: trimOrNull(parsed.payment_mode),
    billingName: trimOrNull(parsed.billing_name),
    billingEmail: trimOrNull(parsed.billing_email),
    merchantParam1: trimOrNull(parsed.merchant_param1),
    merchantParam2: trimOrNull(parsed.merchant_param2),
    merchantParam4: trimOrNull(parsed.merchant_param4),
    raw: parsed
  };
};