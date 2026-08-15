/**
 * tests/socket/socket.handshake.test.js
 *
 * End-to-end handshake tests for src/socket/index.js — spins up a real
 * Node http.Server on a random port, mounts initSocket(), and connects
 * with socket.io-client to verify:
 *   - Valid JWT → connect succeeds, socket joins the 3 rooms derived from
 *     the JWT (user/tenant/tenant-role).
 *   - Missing / malformed / expired JWT → connect_error, no rooms joined.
 *   - No inbound client-triggered event handlers exist for `join`/`leave`
 *     (client attempts to trigger them have no effect on room membership).
 *
 * Covers spec.md R1 scenarios: "Authenticated connection joins the correct
 * rooms", "Invalid or missing JWT is rejected at handshake", "Client cannot
 * join arbitrary rooms".
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { io as ioClient } from 'socket.io-client';
import { env } from '../../src/config/env.js';
import { initSocket } from '../../src/socket/index.js';

const USER_ID = '507f1f77bcf86cd799439011';
const TENANT_ID = 'tenant-handshake-test';
const ROLE = 'admin';

let httpServer;
let ioServer;
let port;

before(async () => {
  httpServer = createServer();
  ioServer = initSocket(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  port = httpServer.address().port;
});

after(async () => {
  await new Promise((resolve) => ioServer.close(resolve));
  await new Promise((resolve) => httpServer.close(resolve));
});

function url() {
  return `http://127.0.0.1:${port}`;
}

function signToken(payload, overrides = {}) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '5m', ...overrides });
}

async function connectAndWait(auth) {
  const client = ioClient(url(), {
    auth,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 3000);
    client.once('connect', () => {
      clearTimeout(timer);
      resolve({ client, ok: true });
    });
    client.once('connect_error', (err) => {
      clearTimeout(timer);
      resolve({ client, ok: false, err });
    });
  });
}

describe('Socket.IO handshake', () => {
  it('accepts a valid JWT and joins user/tenant/role rooms', async () => {
    const token = signToken({ userId: USER_ID, tenantId: TENANT_ID, role: ROLE });
    const { client, ok, err } = await connectAndWait({ token });
    try {
      assert.equal(ok, true, `expected connect, got connect_error: ${err?.message}`);
      const serverSocket = Array.from(ioServer.sockets.sockets.values()).find(
        (s) => s.data.userId === USER_ID && s.data.tenantId === TENANT_ID,
      );
      assert.ok(serverSocket, 'server-side socket for our JWT must exist');
      assert.ok(serverSocket.rooms.has(`user:${USER_ID}`));
      assert.ok(serverSocket.rooms.has(`tenant:${TENANT_ID}`));
      assert.ok(serverSocket.rooms.has(`tenant:${TENANT_ID}:role:${ROLE}`));
    } finally {
      client.disconnect();
    }
  });

  it('rejects a missing token with connect_error', async () => {
    const { client, ok, err } = await connectAndWait({});
    try {
      assert.equal(ok, false);
      assert.match(String(err?.message || ''), /unauthorized/i);
    } finally {
      client.disconnect();
    }
  });

  it('rejects a malformed token with connect_error', async () => {
    const { client, ok, err } = await connectAndWait({ token: 'not-a-jwt' });
    try {
      assert.equal(ok, false);
      assert.match(String(err?.message || ''), /unauthorized/i);
    } finally {
      client.disconnect();
    }
  });

  it('rejects an expired token with connect_error', async () => {
    const expired = signToken(
      { userId: USER_ID, tenantId: TENANT_ID, role: ROLE },
      { expiresIn: '-1s' },
    );
    const { client, ok, err } = await connectAndWait({ token: expired });
    try {
      assert.equal(ok, false);
      assert.match(String(err?.message || ''), /unauthorized/i);
    } finally {
      client.disconnect();
    }
  });

  it('ignores client-emitted join/leave — room membership is unchanged', async () => {
    const token = signToken({ userId: USER_ID, tenantId: TENANT_ID, role: ROLE });
    const { client, ok } = await connectAndWait({ token });
    try {
      assert.equal(ok, true);
      // Attempt to join a foreign tenant's room via client emit — server
      // must not register any handler for these, so membership stays as
      // originally derived from the JWT.
      client.emit('join', 'tenant:other-tenant');
      client.emit('join', 'tenant:other-tenant:role:admin');
      client.emit('leave', `user:${USER_ID}`);
      // Give the server a tick to (not) process anything.
      await new Promise((r) => setTimeout(r, 100));
      const serverSocket = Array.from(ioServer.sockets.sockets.values()).find(
        (s) => s.data.userId === USER_ID && s.data.tenantId === TENANT_ID,
      );
      assert.ok(serverSocket, 'server-side socket must still exist');
      assert.equal(serverSocket.rooms.has('tenant:other-tenant'), false);
      assert.equal(serverSocket.rooms.has('tenant:other-tenant:role:admin'), false);
      // user:USER_ID still joined — client cannot leave rooms either.
      assert.ok(serverSocket.rooms.has(`user:${USER_ID}`));
    } finally {
      client.disconnect();
    }
  });
});
