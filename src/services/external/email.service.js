import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.config.js';
import { renderTemplate } from '../../utils/renderTemplate.util.js';

/**
 * Nodemailer transport configured for Resend SMTP relay.
 * Uses SSL on port 465 (recommended by Resend).
 * Auth: user='resend', pass=<Resend API Key starting with re_...>.
 *
 * The transport is created once at module load time. If SMTP credentials
 * are invalid, errors surface on the first sendMail call (not at startup).
 */
const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: true, // SSL directo en puerto 465
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASSWORD,
  },
  connectionTimeout: 10_000,
  greetingTimeout: 5_000,
  socketTimeout: 15_000,
});

/**
 * Internal send function. Never called when NOTIFICATIONS_ENABLED=false
 * (the public methods guard against that before reaching this function).
 *
 * Never logs html, text, temporaryPassword, nor the full error object.
 * Only logs sanitised metadata: { to, templateName }.
 *
 * @param {object} params
 * @param {string} params.to            Recipient email address
 * @param {string} params.subject       Email subject line
 * @param {string} params.html          Rendered HTML body
 * @param {string} params.text          Rendered plain-text body
 * @param {string} params.templateName  Template identifier (for logs)
 * @returns {Promise<{ sent: boolean, error?: string }>}
 */
async function _send({ to, subject, html, text, templateName }) {
  try {
    await transport.sendMail({
      from: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>`,
      to,
      subject,
      html,
      text,
    });
    logger.info('email-service: sent', { to, templateName });
    return { sent: true };
  } catch (err) {
    // Log only err.message — never the full err object (may contain SMTP credentials in some nodemailer versions)
    logger.error('email-service: send failed', { to, templateName, error: err.message });
    return { sent: false, error: err.message };
  }
}

/**
 * Sends the welcome email to the first admin of a newly created tenant.
 *
 * Returns { sent: false, skipped: true } immediately when NOTIFICATIONS_ENABLED=false
 * without reading any template or opening a SMTP connection.
 *
 * @param {object} params
 * @param {string} params.to                Recipient email (admin.email)
 * @param {string} params.tenantName        Human-readable org name
 * @param {string} params.tenantId          Tenant slug (e.g. 'clinica-norte')
 * @param {string} params.adminFirstName    Admin's first name for greeting
 * @param {string} params.temporaryPassword One-time temporary password
 * @param {string} params.loginUrl          Full URL to the login page
 * @returns {Promise<{ sent: boolean, skipped?: boolean, error?: string }>}
 */
async function sendWelcomeEmail({ to, tenantName, tenantId, adminFirstName, temporaryPassword, loginUrl }) {
  if (!env.NOTIFICATIONS_ENABLED) {
    logger.debug('email-service: skipped (NOTIFICATIONS_ENABLED=false)', { to, templateName: 'welcome-tenant-admin' });
    return { sent: false, skipped: true };
  }

  const vars = { adminFirstName, tenantName, tenantId, to, temporaryPassword, loginUrl };
  const [html, text] = await Promise.all([
    renderTemplate('welcome-tenant-admin.hbs', vars),
    renderTemplate('welcome-tenant-admin.txt.hbs', vars),
  ]);

  return _send({
    to,
    subject: 'Bienvenido a TIMTTO — tu cuenta está lista',
    html,
    text,
    templateName: 'welcome-tenant-admin',
  });
}

/**
 * Sends a password-reset email to a user whose password was reset by a SuperAdmin.
 *
 * Returns { sent: false, skipped: true } immediately when NOTIFICATIONS_ENABLED=false.
 *
 * @param {object} params
 * @param {string} params.to                Recipient email (user.email)
 * @param {string} params.firstName         User's first name for greeting
 * @param {string} params.temporaryPassword New one-time temporary password
 * @param {string} params.loginUrl          Full URL to the login page
 * @returns {Promise<{ sent: boolean, skipped?: boolean, error?: string }>}
 */
async function sendPasswordResetEmail({ to, firstName, temporaryPassword, loginUrl }) {
  if (!env.NOTIFICATIONS_ENABLED) {
    logger.debug('email-service: skipped (NOTIFICATIONS_ENABLED=false)', { to, templateName: 'password-reset' });
    return { sent: false, skipped: true };
  }

  const vars = { firstName, to, temporaryPassword, loginUrl };
  const [html, text] = await Promise.all([
    renderTemplate('password-reset.hbs', vars),
    renderTemplate('password-reset.txt.hbs', vars),
  ]);

  return _send({
    to,
    subject: 'Tu contraseña ha sido restablecida',
    html,
    text,
    templateName: 'password-reset',
  });
}

export const emailService = {
  sendWelcomeEmail,
  sendPasswordResetEmail,
};
