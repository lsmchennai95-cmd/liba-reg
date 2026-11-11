import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.resolve(__dirname, '../templates');
const TEMPLATE_ASSETS_DIR = path.join(TEMPLATES_DIR, 'assets');

let transporter = null;

export const escapeHtml = (value) => {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export const formatINR = (amount) => {
  return (
    '₹' +
    Number(amount || 0).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  );
};

export const getTransporter = () => {
  const hasAuth = Boolean(
    env.email.smtpHost &&
      env.email.smtpUser &&
      env.email.smtpUser.trim() !== '' &&
      env.email.smtpPass &&
      env.email.smtpPass.trim() !== ''
  );

  if (!hasAuth) {
    return null;
  }

  if (!transporter) {
    const isSecure = env.email.smtpPort === 465 || Boolean(env.email.smtpSecure);
    transporter = nodemailer.createTransport({
      host: env.email.smtpHost,
      port: env.email.smtpPort,
      secure: isSecure,
      auth: {
        user: env.email.smtpUser,
        pass: env.email.smtpPass
      },
      connectionTimeout: 5000,
      greetingTimeout: 5000
    });
  }

  return transporter;
};

/**
 * Resolve inline CID logo attachment from templates/assets when available.
 */
export const getLogoAttachments = (preferredFileName = 'liba_full_logo_footer.png', cid = 'logoImg') => {
  const candidates = [
    preferredFileName,
    'liba_full_logo_footer.png',
    'liba-logo.png',
    'liba-logo-white.png',
    'liba-full-logo-blue.png'
  ].filter(Boolean);

  for (const fileName of new Set(candidates)) {
    const assetPath = path.join(TEMPLATE_ASSETS_DIR, fileName);
    if (fs.existsSync(assetPath)) {
      return [
        {
          filename: fileName,
          path: assetPath,
          cid
        }
      ];
    }
  }

  // Fallback: pick the first image file found in templates/assets/
  if (fs.existsSync(TEMPLATE_ASSETS_DIR)) {
    const imageFile = fs
      .readdirSync(TEMPLATE_ASSETS_DIR)
      .find((name) => /\.(png|jpe?g|webp|gif)$/i.test(name));
    if (imageFile) {
      return [
        {
          filename: imageFile,
          path: path.join(TEMPLATE_ASSETS_DIR, imageFile),
          cid
        }
      ];
    }
  }

  return [];
};

/**
 * Load an HTML template from templates/ and replace {{placeholder}} tokens.
 */
export const renderEmailTemplate = (templateFileName, variables = {}, { hasLogo = true } = {}) => {
  const templatePath = path.join(TEMPLATES_DIR, templateFileName);
  let html = fs.readFileSync(templatePath, 'utf8');

  if (!hasLogo) {
    html = html.replace(/<img[^>]*src=["']cid:logoImg["'][^>]*>\s*/gi, '');
  }

  const allVars = {
    year: new Date().getFullYear(),
    ...variables
  };

  for (const [key, value] of Object.entries(allVars)) {
    html = html.replaceAll(`{{${key}}}`, String(value ?? ''));
  }

  return html;
};

/**
 * Send a prepared mail payload using the shared Nodemailer transporter.
 */
export const sendMail = async (
  mailOptions,
  { throwIfUnconfigured = false, throwOnError = false, logLabel = 'EMAIL-SERVICE' } = {}
) => {
  const client = getTransporter();
  if (!client) {
    if (throwIfUnconfigured) {
      throw new Error('SMTP transporter is not configured.');
    }
    return null;
  }

  try {
    const info = await client.sendMail({
      from: env.email.fromEmail,
      ...mailOptions
    });
    console.log(`[${logLabel}] Email sent to ${mailOptions.to || 'recipients'} (MessageId: ${info.messageId})`);
    return info;
  } catch (err) {
    console.error(`[${logLabel}] Failed to send email:`, err.message);
    if (throwOnError) {
      throw err;
    }
    return null;
  }
};

