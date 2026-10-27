/**
 * Email channel of notificationService.emit + email attachments + requisicion
 * payloads (openspec/changes/requisiciones-e1-base-aprobacion,
 * specs/notification-email-channel). DB-free: model statics and emailService
 * methods are monkey-patched and restored in afterEach.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { notificationService } from '../../src/services/notification.service.js';
import { emailService } from '../../src/services/external/email.service.js';
import { Notification } from '../../src/models/notification.model.js';
import { NotificationRule } from '../../src/models/notificationRule.model.js';
import { NotificationPreference } from '../../src/models/notificationPreference.model.js';
import { User } from '../../src/models/user.model.js';
import { socketBridge } from '../../src/socket/index.js';
import { env } from '../../src/config/env.js';
import { NOTIFICATION_EVENTS } from '../../src/config/notificationEvents.js';
import {
  buildRequisicionApprovedPayload,
  buildRequisicionApprovalRequestedPayload,
  REQUISICION_PAYLOAD_BUILDERS,
} from '../../src/services/notifications/requisicionPayload.util.js';

const U1 = '507f1f77bcf86cd799439021';
const U2 = '507f1f77bcf86cd799439022';
const EVENT = 'requisicion.approved';

const restores = [];
function stub(target, key, value) {
  restores.push([target, key, target[key]]);
  target[key] = value;
}
function restoreAll() {
  while (restores.length) {
    const [t, k, v] = restores.pop();
    t[k] = v;
  }
}
function mockQuery(result) {
  return {
    lean: () => Promise.resolve(result),
    then: (res, rej) => Promise.resolve(result).then(res, rej),
  };
}

function setup(tenant, { channels = ['inapp', 'email'], prefs = [], notificationsEnabled = true } = {}) {
  stub(env, 'NOTIFICATIONS_ENABLED', notificationsEnabled);
  stub(env, 'PUBLIC_APP_URL', 'https://app.test');
  stub(NotificationRule, 'findOne', () =>
    mockQuery({ tenantId: tenant, event: EVENT, enabled: true, recipients: { roles: [], userIds: [U1, U2] }, channels }));
  stub(User, 'find', () => mockQuery([{ _id: U1 }, { _id: U2 }]));
  stub(User, 'findOne', (q) =>
    mockQuery({ _id: q._id, email: `${q._id}@x.test`, firstName: 'Ana' }));
  stub(NotificationPreference, 'find', () => mockQuery(prefs));
  const inapp = [];
  stub(Notification, 'create', async (doc) => {
    inapp.push(doc);
    return { ...doc, toObject: () => doc };
  });
  stub(socketBridge, 'getIO', () => ({ to: () => ({ emit: () => {} }) }));
  const sent = [];
  stub(emailService, 'sendNotificationEmail', async (args) => { sent.push(args); return { sent: true }; });
  return { inapp, sent };
}

describe('notificationService.emit - email channel', () => {
  afterEach(restoreAll);

  it('rule with inapp+email: every recipient gets the in-app notification and an email with deep link', async () => {
    const { inapp, sent } = setup('t-email-1');
    const payload = buildRequisicionApprovedPayload({ requisicionId: 'abc123', consecutivo: 'REQ-2026-0001' });
    const res = await notificationService.emit('t-email-1', EVENT, payload);

    assert.equal(res.dispatched, 2);
    assert.equal(inapp.length, 2);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent.map((s) => s.to).sort(), [`${U1}@x.test`, `${U2}@x.test`].sort());
    assert.equal(sent[0].link, 'https://app.test/requisiciones/abc123');
    assert.equal(sent[0].subject, payload.title);
  });

  it('muted email channel: no email, in-app still delivered', async () => {
    const { inapp, sent } = setup('t-email-2', {
      prefs: [{ userId: U1, mutedChannels: ['email'] }],
    });
    await notificationService.emit('t-email-2', EVENT, { title: 'x' });

    assert.equal(inapp.length, 2);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, `${U2}@x.test`);
  });

  it('provider failure (returned error or thrown) is logged, never thrown, other deliveries continue', async () => {
    const { inapp } = setup('t-email-3');
    let calls = 0;
    stub(emailService, 'sendNotificationEmail', async () => {
      calls += 1;
      if (calls === 1) return { sent: false, error: 'HTTP 500' };
      throw new Error('boom');
    });

    const res = await notificationService.emit('t-email-3', EVENT, { title: 'x' });

    assert.equal(calls, 2);
    assert.equal(inapp.length, 2);
    assert.equal(res.dispatched, 2);
  });

  it('NOTIFICATIONS_ENABLED off: no emails are sent', async () => {
    const { sent, inapp } = setup('t-email-4', { notificationsEnabled: false });
    await notificationService.emit('t-email-4', EVENT, { title: 'x' });
    assert.equal(sent.length, 0);
    assert.equal(inapp.length, 2);
  });

  it('event without rule: no-op, no error, nothing sent', async () => {
    const { sent, inapp } = setup('t-email-5');
    stub(NotificationRule, 'findOne', () => mockQuery(null));
    const res = await notificationService.emit('t-email-5', EVENT, { title: 'x' });
    assert.equal(res.dispatched, 0);
    assert.equal(sent.length, 0);
    assert.equal(inapp.length, 0);
  });
});

describe('emailService attachments', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    restoreAll();
    delete process.env.EMAIL_ATTACHMENT_MAX_BYTES;
  });

  it('attachment within limit reaches the provider (base64); sends without attachments are unchanged', async () => {
    stub(env, 'NOTIFICATIONS_ENABLED', true);
    const bodies = [];
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, text: async () => '' };
    };
    const r1 = await emailService.sendNotificationEmail({
      to: 'a@x.test', subject: 'S', body: 'b',
      attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', content: Buffer.from('hello') }],
    });
    const r2 = await emailService.sendNotificationEmail({ to: 'a@x.test', subject: 'S', body: 'b' });

    assert.equal(r1.sent, true);
    assert.deepEqual(bodies[0].attachments, [
      { filename: 'a.pdf', content: Buffer.from('hello').toString('base64'), content_type: 'application/pdf' },
    ]);
    assert.equal(r2.sent, true);
    assert.equal('attachments' in bodies[1], false);
  });

  it('attachment over the limit is rejected with error, no fetch, no throw', async () => {
    stub(env, 'NOTIFICATIONS_ENABLED', true);
    process.env.EMAIL_ATTACHMENT_MAX_BYTES = '4';
    let fetched = false;
    globalThis.fetch = async () => { fetched = true; return { ok: true }; };
    const r = await emailService.sendNotificationEmail({
      to: 'a@x.test', subject: 'S',
      attachments: [{ filename: 'big.bin', content: Buffer.from('12345') }],
    });
    assert.equal(r.sent, false);
    assert.match(r.error, /excede/);
    assert.equal(fetched, false);
  });
});

describe('requisicion events and payloads', () => {
  it('all requisicion events are registered', () => {
    for (const e of Object.keys(REQUISICION_PAYLOAD_BUILDERS)) {
      assert.ok(NOTIFICATION_EVENTS.includes(e), e);
    }
    assert.equal(Object.keys(REQUISICION_PAYLOAD_BUILDERS).length, 7);
  });

  it('payload deep-links to /requisiciones/:id', () => {
    const p = buildRequisicionApprovalRequestedPayload({ requisicionId: 'r1', consecutivo: 'REQ-1', nivel: 2 });
    assert.equal(p.data.link, '/requisiciones/r1');
    assert.match(p.title, /REQ-1/);
    assert.match(p.body, /nivel 2/);
  });
});
