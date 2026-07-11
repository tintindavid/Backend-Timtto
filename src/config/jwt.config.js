'use strict';
import { env } from './env.js';

/**
 * JWT configuration and startup assertions.
 *
 * The codebase uses two independent JWT secrets:
 *  - `JWT_SECRET`        signs panel tokens (issued by /api/v1/auth/login)
 *  - `JWT_PUBLIC_SECRET` signs the short-lived sessionToken issued by
 *                        POST /public/tickets/validate-access
 *
 * Per design decision D7, both must be set and MUST be distinct.
 * Per the security requirement in service-qrs/spec.md, the server SHALL
 * refuse to start when the two secrets are equal (defense in depth so a
 * leaked public secret cannot be replayed against panel routes).
 *
 * Throwing here causes server.js to log the failure and exit before
 * binding to a port.
 */
export function assertJwtConfig() {
  const panel = env.JWT_SECRET;
  const publicSecret = env.JWT_PUBLIC_SECRET;

  if (!panel || typeof panel !== 'string' || panel.trim() === '') {
    throw new Error(
      'JWT configuration error: JWT_SECRET is not set. Refusing to start.'
    );
  }

  if (!publicSecret || typeof publicSecret !== 'string' || publicSecret.trim() === '') {
    throw new Error(
      'JWT configuration error: JWT_PUBLIC_SECRET is not set. ' +
        'Set a distinct secret for /public/tickets/* sessionToken signing. Refusing to start.'
    );
  }

  if (panel === publicSecret) {
    throw new Error(
      'JWT configuration error: JWT_SECRET and JWT_PUBLIC_SECRET must be different. ' +
        'A shared secret would let panel tokens authorize public routes and vice versa. ' +
        'Refusing to start.'
    );
  }

  if (panel === 'replace_with_secure_secret' || publicSecret === 'replace_with_distinct_public_secret') {
    // Allow placeholders only in non-production environments; warn loudly.
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'JWT configuration error: placeholder JWT secrets detected in production. Refusing to start.'
      );
    }
  }
}

export const jwtConfig = {
  panel: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  },
  publicSession: {
    secret: env.JWT_PUBLIC_SECRET,
    expiresIn: env.JWT_PUBLIC_EXPIRES_IN,
  },
};
