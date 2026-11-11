import { env } from '../config/env.js';
import {
  escapeHtml,
  getLogoAttachments,
  renderEmailTemplate,
  sendMail
} from './send-mail.js';

export const sendOtpEmail = async ({ to, name, otp, purpose = 'registration' }) => {
  const isRegistration = purpose === 'registration';
  const subject = isRegistration
    ? 'LIBA Online - Email Verification OTP'
    : 'LIBA Online - Password Reset OTP';

  const attachments = getLogoAttachments('liba-logo.png');
  const html = renderEmailTemplate(
    'otp-template.html',
    {
      subject: escapeHtml(subject),
      name: escapeHtml(name || 'Student'),
      attempt_for: isRegistration ? 'verify your account' : 'reset your password',
      otp: escapeHtml(otp)
    },
    { hasLogo: attachments.length > 0 }
  );

  if (env.nodeEnv !== 'production') {
    console.log(`[EMAIL-SERVICE] ${subject} -> To: ${to} | Name: ${name || 'Student'} | OTP: ${otp}`);
  }

  await sendMail({
    to,
    subject,
    text: `Your LIBA Online verification OTP is: ${otp}. It is valid for 10 minutes.`,
    html,
    attachments
  });

  return true;
};

