import { env } from '../config/env.js';
import {
  escapeHtml,
  formatINR,
  getLogoAttachments,
  renderEmailTemplate,
  sendMail
} from './send-mail.js';

/**
 * Sends a notification email to the student when a payment attempt fails or is cancelled.
 */
export const sendPaymentFailedEmail = async ({
  to,
  name,
  orderId,
  amount,
  paymentType = 'Registration Fee',
  courseName = 'LIBA Online Programme',
  applicationNumber = 'N/A',
  reason = 'Transaction declined or cancelled by user'
}) => {
  if (!to) return false;

  const formattedAmount = formatINR(amount);
  const retryUrl = `${env.frontendUrl}/student/payment/`;
  const subject = `LIBA Online – Payment Attempt Unsuccessful [${applicationNumber !== 'N/A' ? applicationNumber : orderId}]`;

  const attachments = getLogoAttachments('liba-logo.png');
  const html = renderEmailTemplate(
    'payment-failed-template.html',
    {
      name: escapeHtml(name || 'Student'),
      formattedAmount: escapeHtml(formattedAmount),
      paymentType: escapeHtml(paymentType),
      courseName: escapeHtml(courseName),
      applicationNumber: escapeHtml(applicationNumber),
      orderId: escapeHtml(orderId),
      reason: escapeHtml(reason),
      retryUrl: escapeHtml(retryUrl)
    },
    { hasLogo: attachments.length > 0 }
  );

  if (env.nodeEnv !== 'production') {
    console.log(`[EMAIL-SERVICE] Payment Failed Email -> To: ${to} | Name: ${name} | Amount: ${formattedAmount} | Reason: ${reason}`);
  }

  await sendMail({
    to,
    subject,
    text: `Dear ${name || 'Student'}, your payment attempt of ${formattedAmount} for LIBA Online Registration could not be completed (${reason}). You can retry your payment at: ${retryUrl}`,
    html,
    attachments
  });

  return true;
};

