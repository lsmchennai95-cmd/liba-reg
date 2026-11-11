import { env } from '../config/env.js';
import {
  escapeHtml,
  getLogoAttachments,
  renderEmailTemplate,
  sendMail
} from './send-mail.js';

const buildOptionalRow = (label, value) => {
  if (!value) return '';
  return `
        <tr>
          <td style="padding:8px 0; color:#64748b; font-weight:600; border-bottom:1px solid #e2e8f0;">${escapeHtml(label)}</td>
          <td style="padding:8px 0; color:#0b2b4f; font-family:monospace; font-size:13px; font-weight:700; text-align:right; border-bottom:1px solid #e2e8f0;">${escapeHtml(value)}</td>
        </tr>`;
};

/**
 * Sends an internal notification email to dynamically configured recipients
 * when a new student registers. Uses BCC so recipients cannot see each other's addresses.
 * Strictly excludes passwords, OTPs, and verification tokens.
 */
export const sendInternalRegistrationNotificationEmail = async ({
  recipients = [],
  student = {}
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
  const courseDetails = student.courseDetails || student.courseName || 'LIBA Online Programme';
  const studentId = student.studentId || null;
  const applicationNo = student.applicationNo || null;
  const registrationStatus = student.registrationStatus || 'Pending Verification';

  const registeredAt = student.registeredAt ? new Date(student.registeredAt) : new Date();
  const formattedDate =
    registeredAt.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }) + ' IST';

  const subject = `Admissions Alert! ${fullName} is trying to register.`;
  const attachments = getLogoAttachments('liba-logo-white.png');

  const html = renderEmailTemplate(
    'registration-notification-template.html',
    {
      fullName: escapeHtml(fullName),
      email: escapeHtml(email),
      phone: escapeHtml(phone),
      courseDetails: escapeHtml(courseDetails),
      applicationRow: buildOptionalRow('Application / Registration ID', applicationNo),
      studentIdRow: buildOptionalRow('Student ID', studentId),
      formattedDate: escapeHtml(formattedDate),
      registrationStatus: escapeHtml(registrationStatus)
    },
    { hasLogo: attachments.length > 0 }
  );

  const text = [
    'New Student Registration - LIBA Online',
    '',
    'A new student has registered on the LIBA Online platform and is available for review:',
    `Student Full Name: ${fullName}`,
    `Registered Email: ${email}`,
    `Phone Number: ${phone}`,
    `Course Details: ${courseDetails}`,
    applicationNo ? `Application / Registration ID: ${applicationNo}` : null,
    studentId ? `Student ID: ${studentId}` : null,
    `Registration Date & Time: ${formattedDate}`,
    `Registration Status: ${registrationStatus}`
  ]
    .filter(Boolean)
    .join('\n');

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

