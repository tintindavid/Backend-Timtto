/**
 * Requisiciones E4, block A (purchase order, re-approval, send, reception gate) against a REAL MongoDB (node:test).
 * SKIPPED unless MONGO_INTEGRATION_URI is set. Creates and DROPS its own database `req_e4a_<random>`.
 *
 *   mongod --dbpath <new empty dir> --port 27655 --bind_ip 127.0.0.1
 *   MONGO_INTEGRATION_URI=mongodb://127.0.0.1:27655 node --test tests/integration/requisicion.e4.ordenCompra.mongo.integration.test.js
 *
 * NEVER point it at a shared / remote / production database. E-mail, Firebase, PDF and notifications are stubbed.
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
import { requisicionRecepcionService } from '../../src/services/requisicionRecepcion.service.js';
import { requisicionService as reqService } from '../../src/services/requisicion.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { notificationService } from '../../src/services/notification.service.js';
import { hashToken } from '../../src/utils/requisicionToken.util.js';
import {
  CAPS, actorOf, emitir, expectApi, llevarAOcEnviada, mkAdjudicada, ocBody, out4, pricesFor, rawReq, rnd, sid, stubOutbound4, tomorrow,
} from '../helpers/requisicionE4World.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const snap = async (id) => JSON.stringify(await rawReq(id));
const year = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 4);

describe('Requisiciones E4 block A on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_e4a_${rnd()}`;
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

  describe('issue', () => {
    it('Adjudicada -> OC_Emitida in one write: number, server total, version 1, OC_EMITIDA event', async () => {
      const w = await mkAdjudicada();
      const out = await emitir(w);
      assert.equal(out.estado, 'OC_Emitida');
      const o = out.ordenCompra;
      assert.equal(o.numero, `OC-${year}-0001`);
      assert.equal(o.version, 1);
      assert.equal(o.estado, 'Emitida');
      assert.equal(o.total, 410000);
      assert.equal(o.moneda, 'COP');
      assert.equal(o.lineas.length, 2);
      assert.deepEqual(o.lineas.map((l) => [l.cantidad, l.precioUnitario, l.subtotal]), [[3, 120000, 360000], [10, 5000, 50000]]);
      assert.equal(o.exceso.requerido, false);
      assert.equal(o.emitidaPor.usuarioId, w.issuerActor.userId);
      assert.equal(o.requiereEntregables, false);
      assert.equal(o.entrega, null);
      assert.equal(o.aprobacion.nivelActual, null);
      assert.equal(out.timeline.at(-1).tipo, 'OC_EMITIDA');
      assert.equal(out.timeline.at(-1).datos.total, 410000);
      assert.ok(out.licitacion.proveedores.every((p) => p.tokenHash === undefined));
    });

    it('the yearly counter is atomic and per tenant; concurrent issues never repeat a number', async () => {
      const ws = await Promise.all([mkAdjudicada(), mkAdjudicada(), mkAdjudicada()]);
      const outs = await Promise.all(ws.map((w) => emitir(w)));
      const nums = outs.map((o) => o.ordenCompra.numero);
      assert.ok(nums.every((n) => n === `OC-${year}-0001`), 'each tenant has its own counter');
      const w = ws[0];
      const raw = await rawReq(w.reqId);
      assert.equal(raw.ordenCompra.numero, `OC-${year}-0001`);
      const c = await Counter.findOne({ tenantId: w.tenantId, key: `ordenes-compra:${year}` }).lean();
      assert.equal(c.seq, 1);
    });

    it('same tenant: consecutive numbers 0001, 0002 even issued in parallel', async () => {
      const a = await mkAdjudicada();
      // second awarded requisition of the SAME tenant
      const { Requisicion: R } = await import('../../src/models/requisicion.model.js');
      const base = await rawReq(a.reqId);
      const clone = { ...base, _id: new mongoose.Types.ObjectId(), consecutivo: `REQ-X-${rnd()}`, estado: 'Adjudicada' };
      delete clone.ordenCompra;
      await R.collection.insertOne(clone);
      const b = { ...a, reqId: sid(clone._id) };
      const [x, y] = await Promise.all([emitir(a), emitir(b)]);
      assert.deepEqual([x.ordenCompra.numero, y.ordenCompra.numero].sort(), [`OC-${year}-0001`, `OC-${year}-0002`]);
    });

    it('validation errors are 4xx and change nothing', async () => {
      const w = await mkAdjudicada();
      const before = await snap(w.reqId);
      const full = await ocBody(w);
      const call = (body) => oc.emitir(w.tenantId, w.reqId, w.issuerActor, body, CAPS);
      await expectApi(call({ ...full, lineas: [full.lineas[0]] }), 400, 'PRECIO_FALTANTE');
      await expectApi(call({ ...full, lineas: [full.lineas[0], { ...full.lineas[1], precioUnitario: -1 }] }), 400, 'PRECIO_INVALIDO');
      await expectApi(call({ ...full, lineas: [full.lineas[0], { ...full.lineas[1], precioUnitario: 'abc' }] }), 400, 'PRECIO_INVALIDO');
      await expectApi(call({ ...full, lineas: [full.lineas[0], { ...full.lineas[1], precioUnitario: NaN }] }), 400, 'PRECIO_INVALIDO');
      await expectApi(call({ ...full, lineas: [...full.lineas, { lineaId: sid(new mongoose.Types.ObjectId()), precioUnitario: 1 }] }), 400, 'LINEA_NO_ENCONTRADA');
      await expectApi(call({ ...full, lineas: [...full.lineas, full.lineas[0]] }), 400, 'LINEA_REPETIDA');
      await expectApi(call({ ...full, fechaEntrega: '2020-01-01' }), 400, 'FECHA_ENTREGA_INVALIDA');
      await expectApi(call({ ...full, fechaEntrega: 'nope' }), 400, 'FECHA_ENTREGA_INVALIDA');
      await expectApi(call({ ...full, requiereEntregables: 'si' }), 400, 'REQUIERE_ENTREGABLES_INVALIDO');
      assert.equal(await snap(w.reqId), before);
      assert.equal(await Counter.countDocuments({ tenantId: w.tenantId, key: `ordenes-compra:${year}` }), 0, 'no number consumed by invalid requests');
    });

    it('state other than Adjudicada is 409 TRANSICION_INVALIDA; another tenant is 404', async () => {
      const w = await mkAdjudicada();
      await emitir(w);
      await expectApi(emitir(w), 409, 'TRANSICION_INVALIDA');
      const w2 = await mkAdjudicada();
      await expectApi(oc.emitir(w2.tenantId, w.reqId, w2.issuerActor, await ocBody(w), CAPS), 404, 'REQUISICION_NOT_FOUND');
      await expectApi(oc.emitir(w.tenantId, w.reqId, w.issuerActor, await ocBody(w), { usesRequisiciones: false }), 403);
    });
  });

  describe('excess and re-approval', () => {
    it('exactly at the margin is NOT excess; one cent above is', async () => {
      const w = await mkAdjudicada({ reglas: true });
      const ok = await emitir(w, { precios: [120000, 9100] }); // 451.000 = 410.000 x 1.10
      assert.equal(ok.estado, 'OC_Emitida');
      assert.equal(ok.ordenCompra.exceso.requerido, false);
      assert.equal(ok.ordenCompra.exceso.margenPct, 10);
      const w2 = await mkAdjudicada({ reglas: true });
      const over = await emitir(w2, { precios: [120000, 9100.1] }); // 451.001
      assert.equal(over.estado, 'OC_En_Reaprobacion');
      assert.equal(over.ordenCompra.exceso.requerido, true);
      assert.equal(over.ordenCompra.exceso.estimado, 410000);
      assert.equal(over.ordenCompra.exceso.total, 451001);
      assert.deepEqual(over.timeline.slice(-2).map((e) => e.tipo), ['OC_EMITIDA', 'OC_REAPROBACION_REQUERIDA']);
      assert.equal(over.timeline.at(-1).datos.margenPct, 10);
      assert.equal(over.ordenCompra.aprobacion.niveles.length, 1, 'only the rules applicable to the REAL total');
      assert.equal(over.ordenCompra.aprobacion.nivelActual, 1);
    });

    it('the tenant margin setting is honoured (0 % and 50 %)', async () => {
      const w = await mkAdjudicada({ reglas: true });
      await Tenant.collection.updateOne({ tenantId: w.tenantId }, { $set: { 'requisiciones.margenReaprobacionOcPct': 0 } });
      const over = await emitir(w, { precios: [120000, 5000.1] }); // +1 cent over 0 %
      assert.equal(over.estado, 'OC_En_Reaprobacion');
      assert.equal(over.ordenCompra.exceso.margenPct, 0);
      const w2 = await mkAdjudicada({ reglas: true });
      await Tenant.collection.updateOne({ tenantId: w2.tenantId }, { $set: { 'requisiciones.margenReaprobacionOcPct': 50 } });
      const inside = await emitir(w2, { precios: [120000, 18500] }); // 545.000 <= 615.000
      assert.equal(inside.estado, 'OC_Emitida');
    });

    it('estimate 0 ("Sin estimar") always needs re-approval, by the rules for the real total', async () => {
      const w = await mkAdjudicada({ reglas: true, estimado: 0 });
      const out = await emitir(w, { precios: [1, 1] });
      assert.equal(out.estado, 'OC_En_Reaprobacion');
      assert.equal(out.ordenCompra.exceso.estimado, 0);
      assert.equal(out.ordenCompra.aprobacion.niveles.length, 1);
    });

    it('no applicable rules: 422 SIN_REGLAS_APROBACION, the state is untouched and no number is consumed', async () => {
      const w = await mkAdjudicada({ reglas: false });
      const before = await snap(w.reqId);
      await expectApi(emitir(w, { precios: [999999, 5000] }), 422, 'SIN_REGLAS_APROBACION');
      assert.equal(await snap(w.reqId), before);
      assert.equal((await rawReq(w.reqId)).estado, 'Adjudicada');
      assert.equal(await Counter.countDocuments({ tenantId: w.tenantId, key: `ordenes-compra:${year}` }), 0);
    });

    it('full re-approval: sequential levels, issuer refused, nobody decides two levels, last level -> OC_Aprobada', async () => {
      const w = await mkAdjudicada({ reglas: true });
      const out = await emitir(w, { precios: [1500000, 100000] }); // 5.500.000 -> three levels
      assert.equal(out.estado, 'OC_En_Reaprobacion');
      assert.deepEqual(out.ordenCompra.aprobacion.niveles.map((n) => n.orden), [1, 2, 3]);
      const before = await snap(w.reqId);
      await expectApi(oc.aprobar(w.tenantId, w.reqId, w.issuerActor, {}, CAPS), 403, 'SEPARACION_DE_FUNCIONES');
      await expectApi(oc.aprobar(w.tenantId, w.reqId, w.approver2Actor, {}, CAPS), 403, 'APROBADOR_NO_ELEGIBLE');
      assert.equal(await snap(w.reqId), before);

      const l1 = await oc.aprobar(w.tenantId, w.reqId, w.approverActor, {}, CAPS);
      assert.equal(l1.estado, 'OC_En_Reaprobacion');
      assert.equal(l1.ordenCompra.aprobacion.nivelActual, 2);
      await expectApi(oc.aprobar(w.tenantId, w.reqId, w.approverActor, {}, CAPS), 403); // not eligible for level 2 (and decided level 1)
      const l2 = await oc.aprobar(w.tenantId, w.reqId, w.approver2Actor, {}, CAPS);
      assert.equal(l2.ordenCompra.aprobacion.nivelActual, 3);
      const l3 = await oc.aprobar(w.tenantId, w.reqId, w.approver3Actor, {}, CAPS);
      assert.equal(l3.estado, 'OC_Aprobada');
      assert.equal(l3.ordenCompra.estado, 'Aprobada');
      assert.equal(l3.ordenCompra.aprobacion.nivelActual, null);
      assert.ok(l3.ordenCompra.aprobacion.niveles.every((n) => n.estado === 'Aprobado'));
      assert.equal(l3.ordenCompra.aprobadaPor.usuarioId, w.approver3Actor.userId);
      assert.equal(l3.timeline.filter((e) => e.tipo === 'NIVEL_APROBADO').length, 3);
      assert.equal(l3.timeline.at(-1).tipo, 'OC_APROBADA');
    });

    it('levels already approved in the original approval are not asked again', async () => {
      const w = await mkAdjudicada({ reglas: true });
      await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(w.reqId) }, {
        $set: { 'aprobacion.niveles': [{ orden: 1, nombre: 'Nivel 1', reglaId: w.reglas[0]._id, aprobadorTipo: 'usuarios', estado: 'Aprobado', aprobadorIds: [], usuariosIds: [] }] },
      });
      const out = await emitir(w, { precios: [600000, 5000] }); // 1.85M -> rules 1 and 2 apply, 1 was approved
      assert.equal(out.estado, 'OC_En_Reaprobacion');
      assert.deepEqual(out.ordenCompra.aprobacion.niveles.map((n) => n.orden), [2]);
    });

    it('rules applicable but all already approved: simple approval by approve-po (documented fallback)', async () => {
      const w = await mkAdjudicada({ reglas: true });
      await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(w.reqId) }, {
        $set: { 'aprobacion.niveles': [{ orden: 1, nombre: 'Nivel 1', reglaId: w.reglas[0]._id, aprobadorTipo: 'usuarios', estado: 'Aprobado', aprobadorIds: [], usuariosIds: [] }] },
      });
      const out = await emitir(w, { precios: [130000, 5000] }); // 440.000 > 410.000 x 1.1? no -> inside margin
      assert.equal(out.estado, 'OC_Emitida');
      const w2 = await mkAdjudicada({ reglas: true });
      await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(w2.reqId) }, {
        $set: { 'aprobacion.niveles': [{ orden: 1, nombre: 'Nivel 1', reglaId: w2.reglas[0]._id, aprobadorTipo: 'usuarios', estado: 'Aprobado', aprobadorIds: [], usuariosIds: [] }] },
      });
      const over = await emitir(w2, { precios: [150000, 5000] }); // 500.000: excess, only rule 1 applies and it was approved
      assert.equal(over.estado, 'OC_Emitida');
      assert.equal(over.ordenCompra.exceso.requerido, true);
      assert.equal(over.ordenCompra.aprobacion.niveles.length, 0);
      const approved = await oc.aprobar(w2.tenantId, w2.reqId, w2.approverActor, {}, CAPS);
      assert.equal(approved.estado, 'OC_Aprobada');
    });
  });

  describe('edit, approve and reject', () => {
    it('simple approval by someone other than the issuer; the issuer gets 403 SEPARACION_DE_FUNCIONES', async () => {
      const w = await mkAdjudicada();
      await emitir(w);
      const before = await snap(w.reqId);
      await expectApi(oc.aprobar(w.tenantId, w.reqId, w.issuerActor, {}, CAPS), 403, 'SEPARACION_DE_FUNCIONES');
      await expectApi(oc.rechazar(w.tenantId, w.reqId, w.issuerActor, { observacion: 'no' }, CAPS), 403, 'SEPARACION_DE_FUNCIONES');
      assert.equal(await snap(w.reqId), before);
      const out = await oc.aprobar(w.tenantId, w.reqId, w.approverActor, { version: 1 }, CAPS);
      assert.equal(out.estado, 'OC_Aprobada');
      assert.equal(out.ordenCompra.estado, 'Aprobada');
      assert.equal(out.timeline.at(-1).tipo, 'OC_APROBADA');
      await expectApi(oc.aprobar(w.tenantId, w.reqId, w.approver2Actor, {}, CAPS), 409, 'TRANSICION_INVALIDA');
    });

    it('a stale version is 409 VERSION_DESACTUALIZADA and does not approve', async () => {
      const w = await mkAdjudicada();
      await emitir(w);
      await oc.editar(w.tenantId, w.reqId, w.issuerActor, await ocBody(w, { precios: [121000, 5000] }), CAPS);
      await expectApi(oc.aprobar(w.tenantId, w.reqId, w.approverActor, { version: 1 }, CAPS), 409, 'VERSION_DESACTUALIZADA');
      assert.equal((await rawReq(w.reqId)).estado, 'OC_Emitida');
    });

    it('two simultaneous approvals: exactly one wins, the other is 409 CONFLICTO_CONCURRENTE', async () => {
      for (let i = 0; i < 5; i += 1) {
        const w = await mkAdjudicada();
        await emitir(w);
        const res = await Promise.allSettled([
          oc.aprobar(w.tenantId, w.reqId, w.approverActor, {}, CAPS),
          oc.aprobar(w.tenantId, w.reqId, w.approver2Actor, {}, CAPS),
        ]);
        assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
        const failed = res.find((r) => r.status === 'rejected');
        assert.equal(failed.reason.statusCode, 409);
        assert.ok(['CONFLICTO_CONCURRENTE', 'TRANSICION_INVALIDA'].includes(failed.reason.code));
        const raw = await rawReq(w.reqId);
        assert.equal(raw.timeline.filter((e) => e.tipo === 'OC_APROBADA').length, 1);
      }
    });

    it('edit: issuer (or manage-all) in OC_Emitida only; bumps version; keeps the number', async () => {
      const w = await mkAdjudicada();
      const issued = await emitir(w);
      await expectApi(oc.editar(w.tenantId, w.reqId, w.approverActor, await ocBody(w), CAPS), 403, 'SOLO_EMISOR');
      const edited = await oc.editar(w.tenantId, w.reqId, w.issuerActor, await ocBody(w, { precios: [121000, 5000], condiciones: 'Nuevas' }), CAPS);
      assert.equal(edited.ordenCompra.version, 2);
      assert.equal(edited.ordenCompra.numero, issued.ordenCompra.numero);
      assert.equal(edited.ordenCompra.total, 413000);
      assert.equal(edited.ordenCompra.condiciones, 'Nuevas');
      assert.equal(edited.timeline.at(-1).tipo, 'OC_EDITADA');
      const byAdmin = await oc.editar(w.tenantId, w.reqId, { ...w.approverActor, canManageAll: true }, await ocBody(w), CAPS);
      assert.equal(byAdmin.ordenCompra.version, 3);
      assert.equal(byAdmin.ordenCompra.emitidaPor.usuarioId, w.issuerActor.userId, 'the issuer does not change');
      await oc.aprobar(w.tenantId, w.reqId, w.approver2Actor, {}, CAPS);
      const before = await snap(w.reqId);
      await expectApi(oc.editar(w.tenantId, w.reqId, w.issuerActor, await ocBody(w), CAPS), 409, 'TRANSICION_INVALIDA');
      assert.equal(await snap(w.reqId), before);
    });

    it('rejecting needs an observation (400); OC_Emitida -> Adjudicada; re-issue keeps the number with version + 1', async () => {
      const w = await mkAdjudicada();
      const issued = await emitir(w);
      const before = await snap(w.reqId);
      await expectApi(oc.rechazar(w.tenantId, w.reqId, w.approverActor, { observacion: '   ' }, CAPS), 400, 'OBSERVACION_REQUERIDA');
      assert.equal(await snap(w.reqId), before);
      const rej = await oc.rechazar(w.tenantId, w.reqId, w.approverActor, { observacion: 'Precio alto' }, CAPS);
      assert.equal(rej.estado, 'Adjudicada');
      assert.equal(rej.timeline.at(-1).tipo, 'OC_RECHAZADA');
      assert.equal(rej.timeline.at(-1).observacion, 'Precio alto');
      const again = await emitir(w, { precios: [100000, 5000] });
      assert.equal(again.estado, 'OC_Emitida');
      assert.equal(again.ordenCompra.numero, issued.ordenCompra.numero);
      assert.equal(again.ordenCompra.version, 2);
      assert.equal(again.ordenCompra.total, 350000);
      assert.equal(await Counter.findOne({ tenantId: w.tenantId, key: `ordenes-compra:${year}` }).then((c) => c.seq), 1);
    });

    it('rejecting a re-approval level returns to OC_Emitida; it cannot be approved until the issuer edits it', async () => {
      const w = await mkAdjudicada({ reglas: true });
      await emitir(w, { precios: [1500000, 100000] });
      const rej = await oc.rechazar(w.tenantId, w.reqId, w.approverActor, { observacion: 'Sin soporte' }, CAPS);
      assert.equal(rej.estado, 'OC_Emitida');
      assert.equal(rej.ordenCompra.estado, 'Emitida');
      assert.equal(rej.ordenCompra.aprobacion.niveles[0].estado, 'Rechazado');
      assert.ok(rej.ordenCompra.aprobacion.niveles.slice(1).every((n) => n.estado === 'Cancelado'));
      assert.deepEqual(rej.timeline.slice(-2).map((e) => e.tipo), ['NIVEL_RECHAZADO', 'OC_RECHAZADA']);
      await expectApi(oc.aprobar(w.tenantId, w.reqId, w.approverActor, {}, CAPS), 409, 'OC_REQUIERE_REAPROBACION');
      const edited = await oc.editar(w.tenantId, w.reqId, w.issuerActor, await ocBody(w, { precios: [1400000, 100000] }), CAPS);
      assert.equal(edited.estado, 'OC_En_Reaprobacion');
      assert.equal(edited.ordenCompra.version, 2);
      assert.equal(edited.ordenCompra.aprobacion.niveles.every((n) => n.estado === 'Pendiente'), true);
    });

    it('cancelling a requisition in re-approval cancels the pending levels', async () => {
      const w = await mkAdjudicada({ reglas: true });
      await emitir(w, { precios: [1500000, 100000] });
      const out = await reqService.cancelar(w.tenantId, w.reqId, w.issuerActor, { motivo: 'ya no se necesita' });
      assert.equal(out.estado, 'Cancelada');
      assert.ok(out.ordenCompra.aprobacion.niveles.every((n) => n.estado === 'Cancelado'));
      assert.equal(out.ordenCompra.aprobacion.nivelActual, null);
    });
  });

  describe('send', () => {
    it('OC_Aprobada -> OC_Enviada, then the e-mail with the portal link; the winner link has no expiry and only the hash is stored', async () => {
      const w = await mkAdjudicada();
      await emitir(w, { requiereEntregables: true });
      await oc.aprobar(w.tenantId, w.reqId, w.approverActor, {}, CAPS);
      const sent = await envio.enviar(w.tenantId, w.reqId, w.issuerActor, CAPS);
      assert.equal(sent.estado, 'OC_Enviada');
      assert.equal(sent.ordenCompra.estado, 'Enviada');
      assert.ok(sent.ordenCompra.envio.enviadaEn);
      assert.equal(sent.ordenCompra.envio.estadoCorreo, 'Enviado');
      assert.equal(sent.ordenCompra.entrega.estado, 'Pendiente');
      assert.equal(sent.timeline.at(-1).tipo, 'OC_ENVIADA');
      assert.equal(out4.oc.length, 1);
      assert.equal(out4.oc[0].to, w.provider.Email.toLowerCase());
      assert.equal(out4.oc[0].ocNumero, sent.ordenCompra.numero);
      const token = out4.oc[0].portalUrl.split('/public/requisicion/')[1];
      const raw = await rawReq(w.reqId);
      const entry = raw.licitacion.proveedores.find((p) => String(p._id) === String(raw.licitacion.ganadorId));
      assert.equal(entry.tokenHash, hashToken(token));
      assert.equal(entry.tokenVence, null);
      assert.ok(!JSON.stringify(raw).includes(token), 'the clear token is never stored');
      assert.ok(!JSON.stringify(sent).includes(token));
    });

    it('a failing e-mail does not roll the state back; resend works and rotates the link only when it went out', async () => {
      const w = await mkAdjudicada();
      await emitir(w);
      await oc.aprobar(w.tenantId, w.reqId, w.approverActor, {}, CAPS);
      out4.failOcEmail = true;
      const sent = await envio.enviar(w.tenantId, w.reqId, w.issuerActor, CAPS);
      out4.failOcEmail = false;
      assert.equal(sent.estado, 'OC_Enviada');
      assert.equal(sent.ordenCompra.envio.estadoCorreo, 'Fallido');
      const hash0 = (await rawReq(w.reqId)).licitacion.proveedores[0].tokenHash;
      out4.failOcEmail = true;
      const still = await envio.reenviar(w.tenantId, w.reqId, w.issuerActor, {}, CAPS);
      out4.failOcEmail = false;
      assert.equal(still.ordenCompra.envio.estadoCorreo, 'Fallido');
      // the compare-and-set runs BEFORE the mail: the stored link is already the new one and a later resend fixes the mail
      assert.notEqual((await rawReq(w.reqId)).licitacion.proveedores[0].tokenHash, hash0);
      const ok = await envio.reenviar(w.tenantId, w.reqId, w.issuerActor, {}, CAPS);
      assert.equal(ok.ordenCompra.envio.estadoCorreo, 'Enviado');
      assert.equal(ok.timeline.at(-1).tipo, 'OC_REENVIADA');
      assert.notEqual((await rawReq(w.reqId)).licitacion.proveedores[0].tokenHash, hash0);
    });

    it('sending outside OC_Aprobada is 409; notifications disabled is 409 and changes nothing', async () => {
      const w = await mkAdjudicada();
      await emitir(w);
      await expectApi(envio.enviar(w.tenantId, w.reqId, w.issuerActor, CAPS), 409, 'TRANSICION_INVALIDA');
      await oc.aprobar(w.tenantId, w.reqId, w.approverActor, {}, CAPS);
      const saved = envio.deps.envio;
      envio.deps.envio = { NOTIFICATIONS_ENABLED: false, NODE_ENV: 'test' };
      const before = await snap(w.reqId);
      await expectApi(envio.enviar(w.tenantId, w.reqId, w.issuerActor, CAPS), 409, 'NOTIFICACIONES_DESACTIVADAS');
      envio.deps.envio = { NOTIFICATIONS_ENABLED: true, NODE_ENV: 'production', PUBLIC_APP_URL: 'http://localhost:5173' };
      await expectApi(envio.enviar(w.tenantId, w.reqId, w.issuerActor, CAPS), 409, 'PUBLIC_APP_URL_NO_CONFIGURADA');
      envio.deps.envio = saved;
      assert.equal(await snap(w.reqId), before);
      await expectApi(envio.reenviar(w.tenantId, w.reqId, w.issuerActor, {}, CAPS), 409, 'TRANSICION_INVALIDA');
    });
  });

  describe('reception gate', () => {
    const recibir = (w, lineaId) => requisicionRecepcionService.registrar(w.tenantId, w.reqId, { userId: w.issuerActor.userId, name: 'x' }, { items: [{ lineaId, cantidadRecibida: 1 }] }, [], CAPS);

    it('Adjudicada / OC_Emitida / OC_En_Reaprobacion / OC_Aprobada: 409 OC_REQUERIDA and no reception; OC_Enviada -> En_Recepcion', async () => {
      const w = await mkAdjudicada({ reglas: true });
      const lineaId = sid((await rawReq(w.reqId)).lineas[0].lineaId);
      await expectApi(recibir(w, lineaId), 409, 'OC_REQUERIDA');
      await emitir(w);
      await expectApi(recibir(w, lineaId), 409, 'OC_REQUERIDA');
      await oc.aprobar(w.tenantId, w.reqId, w.approverActor, {}, CAPS);
      await expectApi(recibir(w, lineaId), 409, 'OC_REQUERIDA');
      const w2 = await mkAdjudicada({ reglas: true });
      await emitir(w2, { precios: [1500000, 100000] });
      await expectApi(recibir(w2, sid((await rawReq(w2.reqId)).lineas[0].lineaId)), 409, 'OC_REQUERIDA');
      assert.equal((await rawReq(w.reqId)).recepciones?.length ?? 0, 0);
      await envio.enviar(w.tenantId, w.reqId, w.issuerActor, CAPS);
      const out = await recibir(w, lineaId);
      assert.equal(out.estado, 'En_Recepcion');
      assert.equal(out.recepciones.length, 1);
    });

    it('the "por-recibir" view lists OC_Enviada, never Adjudicada', async () => {
      const w = await mkAdjudicada();
      const list = (s) => reqService.list(w.tenantId, w.issuerActor.userId, { vista: 'por-recibir', estado: s }, {}, { canReceive: true, canManageAll: false });
      assert.equal((await list('Adjudicada')).data.length, 0);
      await llevarAOcEnviada(w);
      assert.equal((await list('OC_Enviada')).data.length, 1);
    });
  });

  describe('inbox "oc-por-aprobar"', () => {
    it('lists the OC the caller can decide: other issuers in OC_Emitida, the current re-approval level', async () => {
      const w = await mkAdjudicada({ reglas: true });
      await emitir(w);
      const list = (actor, canApprovePo = true) => reqService.list(w.tenantId, actor.userId, { vista: 'oc-por-aprobar' }, {}, { canApprovePo });
      assert.equal((await list(w.approverActor)).data.length, 1);
      assert.equal((await list(w.issuerActor)).data.length, 0, 'the issuer never sees his own');
      assert.equal((await list(w.approverActor, false)).data.length, 0, 'needs approve-po');
      const w2 = await mkAdjudicada({ reglas: true });
      await emitir(w2, { precios: [1500000, 100000] });
      const l2 = (actor) => reqService.list(w2.tenantId, actor.userId, { vista: 'oc-por-aprobar' }, {}, { canApprovePo: true });
      assert.equal((await l2(w2.approverActor)).data.length, 1, 'level 1 approver');
      assert.equal((await l2(w2.approver2Actor)).data.length, 0, 'level 2 approver waits his turn');
      await oc.aprobar(w2.tenantId, w2.reqId, w2.approverActor, {}, CAPS);
      assert.equal((await l2(w2.approver2Actor)).data.length, 1);
      assert.equal((await l2(w2.approverActor)).data.length, 0);
    });
  });

  describe('PDF', () => {
    it('renders on demand with escaped data, no approval data; 502 PDF_NO_DISPONIBLE changes nothing', async () => {
      const w = await mkAdjudicada();
      await emitir(w, { condiciones: '<script>alert(1)</script> & "x"' });
      const access = { userId: w.issuerActor.userId, canRead: true, canSeePrices: true };
      const out = await pdf.generar(w.tenantId, w.reqId, access, CAPS);
      assert.ok(Buffer.isBuffer(out.buffer));
      assert.match(out.filename, /^OC-\d{4}-0001-v1\.pdf$/);
      const html = out4.pdf.at(-1);
      assert.ok(!html.includes('<script>alert(1)</script>'));
      assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;'));
      assert.ok(html.includes('OC-'));
      assert.ok(!/aprobaci/i.test(html.replace(/<style[\s\S]*?<\/style>/, '')), 'no internal approval data');
      const before = await snap(w.reqId);
      out4.pdfFails = true;
      await expectApi(pdf.generar(w.tenantId, w.reqId, access, CAPS), 502, 'PDF_NO_DISPONIBLE');
      out4.pdfFails = false;
      assert.equal(await snap(w.reqId), before);
    });

    it('access: no OC -> 404; a reader without participation -> 404; without price access -> 403', async () => {
      const w = await mkAdjudicada();
      await expectApi(pdf.generar(w.tenantId, w.reqId, { userId: w.issuerActor.userId, canRead: true, canSeePrices: true }, CAPS), 404, 'ORDEN_COMPRA_NOT_FOUND');
      await emitir(w);
      const stranger = await (await import('../helpers/requisicionE3World.js')).mkUser(w.tenantId);
      await expectApi(pdf.generar(w.tenantId, w.reqId, { userId: sid(stranger._id), canRead: false, canSeePrices: true }, CAPS), 404, 'REQUISICION_NOT_FOUND');
      await expectApi(pdf.generar(w.tenantId, w.reqId, { userId: sid(stranger._id), canRead: true, canSeePrices: false }, CAPS), 403);
      const w2 = await mkAdjudicada();
      await expectApi(pdf.generar(w2.tenantId, w.reqId, { userId: w2.issuerActor.userId, canRead: true, canSeePrices: true }, CAPS), 404, 'REQUISICION_NOT_FOUND');
    });
  });

  describe('write guards of the model', () => {
    it('the OC block is written only by the services: generic $set, $unset, $inc, save() and pipelines are refused', async () => {
      const w = await mkAdjudicada();
      await emitir(w);
      const id = new mongoose.Types.ObjectId(w.reqId);
      const upd = (u, o) => Requisicion.updateOne({ _id: id, tenantId: w.tenantId }, u, o);
      await expectApi(upd({ $set: { ordenCompra: { numero: 'X' } } }), 409, 'ORDEN_COMPRA_INMUTABLE');
      await expectApi(upd({ ordenCompra: { numero: 'X' } }), 409, 'ORDEN_COMPRA_INMUTABLE');
      await expectApi(upd({ $set: { 'ordenCompra.numero': 'OC-9' } }), 409, 'ORDEN_COMPRA_INMUTABLE');
      await expectApi(upd({ $set: { 'ordenCompra.entrega.archivos': [] } }), 409, 'ORDEN_COMPRA_INMUTABLE');
      await expectApi(upd({ $unset: { ordenCompra: 1 } }), 409, 'ORDEN_COMPRA_INMUTABLE');
      await expectApi(upd({ $inc: { 'ordenCompra.version': 1 } }), 409, 'ORDEN_COMPRA_INMUTABLE');
      await expectApi(upd({ $push: { 'ordenCompra.lineas': {} } }), 409, 'ORDEN_COMPRA_INMUTABLE');
      await expectApi(upd({ $rename: { ordenCompra: 'x' } }), 409, 'ORDEN_COMPRA_INMUTABLE');
      const doc = await Requisicion.findOne({ _id: id, tenantId: w.tenantId });
      doc.ordenCompra.total = 1;
      await expectApi(doc.save(), 409, 'ORDEN_COMPRA_INMUTABLE');
      const { licitacion: _l, ...rest } = await rawReq(w.reqId);
      const fresh = new Requisicion({ ...rest, _id: new mongoose.Types.ObjectId(), consecutivo: `X-${rnd()}` });
      await expectApi(fresh.save(), 409, 'ORDEN_COMPRA_INMUTABLE');
      assert.equal((await rawReq(w.reqId)).ordenCompra.total, 410000);
    });

    it('the generic edit payload cannot carry ordenCompra', async () => {
      const { updateRequisicionDto } = await import('../../src/dtos/requisicion.dto.js');
      const { error } = updateRequisicionDto.validate({ titulo: 'x', ordenCompra: { total: 1 } });
      assert.ok(error);
    });
  });

  describe('visibility of prices', () => {
    it('viewers without access to purchasing get the state but no prices (router-level filter)', async () => {
      const w = await mkAdjudicada();
      const issued = await emitir(w);
      const { redactQuotesFor } = await import('../../src/utils/requisicionQuoteVisibility.util.js');
      const plainUser = { userId: sid(new mongoose.Types.ObjectId()), permissions: ['requisiciones:read'] };
      const red = redactQuotesFor(issued, plainUser);
      assert.equal(red.ordenCompra.total, null);
      assert.ok(red.ordenCompra.lineas.every((l) => l.precioUnitario === null && l.subtotal === null));
      assert.equal(red.ordenCompra.estado, 'Emitida');
      assert.equal(red.ordenCompra.numero, issued.ordenCompra.numero);
      assert.ok(red.timeline.filter((e) => e.tipo.startsWith('OC_')).every((e) => e.datos.total === undefined));
      assert.equal(redactQuotesFor(issued, { ...plainUser, permissions: ['requisiciones:approve-po'] }).ordenCompra.total, 410000);
      assert.equal(redactQuotesFor(issued, { ...plainUser, userId: sid(issued.creadaPor._id) }).ordenCompra.total, 410000);
    });
  });

  void actorOf; void pricesFor; void tomorrow; void llevarAOcEnviada;
});
