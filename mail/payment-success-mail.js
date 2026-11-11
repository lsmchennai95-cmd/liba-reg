import { env } from '../config/env.js';
import {
  escapeHtml,
  formatINR,
  getLogoAttachments,
  renderEmailTemplate,
  sendMail
} from './send-mail.js';

/**
 * Sends a confirmation email to the student upon successful payment verification.
 */
export const sendPaymentSuccessEmail = async ({
  to,
  name,
  orderId,
  transactionId,
  amount,
  paymentType = 'Registration Fee',
  courseName = 'LIBA Online Programme',
  applicationNumber = 'N/A',
  paidAt = new Date()
}) => {
  if (!to) return false;

  const formattedAmount = formatINR(amount);
  const formattedDate = new Date(paidAt).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const dashboardUrl = `${env.frontendUrl}/student/dashboard/`;
  const subject = `LIBA Online – Payment Successful & Account Activated [${applicationNumber !== 'N/A' ? applicationNumber : orderId}]`;

  const attachments = getLogoAttachments('liba-logo.png');
  const html = renderEmailTemplate(
    'payment-success-template.html',
    {
      name: escapeHtml(name || 'Student'),
      formattedAmount: escapeHtml(formattedAmount),
      paymentType: escapeHtml(paymentType),
      applicationNumber: escapeHtml(applicationNumber),
      courseName: escapeHtml(courseName),
      transactionRef: escapeHtml(transactionId || orderId),
      orderId: escapeHtml(orderId),
      formattedDate: escapeHtml(formattedDate),
      dashboardUrl: escapeHtml(dashboardUrl)
    },
    { hasLogo: attachments.length > 0 }
  );

  if (env.nodeEnv !== 'production') {
    console.log(`[EMAIL-SERVICE] Payment Success Email -> To: ${to} | Name: ${name} | Amount: ${formattedAmount} | Order: ${orderId}`);
  }

  await sendMail({
    to,
    subject,
    text: `Dear ${name || 'Student'}, your LIBA Online payment of ${formattedAmount} was successful (Order ID: ${orderId}, Transaction: ${transactionId}). Your student account is now active. Access your dashboard at: ${dashboardUrl}`,
    html,
    attachments
  });

  return true;
};

