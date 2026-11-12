import { env } from '../config/env.js';
import {
  escapeHtml,
  getLogoAttachments,
  renderEmailTemplate,
  sendMail
} from './send-mail.js';

 
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

  const subject = `Admissions Alert! ${fullName} is trying to register.`;
  const attachments = getLogoAttachments('liba-logo-white.png');

  const html = renderEmailTemplate(
    'registration-notification-template.html',
    {
      fullName: escapeHtml(fullName),
      email: escapeHtml(email),
      phone: escapeHtml(phone),
      courseDetails: escapeHtml(courseDetails)
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
    `Course Details: ${courseDetails}`
  ].join('\n');

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

