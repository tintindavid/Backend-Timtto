/**
 * E3 round 2 (N1/N2): resend is a compare-and-set on the stored token hash and never stores a stale expiry.
 * SKIPPED unless MONGO_INTEGRATION_URI is set (own database, dropped).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import '../../src/models/area.model.js';
import '../../src/models/tipoRequisicion.model.js';
import { Requisicion } from '../../src/models/requisicion.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { requisicionLicitacionService as lic } from '../../src/services/requisicionLicitacion.service.js';
import { notificationService } from '../../src/services/notification.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { CAPS, futureDate, mkWorld, openTender, outbox, rawReq, rnd, sid, stubOutbound } from '../helpers/requisicionE3World.js';
import { hashToken } from '../../src/utils/requisicionToken.util.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const tokenOf = (m) => m.portalUrl.split('/public/requisicion/')[1];
const entry = async (w, paId) => (await rawReq(w.reqId)).licitacion.proveedores.find((p) => String(p._id) === paId);

describe('E3 resend: compare-and-set and fresh expiry', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  let savedEmit;
  before(async () => {
    await mongoose.connect(URI, { dbName: `req_e3rs_${rnd()}` });
    savedEmit = notificationService.emit;
    notificationService.emit = async () => ({ dispatched: 0 });
    for (const m of [Requisicion, Customer, Tenant, User]) { await m.init(); await m.syncIndexes(); }
  });
  after(async () => {
    notificationService.emit = savedEmit;
    await flushRequisicionNotifications();
    if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  });

  it('N1: two concurrent resends of the same supplier: one persists, the other gets 409; the stored hash is the winner\'s', async () => {
    stubOutbound();
    const w = await mkWorld();
    const { provs } = await openTender(w, 2);
    const target = provs[0];
    outbox.rfq.length = 0;
    // barrier: both resends have read the stored hash before either persists
    let arrived = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    lic.deps.email = {
      sendRequisicionRfqInvitationEmail: async (args) => {
        outbox.rfq.push(args);
        arrived += 1;
        if (arrived === 2) release();
        await gate;
        return { sent: true };
      },
    };
    const res = await Promise.allSettled([1, 2].map(() => lic.reenviar(w.tenantId, w.reqId, target.paId, w.actor, {}, CAPS)));
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
    const lost = res.find((r) => r.status === 'rejected');
    assert.equal(lost.reason.statusCode, 409);
    assert.equal(lost.reason.code, 'CONFLICTO_CONCURRENTE');
    const stored = (await entry(w, target.paId)).tokenHash;
    const valid = outbox.rfq.map(tokenOf).filter((t) => hashToken(t) === stored);
    assert.equal(valid.length, 1, 'exactly one of the two mailed links is the stored one');
    stubOutbound();
  });

  it('N1: a sequential second resend (hash re-read) succeeds and rotates again', async () => {
    stubOutbound();
    const w = await mkWorld();
    const { provs } = await openTender(w, 2);
    await lic.reenviar(w.tenantId, w.reqId, provs[0].paId, w.actor, {}, CAPS);
    await lic.reenviar(w.tenantId, w.reqId, provs[0].paId, w.actor, {}, CAPS);
    const last = tokenOf([...outbox.rfq].reverse().find((m) => m.to === provs[0].c.Email.toLowerCase()));
    assert.equal((await entry(w, provs[0].paId)).tokenHash, hashToken(last));
  });

  it('N2: a deadline extension that lands while the e-mail is going out is reflected in the stored expiry', async () => {
    stubOutbound();
    const w = await mkWorld();
    const { provs } = await openTender(w, 2);
    const nueva = futureDate(20);
    lic.deps.email = {
      sendRequisicionRfqInvitationEmail: async (args) => {
        outbox.rfq.push(args);
        await lic.ampliarFechaLimite(w.tenantId, w.reqId, w.actor, { fechaLimiteCotizacion: nueva.toISOString() }, CAPS);
        return { sent: true };
      },
    };
    const out = await lic.reenviar(w.tenantId, w.reqId, provs[0].paId, w.actor, {}, CAPS);
    assert.equal(out.envios.enviados.length, 1);
    const e = await entry(w, provs[0].paId);
    assert.equal(e.tokenVence.getTime(), nueva.getTime(), 'never the stale deadline');
    assert.equal(e.tokenHash, hashToken(tokenOf(outbox.rfq.at(-1))));
    stubOutbound();
  });
});
