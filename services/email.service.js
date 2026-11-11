import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter = null;

const getTransporter = () => {
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

export const sendOtpEmail = async ({ to, name, otp, purpose = 'registration' }) => {
  const isRegistration = purpose === 'registration';
  const subject = isRegistration
    ? 'LIBA Online - Email Verification OTP'
    : 'LIBA Online - Password Reset OTP';

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #0066cc; margin: 0;">LIBA Online Programmes</h2>
        <p style="color: #4a5a6e; font-size: 14px; margin-top: 4px;">Loyola Institute of Business Administration</p>
      </div>
      <p style="color: #1e293b; font-size: 16px;">Dear ${name || 'Student'},</p>
      <p style="color: #334155; line-height: 1.6;">
        Thank you for choosing LIBA Online. Please use the following One-Time Password (OTP) to ${isRegistration ? 'verify your account' : 'reset your password'}:
      </p>
      <div style="text-align: center; margin: 28px 0;">
        <span style="display: inline-block; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #0066cc; background: #eff6ff; padding: 12px 28px; border-radius: 6px; border: 1px solid #bfdbfe;">
          ${otp}
        </span>
      </div>
      <p style="color: #64748b; font-size: 13px; line-height: 1.5;">
        This OTP is valid for 10 minutes and can only be used once. Please do not share this code with anyone.
      </p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 0;">
        LIBA Online Admissions Team &bull; Chennai, India
      </p>
    </div>
  `;

  // Always log in non-production mode for local verification/debugging
  if (env.nodeEnv !== 'production') {
    console.log(`[EMAIL-SERVICE] ${subject} -> To: ${to} | Name: ${name || 'Student'} | OTP: ${otp}`);
  }

  const client = getTransporter();
  if (client) {
    try {
      const info = await client.sendMail({
        from: env.email.fromEmail,
        to,
        subject,
        text: `Your LIBA Online verification OTP is: ${otp}. It is valid for 10 minutes.`,
        html: htmlContent
      });
      console.log(`[EMAIL-SERVICE] Email sent via SMTP to ${to} (MessageId: ${info.messageId})`);
    } catch (err) {
      console.error('[EMAIL-SERVICE] Failed to send email via SMTP:', err.message);
    }
  }

  return true;
};

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

  const formattedAmount = '₹' + Number(amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const formattedDate = new Date(paidAt).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const dashboardUrl = `${env.frontendUrl}/student/dashboard/`;
  const subject = `LIBA Online – Payment Successful & Account Activated [${applicationNumber !== 'N/A' ? applicationNumber : orderId}]`;

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px 24px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; color: #1e293b;">
      
      <!-- HEADER -->
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 2px solid #f1f5f9; margin-bottom: 24px;">
        <h2 style="color: #0066cc; margin: 0 0 4px; font-size: 22px; font-weight: 800; letter-spacing: -0.3px;">LIBA Online Programmes</h2>
        <p style="color: #64748b; font-size: 13.5px; margin: 0;">Loyola Institute of Business Administration &bull; Chennai, India</p>
      </div>

      <!-- SUCCESS BADGE -->
      <div style="background: #ecfdf5; border: 1.5px solid #a7f3d0; border-radius: 8px; padding: 18px; text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; border-radius: 50%; background: #10b981; color: #ffffff; font-size: 24px; font-weight: bold; margin-bottom: 8px;">✓</div>
        <h3 style="color: #065f46; margin: 0 0 6px; font-size: 18px; font-weight: 700;">Payment Successful & Account Activated</h3>
        <p style="color: #047857; margin: 0; font-size: 13.5px;">Your payment of <strong>${formattedAmount}</strong> has been verified. Your student account is now active!</p>
      </div>

      <p style="font-size: 15px; line-height: 1.5; color: #334155;">
        Dear <strong>${name || 'Student'}</strong>,
      </p>
      <p style="font-size: 14px; line-height: 1.6; color: #475569;">
        Thank you for completing your <strong>${paymentType}</strong> for admission to LIBA Online. Below is your official transaction summary for your records:
      </p>

      <!-- TRANSACTION SUMMARY CARD -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 22px 0;">
        <table style="width: 100%; border-collapse: collapse; font-size: 13.5px;">
          <tr>
            <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Student Name:</td>
            <td style="padding: 7px 0; color: #0b2b4f; font-weight: 700; text-align: right;">${name || 'Student'}</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Application Number:</td>
            <td style="padding: 7px 0; color: #0b2b4f; font-weight: 700; text-align: right;">${applicationNumber}</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Selected Programme:</td>
            <td style="padding: 7px 0; color: #0b2b4f; font-weight: 700; text-align: right;">${courseName}</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Payment Type:</td>
            <td style="padding: 7px 0; color: #0b2b4f; font-weight: 600; text-align: right;">${paymentType}</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Amount Paid:</td>
            <td style="padding: 7px 0; color: #0d8a4e; font-weight: 800; font-size: 16px; text-align: right;">${formattedAmount}</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Transaction Reference:</td>
            <td style="padding: 7px 0; color: #1e293b; font-family: monospace; font-size: 13px; text-align: right;">${transactionId || orderId}</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Order ID:</td>
            <td style="padding: 7px 0; color: #1e293b; font-family: monospace; font-size: 13px; text-align: right;">${orderId}</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Payment Status:</td>
            <td style="padding: 7px 0; color: #0d8a4e; font-weight: 700; text-align: right;">SUCCESSFUL</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Date & Time:</td>
            <td style="padding: 7px 0; color: #475569; text-align: right;">${formattedDate}</td>
          </tr>
        </table>
      </div>

      <!-- CTA BUTTON -->
      <div style="text-align: center; margin: 30px 0 20px;">
        <a href="${dashboardUrl}" style="display: inline-block; background: #0066cc; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 700; font-size: 14.5px; box-shadow: 0 4px 10px rgba(0, 102, 204, 0.25);">
          Go to Student Dashboard &rarr;
        </a>
      </div>

      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 28px 0 18px;" />
      <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 0; line-height: 1.5;">
        This is an automated transaction receipt from LIBA Online Admissions.<br>
        If you have questions, please reach out to <a href="mailto:support@libaonline.com" style="color: #0066cc;">support@libaonline.com</a>.
      </p>
    </div>
  `;

  if (env.nodeEnv !== 'production') {
    console.log(`[EMAIL-SERVICE] Payment Success Email -> To: ${to} | Name: ${name} | Amount: ${formattedAmount} | Order: ${orderId}`);
  }

  const client = getTransporter();
  if (client) {
    try {
      const info = await client.sendMail({
        from: env.email.fromEmail,
        to,
        subject,
        text: `Dear ${name}, your LIBA Online payment of ${formattedAmount} was successful (Order ID: ${orderId}, Transaction: ${transactionId}). Your student account is now active. Access your dashboard at: ${dashboardUrl}`,
        html: htmlContent
      });
      console.log(`[EMAIL-SERVICE] Payment success email sent to ${to} (MessageId: ${info.messageId})`);
    } catch (err) {
      console.error('[EMAIL-SERVICE] Failed to send payment success email:', err.message);
    }
  }

  return true;
};

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

  const formattedAmount = '₹' + Number(amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const retryUrl = `${env.frontendUrl}/student/payment/`;
  const subject = `LIBA Online – Payment Attempt Unsuccessful [${applicationNumber !== 'N/A' ? applicationNumber : orderId}]`;

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px 24px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; color: #1e293b;">
      
      <!-- HEADER -->
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 2px solid #f1f5f9; margin-bottom: 24px;">
        <h2 style="color: #0066cc; margin: 0 0 4px; font-size: 22px; font-weight: 800; letter-spacing: -0.3px;">LIBA Online Programmes</h2>
        <p style="color: #64748b; font-size: 13.5px; margin: 0;">Loyola Institute of Business Administration &bull; Chennai, India</p>
      </div>

      <!-- FAILED BADGE -->
      <div style="background: #fef2f2; border: 1.5px solid #fecaca; border-radius: 8px; padding: 18px; text-align: center; margin-bottom: 24px;">
        <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; border-radius: 50%; background: #ef4444; color: #ffffff; font-size: 22px; font-weight: bold; margin-bottom: 8px;">✕</div>
        <h3 style="color: #991b1b; margin: 0 0 6px; font-size: 18px; font-weight: 700;">Payment Could Not Be Completed</h3>
        <p style="color: #b91c1c; margin: 0; font-size: 13.5px;">We were unable to process your payment of <strong>${formattedAmount}</strong>.</p>
      </div>

      <p style="font-size: 15px; line-height: 1.5; color: #334155;">
        Dear <strong>${name || 'Student'}</strong>,
      </p>
      <p style="font-size: 14px; line-height: 1.6; color: #475569;">
        We noticed that your recent attempt to pay the <strong>${paymentType}</strong> for <strong>${courseName}</strong> was unsuccessful or cancelled.
      </p>

      <!-- REASSURANCE NOTE -->
      <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 14px 16px; margin: 18px 0; font-size: 13px; color: #92400e; line-height: 1.5;">
        <strong>Important:</strong> If any amount has been deducted from your bank account, card, or UPI, it will be automatically refunded by your issuing bank within <strong>5–7 business days</strong>.
      </div>

      <!-- TRANSACTION SUMMARY CARD -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 22px 0;">
        <table style="width: 100%; border-collapse: collapse; font-size: 13.5px;">
          <tr>
            <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Application Number:</td>
            <td style="padding: 7px 0; color: #0b2b4f; font-weight: 700; text-align: right;">${applicationNumber}</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Programme:</td>
            <td style="padding: 7px 0; color: #0b2b4f; font-weight: 700; text-align: right;">${courseName}</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Attempted Amount:</td>
            <td style="padding: 7px 0; color: #dc2626; font-weight: 700; text-align: right;">${formattedAmount}</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Order ID:</td>
            <td style="padding: 7px 0; color: #1e293b; font-family: monospace; font-size: 13px; text-align: right;">${orderId}</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Status:</td>
            <td style="padding: 7px 0; color: #dc2626; font-weight: 700; text-align: right;">FAILED / CANCELLED</td>
          </tr>
          <tr>
            <td style="padding: 7px 0; color: #64748b; font-weight: 600;">Reason:</td>
            <td style="padding: 7px 0; color: #475569; text-align: right;">${reason}</td>
          </tr>
        </table>
      </div>

      <p style="font-size: 14px; line-height: 1.6; color: #475569;">
        Your registration details are securely preserved. You can retry your payment at any time using your preferred payment method (UPI, Debit Card, Credit Card, or Net Banking).
      </p>

      <!-- RETRY BUTTON -->
      <div style="text-align: center; margin: 28px 0 20px;">
        <a href="${retryUrl}" style="display: inline-block; background: #0066cc; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 700; font-size: 14.5px; box-shadow: 0 4px 10px rgba(0, 102, 204, 0.25);">
          Retry Payment Now &rarr;
        </a>
      </div>

      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 28px 0 18px;" />
      <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 0; line-height: 1.5;">
        Need assistance with your payment? Contact our admissions counselors at <a href="mailto:support@libaonline.com" style="color: #0066cc;">support@libaonline.com</a>.
      </p>
    </div>
  `;

  if (env.nodeEnv !== 'production') {
    console.log(`[EMAIL-SERVICE] Payment Failed Email -> To: ${to} | Name: ${name} | Amount: ${formattedAmount} | Reason: ${reason}`);
  }

  const client = getTransporter();
  if (client) {
    try {
      const info = await client.sendMail({
        from: env.email.fromEmail,
        to,
        subject,
        text: `Dear ${name}, your payment attempt of ${formattedAmount} for LIBA Online Registration could not be completed (${reason}). You can retry your payment at: ${retryUrl}`,
        html: htmlContent
      });
      console.log(`[EMAIL-SERVICE] Payment failed email sent to ${to} (MessageId: ${info.messageId})`);
    } catch (err) {
      console.error('[EMAIL-SERVICE] Failed to send payment failed email:', err.message);
    }
  }

  return true;
};

const escapeHtml = (value) => {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

  const fullName = (student.fullName || 'Student').trim();
  const email = student.email || 'N/A';
  const phone = student.phone || 'N/A';
  const courseDetails = student.specializationName
    ? `${student.courseName || 'LIBA Online Programme'} (${student.specializationName})`
    : (student.courseName || 'N/A');
  const studentId = student.studentId || 'N/A';
  const applicationNo = student.applicationNo || 'N/A';
  const registrationStatus = student.registrationStatus || 'pending_verification';
  const registeredAt = student.registeredAt ? new Date(student.registeredAt) : new Date();
  const formattedDate = registeredAt.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }) + ' IST';

  const formattedStatus = String(registrationStatus)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const subject = 'New Student Registration – LIBA Online';

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 28px 24px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff; color: #1e293b;">
      <div style="background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); border-radius: 8px; padding: 22px 24px; text-align: center; margin-bottom: 24px; color: #ffffff;">
        <h2 style="margin: 0 0 4px; font-size: 21px; font-weight: 800; letter-spacing: -0.2px; color: #ffffff;">LIBA Online Programmes</h2>
        <p style="margin: 0; font-size: 13px; color: #dbeafe;">Loyola Institute of Business Administration &bull; Admissions Notification</p>
      </div>

      <div style="background: #eff6ff; border-left: 4px solid #2563eb; border-radius: 4px; padding: 14px 16px; margin-bottom: 22px;">
        <h3 style="margin: 0 0 4px; color: #1e3a8a; font-size: 16px;">New Student Registration Received</h3>
        <p style="margin: 0; color: #334155; font-size: 13.5px; line-height: 1.5;">
          A new student has registered on the LIBA Online platform. The registration details are summarized below for your review.
        </p>
      </div>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px 20px; margin-bottom: 22px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 13.5px;">
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Student Full Name</td>
            <td style="padding: 8px 0; color: #0b2b4f; font-weight: 700; text-align: right; border-bottom: 1px solid #e2e8f0;">${escapeHtml(fullName)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Registered Email</td>
            <td style="padding: 8px 0; color: #0b2b4f; font-weight: 600; text-align: right; border-bottom: 1px solid #e2e8f0;">${escapeHtml(email)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Phone Number</td>
            <td style="padding: 8px 0; color: #0b2b4f; font-weight: 600; text-align: right; border-bottom: 1px solid #e2e8f0;">${escapeHtml(phone)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Course Details</td>
            <td style="padding: 8px 0; color: #0b2b4f; font-weight: 700; text-align: right; border-bottom: 1px solid #e2e8f0;">${escapeHtml(courseDetails)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Application / Registration ID</td>
            <td style="padding: 8px 0; color: #0b2b4f; font-family: monospace; font-size: 13px; font-weight: 700; text-align: right; border-bottom: 1px solid #e2e8f0;">${escapeHtml(applicationNo)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Student ID</td>
            <td style="padding: 8px 0; color: #0b2b4f; font-family: monospace; font-size: 13px; font-weight: 600; text-align: right; border-bottom: 1px solid #e2e8f0;">${escapeHtml(studentId)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Registration Date &amp; Time</td>
            <td style="padding: 8px 0; color: #334155; text-align: right; border-bottom: 1px solid #e2e8f0;">${escapeHtml(formattedDate)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-weight: 600;">Registration Status</td>
            <td style="padding: 8px 0; text-align: right;">
              <span style="display: inline-block; background: #fef3c7; color: #92400e; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px;">
                ${escapeHtml(formattedStatus)}
              </span>
            </td>
          </tr>
        </table>
      </div>

      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 22px 0 16px;" />
      <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 0; line-height: 1.5;">
        Automated internal admissions notification from LIBA Online.<br>
        Loyola Institute of Business Administration &bull; Chennai, India
      </p>
    </div>
  `;

  const textContent = [
    'New Student Registration - LIBA Online',
    '',
    'A new student has registered on the LIBA Online platform and is available for review:',
    `Student Full Name: ${fullName}`,
    `Registered Email: ${email}`,
    `Phone Number: ${phone}`,
    `Course Details: ${courseDetails}`,
    `Application / Registration ID: ${applicationNo}`,
    `Student ID: ${studentId}`,
    `Registration Date & Time: ${formattedDate}`,
    `Registration Status: ${formattedStatus}`
  ].join('\n');

  const client = getTransporter();
  if (!client) {
    throw new Error('SMTP transporter is not configured. Please check SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables.');
  }

  const info = await client.sendMail({
    from: env.email.fromEmail,
    to: env.email.fromEmail,
    bcc: recipientEmails,
    subject,
    text: textContent,
    html: htmlContent
  });

  console.log(`[EMAIL-SERVICE] Internal registration notification sent to ${recipientEmails.length} recipient(s) via BCC (MessageId: ${info.messageId})`);

  return {
    skipped: false,
    messageId: info.messageId,
    recipientsCount: recipientEmails.length
  };
};
