/**
 * requisiciones-e3-compras-portal, tasks 5.1-5.3: recipients of the tendering notifications, resilience (a failing emit
 * never breaks the operation), the supplier e-mails (escaped HTML, no prices, no link in the award) and the registry.
 * DB-free: Role/User lookups and the transport are stubbed.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { flushRequisicionNotifications, notifyRequisicion } from '../../src/services/requisicionNotify.service.js';
import { notificationService } from '../../src/services/notification.service.js';
import { Role } from '../../src/models/role.model.js';
import { User } from '../../src/models/user.model.js';
import { NOTIFICATION_EVENTS } from '../../src/config/notificationEvents.js';
import { REQUISICION_PAYLOAD_BUILDERS } from '../../src/services/notifications/requisicionPayload.util.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { emailService } from '../../src/services/external/email.service.js';
import { renderTemplate } from '../../src/utils/renderTemplate.util.js';
import { env } from '../../src/config/env.js';

const T = 'tenant-a';
const REQ = { _id: 'r1', consecutivo: 'REQ-2026-0007', creadaPor: 'u-creator', solicitanteId: 'u-requester' };
const q = (val) => ({ lean: async () => val, select() { return this; } });
const saved = {};
let emits;
let roleFilter;

beforeEach(() => {
  emits = [];
  Object.assign(saved, { emit: notificationService.emit, rFind: Role.find, uFind: User.find });
  notificationService.emit = async (tenantId, event, payload, options) => { emits.push({ tenantId, event, payload, options }); return { dispatched: 1 }; };
  Role.find = (f) => { roleFilter = f; return q([{ _id: 'role-buyer' }]); };
  User.find = () => q([{ _id: 'u-buyer-1' }, { _id: 'u-buyer-2' }, { _id: 'u-creator' }]);
});
afterEach(async () => {
  await flushRequisicionNotifications();
  notificationService.emit = saved.emit; Role.find = saved.rFind; User.find = saved.uFind;
});

const recipients = (e) => [...e.options.extraRecipientUserIds].sort();

describe('E3 events: registry, builders and recipients', () => {
  it('the three events are registered and build a payload that links to the licitacion tab', () => {
    for (const ev of ['requisicion.rfq.sent', 'requisicion.quote.received', 'requisicion.winner.selected']) {
      assert.ok(NOTIFICATION_EVENTS.includes(ev), ev);
      const p = REQUISICION_PAYLOAD_BUILDERS[ev]({ requisicionId: 'r1', consecutivo: 'REQ-1', actorName: 'Ana', proveedorNombre: 'Prov SA', enviados: 2, fallidos: 1 });
      assert.ok(p.title && p.body, ev);
      assert.equal(p.data.link, '/requisiciones/r1?tab=licitacion');
    }
    assert.match(REQUISICION_PAYLOAD_BUILDERS['requisicion.rfq.sent']({ requisicionId: 'r', enviados: 2, fallidos: 1 }).body, /2 invitaci.*1 no se pudieron/);
  });

  it('rfq.sent goes to the creator and the requester (the actor is excluded)', async () => {
    await notifyRequisicion(T, 'requisicion.rfq.sent', REQ, { actorId: 'u-creator', enviados: 3, fallidos: 0 });
    const [e] = emits;
    assert.deepEqual(recipients(e), ['u-creator', 'u-requester']);
    assert.deepEqual(e.options.excludeRecipientUserIds, ['u-creator']);
  });

  it('quote.received and winner.selected also reach the buyers holding manage-suppliers', async () => {
    await notifyRequisicion(T, 'requisicion.quote.received', REQ, { proveedorNombre: 'Prov SA' });
    await notifyRequisicion(T, 'requisicion.winner.selected', REQ, { actorId: 'u-buyer-1', proveedorNombre: 'Prov SA' });
    assert.equal(roleFilter.permissions, PERMISSIONS.REQUISICIONES_MANAGE_SUPPLIERS);
    assert.equal(roleFilter.tenantId, T);
    for (const e of emits) assert.deepEqual(recipients(e), ['u-buyer-1', 'u-buyer-2', 'u-creator', 'u-requester']);
    assert.equal(emits[0].options.excludeRecipientUserIds.length, 0, 'portal quote: no internal actor');
    assert.match(emits[0].payload.body, /Prov SA/);
  });

  it('a failing emit is logged and never breaks the caller', async () => {
    notificationService.emit = async () => { throw new Error('boom'); };
    await assert.doesNotReject(notifyRequisicion(T, 'requisicion.quote.received', REQ, {}));
    Role.find = () => { throw new Error('db down'); };
    await assert.doesNotReject(notifyRequisicion(T, 'requisicion.winner.selected', REQ, {}));
  });
});

describe('supplier e-mails', () => {
  const hostile = { descripcion: '<script>alert(1)</script>', cantidad: 2, unidad: '<b>und</b>', especificacion: '"><img src=x onerror=alert(2)>' };
  const vars = { proveedorNombre: '<i>Prov</i>', tenantName: 'Clinica <b>Norte</b>', consecutivo: 'REQ-1', titulo: '<u>t</u>', fechaLimite: '10 de noviembre', portalUrl: 'https://app.test/public/requisicion/TOKEN', items: [hostile] };

  it('the invitation escapes every text that comes from data and carries a single personal link', async () => {
    const html = await renderTemplate('requisicion-rfq-invitation.hbs', vars);
    const text = await renderTemplate('requisicion-rfq-invitation.txt.hbs', vars);
    for (const raw of ['<script>', '<img src=x', '<b>und</b>', '<i>Prov</i>', 'Clinica <b>Norte</b>']) assert.ok(!html.includes(raw), `unescaped ${raw}`);
    assert.ok(html.includes('&lt;script&gt;'));
    assert.equal((html.match(/https:\/\/app\.test\/public\/requisicion\/TOKEN/g) || []).length, 1);
    assert.ok(text.includes('https://app.test/public/requisicion/TOKEN'));
    assert.ok(!/precio|\$\s?\d/i.test(html + text), 'no prices');
  });

  it('the award notice has no link and no prices', async () => {
    const html = await renderTemplate('requisicion-award.hbs', { proveedorNombre: '<i>P</i>', tenantName: 'C', consecutivo: 'REQ-1', titulo: 'x' });
    assert.ok(!html.includes('<i>P</i>'));
    assert.ok(!html.includes('href='));
  });

  it('emailService sends the invitation through the transport with escaped content, and reports a transport failure without throwing', async () => {
    const savedFetch = globalThis.fetch;
    const savedFlag = env.NOTIFICATIONS_ENABLED;
    env.NOTIFICATIONS_ENABLED = true;
    const sent = [];
    try {
      globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, text: async () => '' }; };
      const ok = await emailService.sendRequisicionRfqInvitationEmail({ to: 'p@prov.co', ...vars });
      assert.equal(ok.sent, true);
      assert.deepEqual(sent[0].to, ['p@prov.co']);
      assert.ok(!sent[0].html.includes('<script>'));
      globalThis.fetch = async () => { throw new Error('network'); };
      const bad = await emailService.sendRequisicionRfqInvitationEmail({ to: 'p@prov.co', ...vars });
      assert.equal(bad.sent, false);
      env.NOTIFICATIONS_ENABLED = false;
      assert.deepEqual(await emailService.sendRequisicionAwardEmail({ to: 'p@prov.co', consecutivo: 'R' }), { sent: false, skipped: true });
    } finally {
      globalThis.fetch = savedFetch;
      env.NOTIFICATIONS_ENABLED = savedFlag;
    }
  });
});
