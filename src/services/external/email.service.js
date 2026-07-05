import { env } from '../../config/env.js';
import { logger } from '../../config/logger.config.js';
import { renderTemplate } from '../../utils/renderTemplate.util.js';

/**
 * Internal send function via Resend HTTP API (port 443).
 * Replaces SMTP/nodemailer to avoid port 465 blocking on Railway and other
 * cloud platforms. Uses fetch (Node 18+) against https://api.resend.com/emails.
 *
 * Never logs html, text, nor the full error object.
 * Only logs sanitised metadata: { to, templateName }.
 */
async function _send({ to, subject, html, text, templateName }) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SMTP_PASSWORD}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>`,
        to: [to],
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error('email-service: send failed', { to, templateName, status: res.status, body });
      return { sent: false, error: `HTTP ${res.status}: ${body}` };
    }

    logger.info('email-service: sent', { to, templateName });
    return { sent: true };
  } catch (err) {
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

/**
 * Sends a self-service password recovery email with a secure reset link.
 *
 * Returns { sent: false, skipped: true } immediately when NOTIFICATIONS_ENABLED=false.
 *
 * @param {object} params
 * @param {string} params.to          Recipient email
 * @param {string} params.firstName   User's first name for greeting
 * @param {string} params.resetLink   Full URL to the reset-password page (contains rawToken)
 * @returns {Promise<{ sent: boolean, skipped?: boolean, error?: string }>}
 */
async function sendForgotPasswordEmail({ to, firstName, resetLink }) {
  if (!env.NOTIFICATIONS_ENABLED) {
    logger.debug('email-service: skipped (NOTIFICATIONS_ENABLED=false)', { to, templateName: 'forgot-password' });
    return { sent: false, skipped: true };
  }

  const vars = { firstName, resetLink };
  const [html, text] = await Promise.all([
    renderTemplate('forgot-password.hbs', vars),
    renderTemplate('forgot-password.txt.hbs', vars),
  ]);

  return _send({
    to,
    subject: 'Recupera tu contraseña — TIMTTO',
    html,
    text,
    templateName: 'forgot-password',
  });
}

// Startup diagnostic — visible en logs de producción al arrancar el servidor
(() => {
  if (!env.NOTIFICATIONS_ENABLED) {
    logger.warn('email-service: DESHABILITADO — NOTIFICATIONS_ENABLED no es "true". Los emails NO se enviarán.');
    return;
  }
  if (!env.SMTP_PASSWORD) {
    logger.error('email-service: NOTIFICATIONS_ENABLED=true pero SMTP_PASSWORD (Resend API key) está vacío. Los emails FALLARÁN.');
    return;
  }
  logger.info('email-service: habilitado (Resend HTTP API)', {
    from: env.EMAIL_FROM_ADDRESS,
    hasApiKey: true,
  });
})();

export const emailService = {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendForgotPasswordEmail,
};
