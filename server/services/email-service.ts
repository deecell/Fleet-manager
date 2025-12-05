import sgMail from "@sendgrid/mail";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDER_EMAIL = "hello@deecell.com";
const SENDER_NAME = "Deecell Fleet Manager";
const APP_URL = process.env.NODE_ENV === "production" 
  ? "https://app.deecell.com" 
  : "http://localhost:5000";

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  if (!SENDGRID_API_KEY) {
    console.error("SendGrid API key not configured");
    return false;
  }

  try {
    await sgMail.send({
      to: options.to,
      from: {
        email: SENDER_EMAIL,
        name: SENDER_NAME,
      },
      subject: options.subject,
      html: options.html,
      text: options.text || options.html.replace(/<[^>]*>/g, ""),
    });
    console.log(`Email sent successfully to ${options.to}`);
    return true;
  } catch (error: any) {
    console.error("Failed to send email:", error.response?.body || error.message);
    return false;
  }
}

function getEmailWrapper(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Deecell Fleet Manager</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #16a34a; padding: 24px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
                Deecell Fleet Manager
              </h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 32px 24px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f4f4f5; padding: 24px; text-align: center; border-top: 1px solid #e4e4e7;">
              <p style="margin: 0 0 8px 0; color: #71717a; font-size: 12px;">
                This email was sent by Deecell Fleet Manager
              </p>
              <p style="margin: 0; color: #71717a; font-size: 12px;">
                &copy; ${new Date().getFullYear()} Deecell. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

export async function sendPasswordResetEmail(
  email: string,
  resetToken: string,
  firstName?: string
): Promise<boolean> {
  const resetUrl = `${APP_URL}/reset-password?token=${resetToken}`;
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  const content = `
    <p style="margin: 0 0 16px 0; color: #18181b; font-size: 16px;">${greeting}</p>
    <p style="margin: 0 0 24px 0; color: #3f3f46; font-size: 14px; line-height: 1.6;">
      We received a request to reset your password for your Deecell Fleet Manager account.
      Click the button below to create a new password:
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
      <tr>
        <td align="center">
          <a href="${resetUrl}" style="display: inline-block; background-color: #16a34a; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 6px;">
            Reset Password
          </a>
        </td>
      </tr>
    </table>
    <p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 14px; line-height: 1.6;">
      This link will expire in 1 hour for security reasons.
    </p>
    <p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 14px; line-height: 1.6;">
      If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
    </p>
    <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;">
    <p style="margin: 0; color: #71717a; font-size: 12px;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${resetUrl}" style="color: #16a34a; word-break: break-all;">${resetUrl}</a>
    </p>
  `;

  return sendEmail({
    to: email,
    subject: "Reset Your Password - Deecell Fleet Manager",
    html: getEmailWrapper(content),
  });
}

export async function sendWelcomeEmail(
  email: string,
  firstName?: string,
  tempPassword?: string
): Promise<boolean> {
  const loginUrl = `${APP_URL}/login`;
  const greeting = firstName ? `Welcome ${firstName}!` : "Welcome!";

  const passwordSection = tempPassword
    ? `
      <p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 14px; line-height: 1.6;">
        Your temporary password is:
      </p>
      <p style="margin: 0 0 24px 0; padding: 12px 16px; background-color: #f4f4f5; border-radius: 6px; font-family: monospace; font-size: 16px; color: #18181b; letter-spacing: 1px;">
        ${tempPassword}
      </p>
      <p style="margin: 0 0 24px 0; color: #dc2626; font-size: 14px; font-weight: 500;">
        Please change your password after logging in for the first time.
      </p>
    `
    : "";

  const content = `
    <p style="margin: 0 0 16px 0; color: #18181b; font-size: 18px; font-weight: 600;">${greeting}</p>
    <p style="margin: 0 0 24px 0; color: #3f3f46; font-size: 14px; line-height: 1.6;">
      Your account has been created for Deecell Fleet Manager. You can now access real-time monitoring
      for your clean energy truck fleet, including battery health, solar savings, and maintenance alerts.
    </p>
    ${passwordSection}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
      <tr>
        <td align="center">
          <a href="${loginUrl}" style="display: inline-block; background-color: #16a34a; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 6px;">
            Log In to Dashboard
          </a>
        </td>
      </tr>
    </table>
    <p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 14px; line-height: 1.6;">
      <strong>What you can do:</strong>
    </p>
    <ul style="margin: 0 0 24px 0; padding-left: 20px; color: #3f3f46; font-size: 14px; line-height: 1.8;">
      <li>Monitor real-time battery status and voltage across your fleet</li>
      <li>Track idle-reduction fuel savings and CO₂ emissions reduction</li>
      <li>View historical performance data and trends</li>
      <li>Receive alerts for low battery and maintenance needs</li>
    </ul>
    <p style="margin: 0; color: #3f3f46; font-size: 14px;">
      If you have any questions, please contact your fleet administrator.
    </p>
  `;

  return sendEmail({
    to: email,
    subject: "Welcome to Deecell Fleet Manager",
    html: getEmailWrapper(content),
  });
}

export async function sendAlertEmail(
  email: string,
  alert: {
    type: string;
    severity: string;
    title: string;
    message: string;
    truckNumber?: string;
    deviceName?: string;
  }
): Promise<boolean> {
  const dashboardUrl = `${APP_URL}/dashboard`;
  
  const severityColors: Record<string, { bg: string; text: string; border: string }> = {
    critical: { bg: "#fef2f2", text: "#dc2626", border: "#fecaca" },
    warning: { bg: "#fffbeb", text: "#d97706", border: "#fde68a" },
    info: { bg: "#eff6ff", text: "#2563eb", border: "#bfdbfe" },
  };

  const colors = severityColors[alert.severity] || severityColors.info;
  const deviceInfo = alert.truckNumber 
    ? `Truck ${alert.truckNumber}${alert.deviceName ? ` (${alert.deviceName})` : ""}`
    : alert.deviceName || "Unknown Device";

  const content = `
    <div style="margin: 0 0 24px 0; padding: 16px; background-color: ${colors.bg}; border: 1px solid ${colors.border}; border-radius: 8px;">
      <p style="margin: 0 0 8px 0; color: ${colors.text}; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
        ${alert.severity.toUpperCase()} ALERT
      </p>
      <p style="margin: 0 0 8px 0; color: #18181b; font-size: 18px; font-weight: 600;">
        ${alert.title}
      </p>
      <p style="margin: 0; color: #3f3f46; font-size: 14px;">
        ${deviceInfo}
      </p>
    </div>
    <p style="margin: 0 0 24px 0; color: #3f3f46; font-size: 14px; line-height: 1.6;">
      ${alert.message}
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
      <tr>
        <td align="center">
          <a href="${dashboardUrl}" style="display: inline-block; background-color: #16a34a; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 6px;">
            View in Dashboard
          </a>
        </td>
      </tr>
    </table>
    <p style="margin: 0; color: #71717a; font-size: 12px;">
      This is an automated alert from Deecell Fleet Manager. To manage your notification preferences,
      please contact your fleet administrator.
    </p>
  `;

  const subjectPrefix = alert.severity === "critical" ? "🚨 CRITICAL: " : 
                        alert.severity === "warning" ? "⚠️ Warning: " : "ℹ️ ";

  return sendEmail({
    to: email,
    subject: `${subjectPrefix}${alert.title} - Deecell Fleet Manager`,
    html: getEmailWrapper(content),
  });
}

export async function sendPasswordChangedEmail(
  email: string,
  firstName?: string
): Promise<boolean> {
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  const content = `
    <p style="margin: 0 0 16px 0; color: #18181b; font-size: 16px;">${greeting}</p>
    <p style="margin: 0 0 24px 0; color: #3f3f46; font-size: 14px; line-height: 1.6;">
      Your password for Deecell Fleet Manager has been successfully changed.
    </p>
    <p style="margin: 0 0 24px 0; color: #3f3f46; font-size: 14px; line-height: 1.6;">
      If you did not make this change, please contact your administrator immediately or request a password reset.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
      <tr>
        <td align="center">
          <a href="${APP_URL}/login" style="display: inline-block; background-color: #16a34a; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 6px;">
            Log In
          </a>
        </td>
      </tr>
    </table>
    <p style="margin: 0; color: #71717a; font-size: 12px;">
      This is an automated security notification. You're receiving this because your password was changed.
    </p>
  `;

  return sendEmail({
    to: email,
    subject: "Password Changed - Deecell Fleet Manager",
    html: getEmailWrapper(content),
  });
}

export function isEmailConfigured(): boolean {
  return !!SENDGRID_API_KEY;
}
