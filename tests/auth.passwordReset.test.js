import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { authController } from '../src/controllers/auth.controller.js';
import { userService } from '../src/services/user.service.js';
import { emailService } from '../src/services/external/email.service.js';
import { ApiError } from '../src/utils/apiError.util.js';

// Helper: construye un res mock que captura la llamada a json()
function makeRes() {
  const res = { jsonPayload: null };
  res.json = (payload) => { res.jsonPayload = payload; };
  return res;
}

describe('authController.forgotPassword', () => {
  afterEach(() => {
    delete userService.createPasswordResetToken;
    delete emailService.sendForgotPasswordEmail;
  });

  it('responde 200 genérico cuando el usuario existe y el email se envía', async () => {
    userService.createPasswordResetToken = async (email, tenantId) => ({
      rawToken: 'a'.repeat(64),
      user: { email, firstName: 'Ana', tenantId },
    });
    emailService.sendForgotPasswordEmail = async () => ({ sent: true });

    const req = { body: { email: 'ana@acme.com' }, tenantId: 'acme' };
    const res = makeRes();
    const next = (err) => { throw err; };

    await authController.forgotPassword(req, res, next);

    assert.equal(res.jsonPayload.success, true);
    assert.ok(res.jsonPayload.message.includes('Si el email'));
  });

  it('responde 200 genérico aunque el usuario NO exista (anti-enumeration)', async () => {
    userService.createPasswordResetToken = async () => null;
    emailService.sendForgotPasswordEmail = async () => { throw new Error('no debería llamarse'); };

    const req = { body: { email: 'inexistente@acme.com' }, tenantId: 'acme' };
    const res = makeRes();
    const next = (err) => { throw err; };

    await authController.forgotPassword(req, res, next);

    assert.equal(res.jsonPayload.success, true);
    assert.ok(res.jsonPayload.message.includes('Si el email'));
  });

  it('llama a next(error) si userService lanza un error inesperado', async () => {
    userService.createPasswordResetToken = async () => { throw new ApiError(500, 'DB error', 'DB_ERROR'); };

    const req = { body: { email: 'test@acme.com' }, tenantId: 'acme' };
    const res = makeRes();
    let capturedError = null;
    const next = (err) => { capturedError = err; };

    await authController.forgotPassword(req, res, next);

    assert.ok(capturedError instanceof ApiError);
    assert.equal(capturedError.statusCode, 500);
  });
});

describe('authController.resetPassword', () => {
  afterEach(() => {
    delete userService.resetPassword;
  });

  it('responde 200 cuando el token es válido', async () => {
    userService.resetPassword = async () => ({ _id: 'user-1', email: 'ana@acme.com' });

    const req = { body: { token: 'a'.repeat(64), tenantId: 'acme', newPassword: 'NuevaPass123' } };
    const res = makeRes();
    const next = (err) => { throw err; };

    await authController.resetPassword(req, res, next);

    assert.equal(res.jsonPayload.success, true);
    assert.ok(res.jsonPayload.message.includes('restablecida'));
  });

  it('pasa ApiError(400) a next cuando el token es inválido o expirado', async () => {
    userService.resetPassword = async () => {
      throw new ApiError(400, 'Token inválido o expirado', 'TOKEN_INVALID_OR_EXPIRED');
    };

    const req = { body: { token: 'b'.repeat(64), tenantId: 'acme', newPassword: 'NuevaPass123' } };
    const res = makeRes();
    let capturedError = null;
    const next = (err) => { capturedError = err; };

    await authController.resetPassword(req, res, next);

    assert.ok(capturedError instanceof ApiError);
    assert.equal(capturedError.statusCode, 400);
    assert.equal(capturedError.code, 'TOKEN_INVALID_OR_EXPIRED');
  });
});
