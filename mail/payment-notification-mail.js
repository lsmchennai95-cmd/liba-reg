import { env } from '../config/env.js';
import {
  escapeHtml,
  formatINR,
  getLogoAttachments,
  renderEmailTemplate,
  sendMail
} from './send-mail.js';

const buildOptionalRow = (label, value, mono = true) => {
  if (!value) return '';
  const valueStyle = mono
    ? 'padding:8px 0; color:#0b2b4f; font-family:monospace; font-size:13px; font-weight:700; text-align:right; border-bottom:1px solid #e2e8f0;'
    : 'padding:8px 0; color:#0b2b4f; font-weight:600; text-align:right; border-bottom:1px solid #e2e8f0;';
  return `
        <tr>
          <td style="padding:8px 0; color:#64748b; font-weight:600; border-bottom:1px solid #e2e8f0;">${escapeHtml(label)}</td>
          <td style="${valueStyle}">${escapeHtml(value)}</td>
        </tr>`;
};

/**
 * Sends an internal notification email to active admin/staff recipients
 * when a student completes their registration fee payment.
 */
export const sendInternalPaymentNotificationEmail = async ({
  recipients = [],
  student = {},
  payment = {}
}) => {
  const recipientEmails = Array.from(
    new Set(
      recipients
        .map((r) => (typeof r === 'string' ? r : r?.email))
        .map((e) => String(e || '').trim().toLowerCase())
        .filter(Boolean)
    )
  );

  if (recipientEmails.length === 0) {
    return { skipped: true, reason: 'No active recipients configured' };
  }

  const fullName = (student.fullName || student.name || 'Student').trim();
  const email = student.email || 'N/A';
  const phone = student.phone || 'N/A';
  const courseDetails = student.specializationName
    ? `${student.courseName || 'LIBA Online Programme'} (${student.specializationName})`
    : (student.courseDetails || student.courseName || 'LIBA Online Programme');
  const studentId = student.studentId || null;
  const applicationNo = student.applicationNo || null;

  const formattedAmount = formatINR(payment.amount);
  const orderId = payment.orderId || 'N/A';
  const transactionId = payment.transactionId || orderId;
  const paymentMode = payment.paymentMode || null;

  const paidAt = payment.paidAt ? new Date(payment.paidAt) : new Date();
  const formattedDate =
    paidAt.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }) + ' IST';

  const numericAmount = Number(payment.amount || 0);
  const subjectAmount = Number.isFinite(numericAmount)
    ? (Number.isInteger(numericAmount) ? String(numericAmount) : numericAmount.toFixed(2))
    : '0';
  const subject = `registration - ${subjectAmount} Name - ${fullName}`;
  const attachments = getLogoAttachments('liba_full_logo_footer.png');

  const html = renderEmailTemplate(
    'internal-payment-notification-template.html',
    {
      fullName: escapeHtml(fullName),
      email: escapeHtml(email),
      phone: escapeHtml(phone),
      courseDetails: escapeHtml(courseDetails),
      applicationRow: buildOptionalRow('Application / Registration ID', applicationNo, true),
      studentIdRow: buildOptionalRow('Student ID', studentId, true),
      formattedAmount: escapeHtml(formattedAmount),
      orderId: escapeHtml(orderId),
      transactionId: escapeHtml(transactionId),
      paymentModeRow: buildOptionalRow('Payment Mode', paymentMode, false),
      formattedDate: escapeHtml(formattedDate)
    },
    { hasLogo: attachments.length > 0 }
  );

  const text = [
    'Student Registration Payment Completed - LIBA Online',
    '',
    'A student has completed their registration fee payment and their account is now active:',
    `Student Full Name: ${fullName}`,
    `Registered Email: ${email}`,
    `Phone Number: ${phone}`,
    `Course Details: ${courseDetails}`,
    applicationNo ? `Application / Registration ID: ${applicationNo}` : null,
    studentId ? `Student ID: ${studentId}` : null,
    `Amount Paid: ${formattedAmount}`,
    `Order ID: ${orderId}`,
    `Transaction Reference: ${transactionId}`,
    paymentMode ? `Payment Mode: ${paymentMode}` : null,
    `Payment Date & Time: ${formattedDate}`,
    'Status: Paid & Active'
  ]
    .filter(Boolean)
    .join('\n');

  if (env.nodeEnv !== 'production') {
    console.log(
      `[EMAIL-SERVICE] Internal Payment Notification -> Recipients: ${recipientEmails.length} | Student: ${fullName} | Amount: ${formattedAmount} | Order: ${orderId}`
    );
  }

  const info = await sendMail(
    {
      from: env.email.fromEmail,
      to: env.email.fromEmail,
      bcc: recipientEmails,
      subject,
      text,
      html,
      attachments
    },
    {
      throwIfUnconfigured: true,
      throwOnError: true,
      logLabel: 'EMAIL-SERVICE'
    }
  );

  return {
    skipped: false,
    messageId: info.messageId,
    recipientsCount: recipientEmails.length
  };
};

