'use strict';
import { Server as SocketIOServer } from 'socket.io';
import { verifyToken } from '../utils/jwt.util.js';
import { logger } from '../config/logger.config.js';

let io = null;

/**
 * Same allow-list Express uses for CORS (see app.js `corsOrigins`). There is
 * no shared util for this yet in the codebase, so the resolution logic is
 * duplicated here on purpose — keep both in sync if the env var contract
 * changes.
 */
function resolveCorsOrigins() {
  return (
    process.env.CORS_ORIGIN?.split(',') ||
    process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173']
  );
}

/**
 * initSocket(httpServer) — mounts a Socket.IO server on the same httpServer
 * Express listens on (design.md D1, single dyno on Railway — no Redis
 * adapter). Call exactly once from src/server.js, after
 * `http.createServer(app)` and before `httpServer.listen(...)`.
 *
 * Auth (design.md D2): the client passes a JWT via
 * `socket.handshake.auth.token`. It is verified with the SAME secret/util
 * (`verifyToken`) as the HTTP `authenticate` middleware. On failure the
 * handshake is rejected via `next(new Error(...))`, which Socket.IO surfaces
 * to the client as a `connect_error` — the connection is never opened.
 *
 * Rooms (design.md D3): on success the socket is auto-joined, SERVER-SIDE, to
 * three rooms derived from the verified JWT claims:
 *   - `user:{userId}`
 *   - `tenant:{tenantId}`
 *   - `tenant:{tenantId}:role:{role}`
 * No client-inbound `join`/`leave` (or any other) event handlers are
 * registered anywhere in this module — clients cannot request to join an
 * arbitrary room.
 */
export function initSocket(httpServer) {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: resolveCorsOrigins(),
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake?.auth?.token;
    if (!token || typeof token !== 'string') {
      return next(new Error('unauthorized'));
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      return next(new Error('unauthorized'));
    }

    if (!decoded?.userId || !decoded?.tenantId || !decoded?.role) {
      return next(new Error('unauthorized'));
    }

    socket.data.userId = decoded.userId;
    socket.data.tenantId = decoded.tenantId;
    socket.data.role = decoded.role;

    socket.join([
      `user:${decoded.userId}`,
      `tenant:${decoded.tenantId}`,
      `tenant:${decoded.tenantId}:role:${decoded.role}`,
    ]);

    return next();
  });

  io.on('connection', (socket) => {
    logger.info('Socket connected', {
      userId: socket.data.userId,
      tenantId: socket.data.tenantId,
      role: socket.data.role,
    });
    // Intentionally no inbound event handlers registered (design.md D3):
    // clients cannot join/leave rooms or trigger server behavior via socket.
  });

  return io;
}

/**
 * getIO() — singleton accessor. Throws if called before `initSocket()` (that
 * should never happen after src/server.js finishes booting).
 */
export function getIO() {
  if (!io) {
    throw new Error('Socket.IO not initialized — call initSocket(httpServer) first');
  }
  return io;
}

/**
 * Mutable wrapper around `getIO`, consumed by notification.service.js.
 * Reason it exists: ESM named-export bindings (and `import * as ns`
 * namespace objects) are read-only/frozen, so tests cannot reassign `getIO`
 * directly. Exporting it as a property on a plain object follows the same
 * convention already used across this codebase for test-overridable
 * singletons (e.g. `export const ticketService = new TicketService()`,
 * whose methods tests reassign directly — see
 * tests/services/clientAccessToken.service.test.js).
 */
export const socketBridge = { getIO };
