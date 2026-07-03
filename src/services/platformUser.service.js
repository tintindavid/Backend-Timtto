import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { generateTemporaryPassword } from '../utils/temporaryPassword.util.js';
import { emailService } from './external/email.service.js';
import { env } from '../config/env.js';

/**
 * PlatformUserService — cross-tenant user operations for the SuperAdmin.
 *
 * Unlike domain services, these methods intentionally omit the mandatory
 * tenantId filter because the SuperAdmin operates across all tenants.
 * This is the documented exception in backend-standards §5.
 */
export class PlatformUserService {
  /**
   * Cross-tenant paginated list of users with optional filters.
   *
   * @param {object} params
   * @param {number} [params.page=1]
   * @param {number} [params.limit=20]
   * @param {string} [params.tenantId]  - filter to a specific tenant
   * @param {string} [params.role]      - filter by role
   * @param {string} [params.email]     - partial/full email match (case-insensitive)
   */
  async list({ page = 1, limit = 20, tenantId, role, email } = {}) {
    const filter = { isDeleted: false };

    if (tenantId) filter.tenantId = tenantId;
    if (role) filter.role = role;
    if (email) filter.email = new RegExp(email, 'i');

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(Math.max(1, Number(limit)), 100);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      User.find(filter)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(filter),
    ]);

    const pages = Math.ceil(total / limitNum) || 1;

    return {
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages,
        hasNext: pageNum < pages,
        hasPrev: pageNum > 1,
      },
    };
  }

  /**
   * Resets a user's password regardless of tenant.
   *
   * Generates a cryptographically secure temporary password, assigns it to
   * the user (the User.pre('save') hook hashes it automatically), and flags
   * mustChangePassword=true so the user is forced to rotate on next login.
   *
   * The plain-text password is returned ONCE in the response and is never
   * persisted in cleartext.
   *
   * @param {string} userId  - MongoDB _id of the target user
   * @returns {{ user: object, temporaryPassword: string }}
   */
  async resetPasswordCrossTenant(userId) {
    // Cross-tenant lookup: no tenantId filter by design.
    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, 'Usuario no encontrado', 'USER_NOT_FOUND', { userId });
    }

    const temporaryPassword = generateTemporaryPassword();

    // Assign plain-text password — the pre-save bcrypt hook will hash it.
    user.password = temporaryPassword;
    user.mustChangePassword = true;

    await user.save();

    logger.info('PlatformUserService: password reset cross-tenant', {
      targetUserId: userId,
      targetTenantId: user.tenantId,
    });

    // Fire-and-forget the email so the HTTP response is not blocked by the
    // SMTP round-trip (~1-10s to Resend). Design D4/D8: `emailSent` is
    // best-effort intent, not delivery confirmation. Failures are logged
    // inside the email service; the defensive modal keeps the password
    // visible so the operator can share manually if the email never arrives.
    emailService
      .sendPasswordResetEmail({
        to: user.email,
        firstName: user.firstName || 'Usuario',
        temporaryPassword,
        loginUrl: env.PUBLIC_APP_URL + '/login',
      })
      .catch((err) => logger.error('platformUser: unhandled email error', { targetUserId: userId, error: err.message }));

    // Return safe user representation (toJSON removes password).
    // emailSent reflects the flag being on — actual delivery is tracked in Resend dashboard.
    return { user: user.toJSON(), temporaryPassword, emailSent: env.NOTIFICATIONS_ENABLED === true };
  }
}

export const platformUserService = new PlatformUserService();
