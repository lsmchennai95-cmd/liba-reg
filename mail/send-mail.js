import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.resolve(__dirname, '../templates');

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
 * Load an HTML template from templates/ and replace {{placeholder}} tokens.
 */
export const renderEmailTemplate = (templateFileName, variables = {}, { hasLogo = true } = {}) => {
  const templatePath = path.join(TEMPLATES_DIR, templateFileName);
  let html = fs.readFileSync(templatePath, 'utf8');

  const rawLogoUrl = String((variables.logoUrl ?? env.email.logoUrl) || '').trim();
  if (!hasLogo || !rawLogoUrl) {
    html = html.replace(/<img[^>]*src=["'](?:cid:logoImg|\{\{logoUrl\}\})["'][^>]*>\s*/gi, '');
  }

  const allVars = {
    year: new Date().getFullYear(),
    ...variables,
    logoUrl: escapeHtml(rawLogoUrl)
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

