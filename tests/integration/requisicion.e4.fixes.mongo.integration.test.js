/**
 * Requisiciones E4, fix round after the adversarial / security review, against a REAL MongoDB (node:test).
 * SKIPPED unless MONGO_INTEGRATION_URI is set. Creates and DROPS its own database `req_e4f_<random>`.
 *
 *   MONGO_INTEGRATION_URI=mongodb://127.0.0.1:27656 node --test tests/integration/requisicion.e4.fixes.mongo.integration.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { Requisicion } from '../../src/models/requisicion.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { requisicionOrdenCompraService as oc } from '../../src/services/requisicionOrdenCompra.service.js';
import { requisicionOrdenCompraEnvioService as envio } from '../../src/services/requisicionOrdenCompraEnvio.service.js';
import { requisicionOrdenCompraPdfService as pdf } from '../../src/services/requisicionOrdenCompraPdf.service.js';
import { requisicionService as reqService } from '../../src/services/requisicion.service.js';
import { flushRequisicionNotifications, notifyRequisicion } from '../../src/services/requisicionNotify.service.js';
import { notificationService } from '../../src/services/notification.service.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import {
  CAPS, actorOf, emitir, expectApi, llevarAOcEnviada, mkAdjudicada, mkRoleUser, ocBody, out4, rawReq, rnd, sid, stubOutbound4,
} from '../helpers/requisicionE4World.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const ymdBogota = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const addDays = (n) => ymdBogota(new Date(Date.now() + n * 86400000));
const oidOf = (v) => new mongoose.Types.ObjectId(sid(v));

describe('Requisiciones E4 fix round on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_e4f_${rnd()}`;
  let savedEmit;

  before(async () => {
    await mongoose.connect(URI, { dbName });
    for (const m of [Requisicion, Customer, User, Role, Tenant, ReglaAprobacion, Counter]) { await m.init(); await m.syncIndexes(); }
    savedEmit = notificationService.emit;
    notificationService.emit = async () => ({ dispatched: 0 });
    stubOutbound4();
  });

  after(async () => {
    notificationService.emit = savedEmit;
    await flushRequisicionNotifications();
    if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  });

  describe('B1: date-only delivery date', () => {
    it('today (YYYY-MM-DD) is accepted and stored as that Bogota calendar day; PDF and e-mail print the SAME day', async () => {
      const w = await mkAdjudicada();
      const hoy = ymdBogota();
      const out = await emitir(w, { fechaEntrega: hoy });
      assert.equal(out.estado, 'OC_Emitida');
      assert.equal(new Date(out.ordenCompra.fechaEntrega).toISOString(), `${hoy}T05:00:00.000Z`);
      await oc.aprobar(w.tenantId, w.reqId, w.approverActor, {}, CAPS);
      await envio.enviar(w.tenantId, w.reqId, w.issuerActor, CAPS);
      const fmt = (ymd) => new Date(`${ymd}T12:00:00-05:00`).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long' });
      assert.equal(out4.oc.at(-1).fechaEntrega, fmt(hoy));
      await pdf.generar(w.tenantId, w.reqId, { userId: w.issuerActor.userId, canRead: true, canSeePrices: true }, CAPS);
      assert.ok(out4.pdf.at(-1).includes(fmt(hoy)), 'the PDF shows the chosen day');
    });

    it('a future day keeps its day in the PDF; yesterday and impossible dates are 400', async () => {
      const w = await mkAdjudicada();
      const futuro = addDays(10);
      await emitir(w, { fechaEntrega: futuro });
      await pdf.generar(w.tenantId, w.reqId, { userId: w.issuerActor.userId, canRead: true, canSeePrices: true }, CAPS);
      const dia = new Date(`${futuro}T12:00:00-05:00`).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long' });
      assert.ok(out4.pdf.at(-1).includes(dia));
      const w2 = await mkAdjudicada();
      await expectApi(emitir(w2, { fechaEntrega: addDays(-1) }), 400, 'FECHA_ENTREGA_INVALIDA');
      await expectApi(emitir(w2, { fechaEntrega: '2027-02-30' }), 400, 'FECHA_ENTREGA_INVALIDA');
      assert.equal((await rawReq(w2.reqId)).estado, 'Adjudicada');
    });

    it('a full ISO timestamp is still accepted', async () => {
      const w = await mkAdjudicada();
      const out = await emitir(w, { fechaEntrega: new Date(Date.now() + 3 * 86400000).toISOString() });
      assert.equal(out.estado, 'OC_Emitida');
    });
  });

  describe('M1: excess without pending levels', () => {
    it('records OC_REAPROBACION_REQUERIDA with sinNivelesPendientes and stays in simple approval by approve-po', async () => {
      const w = await mkAdjudicada({ reglas: true });
      await Requisicion.collection.updateOne({ _id: oidOf(w.reqId) }, {
        $set: { 'aprobacion.niveles': [{ orden: 1, nombre: 'Nivel 1', reglaId: w.reglas[0]._id, aprobadorTipo: 'usuarios', estado: 'Aprobado', aprobadorIds: [], usuariosIds: [] }] },
      });
      const out = await emitir(w, { precios: [150000, 5000] }); // 500.000 > 451.000, only rule 1 applies and it was approved
      assert.equal(out.estado, 'OC_Emitida');
      assert.equal(out.ordenCompra.exceso.requerido, true);
      const ev = out.timeline.at(-1);
      assert.equal(ev.tipo, 'OC_REAPROBACION_REQUERIDA');
      assert.equal(ev.datos.sinNivelesPendientes, true);
      assert.equal(ev.datos.estimado, 410000);
      assert.equal(ev.datos.total, 500000);
      assert.equal(ev.datos.margenPct, 10);
      // approve-po is required for the simple path (requisiciones:approve alone is not enough)
      await expectApi(oc.aprobar(w.tenantId, w.reqId, { ...w.approverActor, canApprovePo: false }, {}, CAPS), 403, 'FORBIDDEN');
      assert.equal((await oc.aprobar(w.tenantId, w.reqId, w.approverActor, {}, CAPS)).estado, 'OC_Aprobada');
    });
  });

  describe('M2: level approvers and approve-po', () => {
    it('a level approver WITHOUT approve-po decides his level; a holder of approve-po who is not eligible cannot', async () => {
      const w = await mkAdjudicada({ reglas: true });
      await emitir(w, { precios: [1500000, 100000] });
      const noPo = { ...w.approverActor, canApprovePo: false };
      const stranger = actorOf(await mkRoleUser(w.tenantId, [PERMISSIONS.REQUISICIONES_APPROVE]), { canApprovePo: true });
      await expectApi(oc.aprobar(w.tenantId, w.reqId, stranger, {}, CAPS), 403, 'APROBADOR_NO_ELEGIBLE');
      const out = await oc.aprobar(w.tenantId, w.reqId, noPo, {}, CAPS);
      assert.equal(out.ordenCompra.aprobacion.nivelActual, 2);
    });

    it('the inbox lists the OC of a level approver without approve-po, and not the simple OC', async () => {
      const w = await mkAdjudicada({ reglas: true });
      await emitir(w, { precios: [1500000, 100000] });
      const list = (actor, canApprovePo) => reqService.list(w.tenantId, actor.userId, { vista: 'oc-por-aprobar' }, {}, { canApprovePo });
      assert.equal((await list(w.approverActor, false)).data.length, 1);
      assert.equal((await list(w.approver2Actor, false)).data.length, 0);
      const s = await mkAdjudicada();
      await emitir(s);
      assert.equal((await reqService.list(s.tenantId, s.approverActor.userId, { vista: 'oc-por-aprobar' }, {}, { canApprovePo: false })).data.length, 0);
      assert.equal((await reqService.list(s.tenantId, s.approverActor.userId, { vista: 'oc-por-aprobar' }, {}, { canApprovePo: true })).data.length, 1);
    });

    it('the detail opens without requisiciones:read for the eligible level approver and approve-po holders, never for a stranger', async () => {
      const w = await mkAdjudicada({ reglas: true });
      await emitir(w, { precios: [1500000, 100000] });
      const get = (uid, canApprovePo) => reqService.getById(w.tenantId, w.reqId, { userId: uid, canRead: false, canApprovePo });
      assert.equal((await get(w.approverActor.userId, false)).estado, 'OC_En_Reaprobacion');
      await expectApi(get(w.approver2Actor.userId, false), 404, 'REQUISICION_NOT_FOUND'); // level 2 is not his turn yet
      const stranger = await mkRoleUser(w.tenantId, [PERMISSIONS.REQUISICIONES_APPROVE_PO]);
      await expectApi(get(sid(stranger._id), true), 404, 'REQUISICION_NOT_FOUND'); // approve-po alone does not open a re-approval
      const s = await mkAdjudicada();
      await emitir(s);
      const open = await reqService.getById(s.tenantId, s.reqId, { userId: s.approverActor.userId, canRead: false, canApprovePo: true });
      assert.equal(open.estado, 'OC_Emitida');
      await expectApi(reqService.getById(s.tenantId, s.reqId, { userId: s.approverActor.userId, canRead: false, canApprovePo: false }), 404, 'REQUISICION_NOT_FOUND');
    });

    it('the PDF opens for a pending approver without read access', async () => {
      const s = await mkAdjudicada();
      await emitir(s);
      const out = await pdf.generar(s.tenantId, s.reqId, { userId: s.approverActor.userId, canRead: false, canSeePrices: true, canApprovePo: true }, CAPS);
      assert.ok(Buffer.isBuffer(out.buffer));
    });
  });

  describe('M4: the editor cannot decide the version he wrote', () => {
    it('records editadaPor and refuses approve / reject by the editor (403 SEPARACION_DE_FUNCIONES)', async () => {
      const w = await mkAdjudicada();
      await emitir(w);
      const editor = { ...w.approverActor, canManageAll: true };
      const edited = await oc.editar(w.tenantId, w.reqId, editor, await ocBody(w, { precios: [121000, 5000] }), CAPS);
      assert.equal(edited.ordenCompra.editadaPor.usuarioId, w.approverActor.userId);
      assert.equal((await rawReq(w.reqId)).ordenCompra.editadaPor.toString(), w.approverActor.userId);
      await expectApi(oc.aprobar(w.tenantId, w.reqId, editor, {}, CAPS), 403, 'SEPARACION_DE_FUNCIONES');
      await expectApi(oc.rechazar(w.tenantId, w.reqId, editor, { observacion: 'x' }, CAPS), 403, 'SEPARACION_DE_FUNCIONES');
      assert.equal((await rawReq(w.reqId)).estado, 'OC_Emitida');
      assert.equal((await oc.aprobar(w.tenantId, w.reqId, w.approver2Actor, {}, CAPS)).estado, 'OC_Aprobada');
    });

    it('the editor does not see the OC in his inbox', async () => {
      const w = await mkAdjudicada();
      await emitir(w);
      await oc.editar(w.tenantId, w.reqId, { ...w.approverActor, canManageAll: true }, await ocBody(w), CAPS);
      const inbox = (a) => reqService.list(w.tenantId, a.userId, { vista: 'oc-por-aprobar' }, {}, { canApprovePo: true });
      assert.equal((await inbox(w.approverActor)).data.length, 0);
      assert.equal((await inbox(w.approver2Actor)).data.length, 1);
    });
  });

  describe('M5: resend', () => {
    it('works in En_Recepcion too, records a MASKED recipient and rotates the link before mailing', async () => {
      const w = await mkAdjudicada();
      await llevarAOcEnviada(w);
      await Requisicion.collection.updateOne({ _id: oidOf(w.reqId) }, { $set: { estado: 'En_Recepcion' } });
      const hash0 = (await rawReq(w.reqId)).licitacion.proveedores[0].tokenHash;
      const out = await envio.reenviar(w.tenantId, w.reqId, w.issuerActor, {}, CAPS);
      assert.equal(out.ordenCompra.envio.estadoCorreo, 'Enviado');
      const ev = out.timeline.at(-1);
      assert.equal(ev.tipo, 'OC_REENVIADA');
      assert.match(ev.datos.destinatario, /^.{1,2}\*\*\*@/);
      assert.ok(!JSON.stringify(ev).includes(w.provider.Email.toLowerCase()));
      assert.notEqual((await rawReq(w.reqId)).licitacion.proveedores[0].tokenHash, hash0);
      for (const estado of ['Cerrada', 'Cancelada']) {
        await Requisicion.collection.updateOne({ _id: oidOf(w.reqId) }, { $set: { estado } });
        await expectApi(envio.reenviar(w.tenantId, w.reqId, w.issuerActor, {}, CAPS), 409, 'TRANSICION_INVALIDA');
      }
    });

    it('a lost compare-and-set sends NO e-mail (no dead link)', async () => {
      const w = await mkAdjudicada();
      await llevarAOcEnviada(w);
      const sentBefore = out4.oc.length;
      const realAppend = Requisicion.appendEvent;
      // somebody rotates the link between our read and our compare-and-set
      Requisicion.appendEvent = async function patched(...a) {
        await Requisicion.collection.updateOne({ _id: oidOf(w.reqId) }, { $set: { 'licitacion.proveedores.$[p].tokenHash': 'x'.repeat(64) } }, { arrayFilters: [{ 'p._id': { $exists: true } }] });
        return realAppend.apply(this, a);
      };
      try {
        await expectApi(envio.reenviar(w.tenantId, w.reqId, w.issuerActor, {}, CAPS), 409, 'CONFLICTO_CONCURRENTE');
      } finally {
        Requisicion.appendEvent = realAppend;
      }
      assert.equal(out4.oc.length, sentBefore);
    });

    it('winner without e-mail: enviar keeps the link (no rotation) and reenviar needs the override, allowed only with no address on file', async () => {
      const w = await mkAdjudicada();
      await Customer.collection.updateOne({ _id: w.provider._id }, { $unset: { Email: 1 } });
      await Requisicion.collection.updateOne({ _id: oidOf(w.reqId) }, { $unset: { 'licitacion.proveedores.0.correoEnvio': 1 } });
      await emitir(w);
      await oc.aprobar(w.tenantId, w.reqId, w.approverActor, {}, CAPS);
      const hash0 = (await rawReq(w.reqId)).licitacion.proveedores[0].tokenHash;
      const sent = await envio.enviar(w.tenantId, w.reqId, w.issuerActor, CAPS);
      assert.equal(sent.ordenCompra.envio.estadoCorreo, 'Sin_correo');
      assert.equal((await rawReq(w.reqId)).licitacion.proveedores[0].tokenHash, hash0, 'no mail attempted: the hash is not rotated');
      await expectApi(envio.reenviar(w.tenantId, w.reqId, w.issuerActor, {}, CAPS), 400, 'CORREO_INVALIDO');
      await expectApi(envio.reenviar(w.tenantId, w.reqId, { ...w.issuerActor, canIssuePo: true }, { correoEnvio: 'no-es-correo' }, CAPS), 400, 'CORREO_INVALIDO');
      await expectApi(envio.reenviar(w.tenantId, w.reqId, { ...w.issuerActor, canIssuePo: false }, { correoEnvio: 'ok@prov.co' }, CAPS), 403, 'CORREO_NO_PERMITIDO');
      const ok = await envio.reenviar(w.tenantId, w.reqId, { ...w.issuerActor, canIssuePo: true }, { correoEnvio: 'Ok@Prov.co' }, CAPS);
      assert.equal(ok.ordenCompra.envio.estadoCorreo, 'Enviado');
      assert.equal(out4.oc.at(-1).to, 'ok@prov.co');
      // once an address is on file the override is refused (403): nobody can redirect the price-bearing link
      await expectApi(envio.reenviar(w.tenantId, w.reqId, { ...w.issuerActor, canIssuePo: true }, { correoEnvio: 'otro@evil.co' }, CAPS), 403, 'CORREO_NO_PERMITIDO');
    });

    it('with an address on file any override is 403 and nothing is sent', async () => {
      const w = await mkAdjudicada();
      await llevarAOcEnviada(w);
      const n = out4.oc.length;
      await expectApi(envio.reenviar(w.tenantId, w.reqId, { ...w.issuerActor, canIssuePo: true, canManageAll: true }, { correoEnvio: 'evil@evil.co' }, CAPS), 403, 'CORREO_NO_PERMITIDO');
      assert.equal(out4.oc.length, n);
    });
  });
  describe('notifications', () => {
    it('recipients exclude deleted users', async () => {
      const w = await mkAdjudicada();
      const calls = [];
      notificationService.emit = async (t, ev, payload, opts) => { calls.push(opts.extraRecipientUserIds); return { dispatched: 0 }; };
      await User.collection.updateOne({ _id: w.approver2._id }, { $set: { isDeleted: true } });
      const req = { ...(await rawReq(w.reqId)), creadaPor: w.approver2._id };
      notifyRequisicion(w.tenantId, 'requisicion.po.approved', req, { issuerId: sid(w.approver._id) });
      await flushRequisicionNotifications();
      notificationService.emit = async () => ({ dispatched: 0 });
      const ids = calls.at(-1);
      assert.ok(ids.includes(sid(w.approver._id)));
      assert.ok(!ids.includes(sid(w.approver2._id)), 'a deleted user is not notified');
    });
  });
});
