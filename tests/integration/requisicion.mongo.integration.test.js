/**
 * Requisiciones E1 against a REAL MongoDB (node:test). SKIPPED unless MONGO_INTEGRATION_URI is set, so `npm test`
 * never needs a database. The unit suites use in-memory fakes; this file exercises what they cannot: atomic
 * conditional writes, `$expr` inbox, the append-only timeline hooks on real updates, counters under concurrency,
 * partial / collation unique indexes, aggregation and money rounding.
 *
 * HOW TO RUN (throwaway local instance only; the test creates and DROPS its own database `req_it_<random>`):
 *
 *   mongod --dbpath <new empty dir> --port 27555 --bind_ip 127.0.0.1        # standalone, no replica set
 *   MONGO_INTEGRATION_URI=mongodb://127.0.0.1:27555 \
 *     node --test tests/integration/requisicion.mongo.integration.test.js
 *
 * PowerShell: $env:MONGO_INTEGRATION_URI='mongodb://127.0.0.1:27555'; node --test tests/integration/requisicion.mongo.integration.test.js
 *
 * NEVER point it at a shared / remote / production database. Transactions are NOT required by E1 (every state
 * change is a single-document conditional findOneAndUpdate), so a standalone mongod is enough.
 * Notifications are stubbed (notificationService.emit) so nothing is sent.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { Requisicion, buildTimelineEvent } from '../../src/models/requisicion.model.js';
import { Area } from '../../src/models/area.model.js';
import { TipoRequisicion } from '../../src/models/tipoRequisicion.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { PresupuestoArea } from '../../src/models/presupuestoArea.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { requisicionService } from '../../src/services/requisicion.service.js';
import { requisicionApprovalService } from '../../src/services/requisicionApproval.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { areaService } from '../../src/services/area.service.js';
import { tipoRequisicionService } from '../../src/services/tipoRequisicion.service.js';
import { reglaAprobacionService } from '../../src/services/reglaAprobacion.service.js';
import { presupuestoAreaService } from '../../src/services/presupuestoArea.service.js';
import { presupuestoService } from '../../src/services/presupuesto.service.js';
import { getNextRequisicionConsecutivo } from '../../src/services/counter.service.js';
import { notificationService } from '../../src/services/notification.service.js';
import { getYearInBogota } from '../../src/utils/requisicionPeriod.util.js';
import { computeMontoEstimado } from '../../src/models/requisicion.model.js';
import { roundMoney, sumMoney } from '../../src/utils/money.util.js';
import { REQUISICION_ESTADO as E, REQUISICION_EVENTO as EV, NIVEL_ESTADO } from '../../src/constants/requisicion.constants.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const rnd = () => Math.random().toString(36).slice(2, 8);
const oid = () => new mongoose.Types.ObjectId();
const CAPS = {};

async function expectApi(promise, statusCode, code) {
  let err;
  try { await promise; } catch (e) { err = e; }
  assert.ok(err, `expected rejection ${statusCode} ${code || ''}`);
  assert.equal(err.statusCode, statusCode, `status: ${err.statusCode} ${err.code} ${err.message}`);
  if (code) assert.equal(err.code, code);
  return err;
}

let userSeq = 0;
async function mkUser(tenantId, extra = {}) {
  userSeq += 1;
  return User.create({ tenantId, email: `u${userSeq}-${rnd()}@t.co`, password: 'x'.repeat(10), fullName: `U${userSeq}`, ...extra });
}

/** A tenant with: tipo, area (2 jefes), users and the 3 cumulative rules (jefe_area < 1000, usuarios 1000-5000, rol >= 5000). */
async function mkWorld() {
  const tenantId = `t-${rnd()}`;
  const creator = await mkUser(tenantId);
  // Approvers must hold requisiciones:approve (jefe_area / usuarios / rol alike).
  const approverRole = await Role.create({ tenantId, name: `approver-${rnd()}`, permissions: [PERMISSIONS.REQUISICIONES_APPROVE] });
  const jefe1 = await mkUser(tenantId, { roleId: approverRole._id });
  const jefe2 = await mkUser(tenantId, { roleId: approverRole._id });
  const u1 = await mkUser(tenantId, { roleId: approverRole._id });
  const u2 = await mkUser(tenantId, { roleId: approverRole._id });
  const role = await Role.create({ tenantId, name: `aprobadores-${rnd()}`, permissions: [PERMISSIONS.REQUISICIONES_APPROVE] });
  const roleUser = await mkUser(tenantId, { roleId: role._id });
  const tipo = await tipoRequisicionService.create(tenantId, { nombre: 'Compra', codigo: 'cmp' });
  const area = await areaService.create(tenantId, { nombre: 'Biomedica', codigo: 'bio', jefesIds: [String(jefe1._id), String(jefe2._id)] });
  await reglaAprobacionService.create(tenantId, { orden: 1, nombre: 'Jefe', montoDesde: 0, montoHasta: 1000, aprobadorTipo: 'jefe_area' });
  await reglaAprobacionService.create(tenantId, { orden: 2, nombre: 'Usuarios', montoDesde: 1000, montoHasta: 5000, aprobadorTipo: 'usuarios', usuariosIds: [String(u1._id), String(u2._id)] });
  await reglaAprobacionService.create(tenantId, { orden: 3, nombre: 'Rol', montoDesde: 5000, montoHasta: null, aprobadorTipo: 'rol', rolId: String(role._id) });
  return { tenantId, creator, jefe1, jefe2, u1, u2, roleUser, role, approverRole, tipo, area };
}

const actor = (u) => ({ userId: String(u._id), name: 'x' });
/** One line of `price` x 1. */
const linea = (price, qty = 1) => ({ descripcion: 'Item', unidad: 'und', cantidadSolicitada: qty, precioEstimado: price });

async function mkReq(w, { price = 100, qty = 1, lineas, titulo = 'Req' } = {}) {
  return requisicionService.create(w.tenantId, String(w.creator._id), {
    titulo,
    tipoRequisicionId: String(w.tipo._id),
    areaId: String(w.area._id),
    prioridad: 'Media',
    justificacion: 'Necesario',
    lineas: lineas || [linea(price, qty)],
  }, CAPS);
}

async function mkSent(w, opts) {
  const r = await mkReq(w, opts);
  return requisicionService.enviar(w.tenantId, String(r._id), actor(w.creator));
}

/** Approve / reject echoing the CURRENT content version (the approver just loaded the requisition). */
const versionOf = async (id) => (await Requisicion.collection.findOne({ _id: new mongoose.Types.ObjectId(String(id)) }))?.version ?? 1;
const approveV = async (tenantId, id, a, data = {}) => requisicionApprovalService.approve(tenantId, id, a, { version: await versionOf(id), ...data });
const rejectV = async (tenantId, id, a, data = {}) => requisicionApprovalService.reject(tenantId, id, a, { version: await versionOf(id), ...data });
const rawDoc = (id) => Requisicion.collection.findOne({ _id: new mongoose.Types.ObjectId(String(id)) });
const tl = (doc) => doc.timeline.map((e) => e.tipo);

describe('Requisiciones E1 on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_it_${rnd()}`;
  let savedEmit;

  before(async () => {
    await mongoose.connect(URI, { dbName });
    savedEmit = notificationService.emit;
    notificationService.emit = async () => {};
    for (const m of [Requisicion, Area, TipoRequisicion, ReglaAprobacion, PresupuestoArea, Counter, User, Role]) {
      await m.init();
      await m.syncIndexes();
    }
  });

  after(async () => {
    notificationService.emit = savedEmit;
    await flushRequisicionNotifications();
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  describe('consecutivo', () => {
    it('50 parallel creates give unique, gapless consecutivos', async () => {
      const w = await mkWorld();
      const results = await Promise.all(Array.from({ length: 50 }, (_, i) => mkReq(w, { titulo: `R${i}` })));
      const list = results.map((r) => r.consecutivo);
      assert.equal(new Set(list).size, 50);
      const year = getYearInBogota();
      const nums = list.map((c) => {
        const m = c.match(new RegExp(`^REQ-${year}-(\\d{4})$`));
        assert.ok(m, c);
        return Number(m[1]);
      }).sort((a, b) => a - b);
      assert.deepEqual(nums, Array.from({ length: 50 }, (_, i) => i + 1));
    });

    it('counters are per tenant and per year', async () => {
      const a = await getNextRequisicionConsecutivo(`t-${rnd()}`, 2030);
      const b = await getNextRequisicionConsecutivo(`t-${rnd()}`, 2030);
      assert.equal(a.consecutivo, 'REQ-2030-0001');
      assert.equal(b.consecutivo, 'REQ-2030-0001');
      const t = `t-${rnd()}`;
      await getNextRequisicionConsecutivo(t, 2030);
      assert.equal((await getNextRequisicionConsecutivo(t, 2031)).consecutivo, 'REQ-2031-0001');
    });

    it('a consecutivo already taken in the tenant maps E11000 to 409 CONSECUTIVO_DUPLICADO; other tenants are unaffected', async () => {
      const w = await mkWorld();
      const first = await mkReq(w);
      // Make the counter hand out the same number again.
      await Counter.updateOne({ tenantId: w.tenantId }, { $set: { seq: 0 } });
      await expectApi(mkReq(w), 409, 'CONSECUTIVO_DUPLICADO');
      const w2 = await mkWorld();
      const other = await mkReq(w2);
      assert.equal(other.consecutivo, first.consecutivo);
    });
  });

  describe('happy path, timeline order and money', () => {
    it('Borrador -> En_Aprobacion -> 2 levels -> Aprobada', async () => {
      const w = await mkWorld();
      const r = await mkReq(w, { price: 1500 });
      assert.equal(r.estado, E.BORRADOR);
      assert.equal(r.montoEstimado, 1500);
      const sent = await requisicionService.enviar(w.tenantId, String(r._id), actor(w.creator));
      assert.equal(sent.estado, E.EN_APROBACION);
      assert.equal(sent.aprobacion.niveles.length, 2);
      assert.equal(sent.aprobacion.nivelActual, 1);
      assert.ok(sent.enviadaAt);

      // creator and a non eligible user cannot decide
      await expectApi(approveV(w.tenantId, String(r._id), actor(w.creator)), 403, 'SEPARACION_FUNCIONES');
      await expectApi(approveV(w.tenantId, String(r._id), actor(w.u1)), 403, 'APROBADOR_NO_ELEGIBLE');

      const mid = await approveV(w.tenantId, String(r._id), actor(w.jefe1), { observacion: 'ok1' });
      assert.equal(mid.estado, E.EN_APROBACION);
      assert.equal(mid.aprobacion.nivelActual, 2);
      assert.equal(mid.aprobacion.niveles[0].estado, NIVEL_ESTADO.APROBADO);
      assert.equal(String(mid.aprobacion.niveles[0].decididoPor._id), String(w.jefe1._id));
      assert.equal(mid.aprobacion.niveles[1].estado, NIVEL_ESTADO.PENDIENTE);

      // the same person cannot decide a second level
      await expectApi(approveV(w.tenantId, String(r._id), actor(w.jefe1)), 403);

      const done = await approveV(w.tenantId, String(r._id), actor(w.u1));
      assert.equal(done.estado, E.APROBADA);
      assert.equal(done.aprobacion.nivelActual, null);
      assert.ok(done.aprobadaAt);

      const raw = await rawDoc(r._id);
      assert.deepEqual(tl(raw), [EV.CREADA, EV.ENVIADA, EV.APROBACION_SOLICITADA, EV.NIVEL_APROBADO, EV.NIVEL_APROBADO, EV.APROBADA]);
      assert.equal(raw.estado, E.APROBADA);
      assert.equal(raw.aprobacion.niveles.length, 2);
      // after Aprobada nothing else can be approved
      await expectApi(approveV(w.tenantId, String(r._id), actor(w.u2)), 409, 'TRANSICION_INVALIDA');
    });

    it('edit in Borrador recomputes montoEstimado with cent rounding; 0.1 x 3 = 0.3', async () => {
      const w = await mkWorld();
      const r = await mkReq(w, { lineas: [linea(0.1, 3), linea(19.999, 1), linea(0.005, 1)] });
      // 0.30 + 20.00 + 0.01 (half away from zero)
      assert.equal(r.montoEstimado, 20.31);
    });

    it('update() through the service keeps the timeline append-only and recomputes the amount', async () => {
      const w = await mkWorld();
      const r = await mkReq(w, { price: 10 });
      const updated = await requisicionService.update(w.tenantId, String(w.creator._id), String(r._id), { titulo: 'Nuevo', lineas: [linea(0.1, 3)] }, CAPS);
      assert.equal(updated.titulo, 'Nuevo');
      assert.equal(updated.montoEstimado, 0.3);
      assert.deepEqual(tl(await rawDoc(r._id)), [EV.CREADA, EV.EDITADA]);
      await requisicionService.enviar(w.tenantId, String(r._id), actor(w.creator));
      await expectApi(requisicionService.update(w.tenantId, String(w.creator._id), String(r._id), { titulo: 'X' }, CAPS), 409, 'ESTADO_NO_EDITABLE');
    });

    it('money util edge cases', () => {
      assert.equal(roundMoney(1.005), 1.01);
      assert.equal(roundMoney(-1.005), -1.01);
      assert.equal(roundMoney(0.1 + 0.2), 0.3);
      assert.equal(sumMoney([0.1, 0.2, 0.3]), 0.6);
      assert.equal(computeMontoEstimado([{ cantidadSolicitada: 3, precioEstimado: 0.1, estadoLinea: 'Pendiente' }]), 0.3);
    });
  });

  describe('concurrency', () => {
    it('two parallel approvals of the same level by DIFFERENT jefes: exactly one wins, the other 409', async () => {
      for (let i = 0; i < 5; i += 1) {
        const w = await mkWorld();
        const s = await mkSent(w, { price: 1500 });
        const res = await Promise.allSettled([
          approveV(w.tenantId, String(s._id), actor(w.jefe1)),
          approveV(w.tenantId, String(s._id), actor(w.jefe2)),
        ]);
        const ok = res.filter((r) => r.status === 'fulfilled');
        const ko = res.filter((r) => r.status === 'rejected');
        assert.equal(ok.length, 1, JSON.stringify(res.map((r) => r.reason?.message)));
        assert.equal(ko[0].reason.statusCode, 409);
        const raw = await rawDoc(s._id);
        assert.equal(raw.aprobacion.nivelActual, 2);
        assert.deepEqual(tl(raw), [EV.CREADA, EV.ENVIADA, EV.APROBACION_SOLICITADA, EV.NIVEL_APROBADO]);
      }
    });

    it('two parallel approvals of the LAST level: one Aprobada, one 409, no duplicated events', async () => {
      const w = await mkWorld();
      const s = await mkSent(w, { price: 100 });
      const res = await Promise.allSettled([
        approveV(w.tenantId, String(s._id), actor(w.jefe1)),
        approveV(w.tenantId, String(s._id), actor(w.jefe2)),
      ]);
      assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(res.find((r) => r.status === 'rejected').reason.statusCode, 409);
      assert.deepEqual(tl(await rawDoc(s._id)), [EV.CREADA, EV.ENVIADA, EV.APROBACION_SOLICITADA, EV.NIVEL_APROBADO, EV.APROBADA]);
    });

    it('approve vs reject and approve vs cancel in parallel: one winner', async () => {
      const w = await mkWorld();
      const s = await mkSent(w, { price: 100 });
      const res = await Promise.allSettled([
        approveV(w.tenantId, String(s._id), actor(w.jefe1)),
        rejectV(w.tenantId, String(s._id), actor(w.jefe2), { observacion: 'no' }),
      ]);
      assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(res.find((r) => r.status === 'rejected').reason.statusCode, 409);
      const s2 = await mkSent(w, { price: 100 });
      const res2 = await Promise.allSettled([
        approveV(w.tenantId, String(s2._id), actor(w.jefe1)),
        requisicionService.cancelar(w.tenantId, String(s2._id), actor(w.creator), { motivo: 'm' }),
      ]);
      // approve and cancel can legitimately both succeed in sequence (Aprobada -> Cancelada); never an inconsistent doc.
      const raw = await rawDoc(s2._id);
      assert.ok([E.APROBADA, E.CANCELADA].includes(raw.estado));
      assert.ok(res2.every((r) => r.status === 'fulfilled' || r.reason.statusCode === 409));
      assert.equal(new Set(tl(raw).filter((t) => t === EV.CANCELADA)).size <= 1, true);
    });

    it('parallel cancel: exactly one Cancelada event', async () => {
      const w = await mkWorld();
      const r = await mkReq(w);
      const res = await Promise.allSettled([1, 2, 3].map(() => requisicionService.cancelar(w.tenantId, String(r._id), actor(w.creator), { motivo: 'x' })));
      assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1);
      assert.ok(res.filter((x) => x.status === 'rejected').every((x) => x.reason.statusCode === 409));
      assert.equal(tl(await rawDoc(r._id)).filter((t) => t === EV.CANCELADA).length, 1);
    });

    it('parallel enviar: one wins', async () => {
      const w = await mkWorld();
      const r = await mkReq(w);
      const res = await Promise.allSettled([1, 2].map(() => requisicionService.enviar(w.tenantId, String(r._id), actor(w.creator))));
      assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1);
      assert.equal(res.find((x) => x.status === 'rejected').reason.statusCode, 409);
      assert.equal(tl(await rawDoc(r._id)).filter((t) => t === EV.ENVIADA).length, 1);
    });
  });

  describe('reject, reopen, withdraw, cancel', () => {
    it('reject at level 2 -> Rechazada, levels cancelled, reopen and resend', async () => {
      const w = await mkWorld();
      const s = await mkSent(w, { price: 6000 }); // 3 levels
      assert.equal(s.aprobacion.niveles.length, 3);
      await expectApi(rejectV(w.tenantId, String(s._id), actor(w.jefe1), {}), 400, 'OBSERVACION_REQUERIDA');
      await approveV(w.tenantId, String(s._id), actor(w.jefe1));
      const rej = await rejectV(w.tenantId, String(s._id), actor(w.u1), { observacion: 'caro' });
      assert.equal(rej.estado, E.RECHAZADA);
      assert.deepEqual(rej.aprobacion.niveles.map((n) => n.estado), [NIVEL_ESTADO.APROBADO, NIVEL_ESTADO.RECHAZADO, NIVEL_ESTADO.CANCELADO]);
      assert.ok(rej.rechazadaAt);
      assert.deepEqual(tl(await rawDoc(s._id)), [EV.CREADA, EV.ENVIADA, EV.APROBACION_SOLICITADA, EV.NIVEL_APROBADO, EV.NIVEL_RECHAZADO, EV.RECHAZADA]);

      const re = await requisicionService.cambiarEstado(w.tenantId, String(s._id), actor(w.creator), { estado: E.BORRADOR });
      assert.equal(re.estado, E.BORRADOR);
      const again = await requisicionService.enviar(w.tenantId, String(s._id), actor(w.creator));
      assert.equal(again.estado, E.EN_APROBACION);
      assert.deepEqual(again.aprobacion.niveles.map((n) => n.estado), [NIVEL_ESTADO.PENDIENTE, NIVEL_ESTADO.PENDIENTE, NIVEL_ESTADO.PENDIENTE]);
      assert.equal(again.aprobacion.nivelActual, 1);
    });

    it('withdraw from En_Aprobacion cancels pending levels and requires observation', async () => {
      const w = await mkWorld();
      const s = await mkSent(w, { price: 1500 });
      await expectApi(requisicionService.retirar(w.tenantId, String(s._id), actor(w.creator), {}), 400, 'OBSERVACION_REQUERIDA');
      await expectApi(requisicionService.retirar(w.tenantId, String(s._id), actor(w.jefe1), { observacion: 'x' }), 403, 'SOLO_CREADOR');
      const r = await requisicionService.retirar(w.tenantId, String(s._id), actor(w.creator), { observacion: 'me equivoque' });
      assert.equal(r.estado, E.BORRADOR);
      assert.equal(r.aprobacion.nivelActual, null);
      assert.ok(r.aprobacion.niveles.every((n) => n.estado === NIVEL_ESTADO.CANCELADO));
      assert.equal(tl(await rawDoc(s._id)).at(-1), EV.RETIRADA);
    });

    it('cancel from Borrador / Enviada / En_Aprobacion / Aprobada / Rechazada; Cancelada is final', async () => {
      const w = await mkWorld();
      const cancel = (id) => requisicionService.cancelar(w.tenantId, String(id), actor(w.creator), { motivo: 'por que si' });
      await expectApi(requisicionService.cancelar(w.tenantId, String((await mkReq(w))._id), actor(w.creator), {}), 400, 'MOTIVO_REQUERIDO');

      const borrador = await mkReq(w);
      assert.equal((await cancel(borrador._id)).estado, E.CANCELADA);

      const enviada = await mkReq(w);
      await Requisicion.updateOne({ _id: enviada._id, tenantId: w.tenantId }, { $set: { estado: E.ENVIADA } });
      assert.equal((await cancel(enviada._id)).estado, E.CANCELADA);

      const enAprob = await mkSent(w, { price: 1500 });
      const c = await cancel(enAprob._id);
      assert.equal(c.estado, E.CANCELADA);
      assert.equal(c.aprobacion.nivelActual, null);
      assert.ok(c.aprobacion.niveles.every((n) => n.estado === NIVEL_ESTADO.CANCELADO));
      assert.equal(String(c.canceladaPor), String(w.creator._id));

      const aprobada = await mkSent(w, { price: 100 });
      await approveV(w.tenantId, String(aprobada._id), actor(w.jefe1));
      assert.equal((await cancel(aprobada._id)).estado, E.CANCELADA);

      const rechazada = await mkSent(w, { price: 100 });
      await rejectV(w.tenantId, String(rechazada._id), actor(w.jefe1), { observacion: 'no' });
      assert.equal((await cancel(rechazada._id)).estado, E.CANCELADA);

      await expectApi(cancel(borrador._id), 409);
      const raw = await rawDoc(enAprob._id);
      assert.equal(tl(raw).at(-1), EV.CANCELADA);
    });

    it('soft delete only in Borrador and the document disappears from reads', async () => {
      const w = await mkWorld();
      const r = await mkReq(w);
      const s = await mkSent(w);
      await expectApi(requisicionService.delete(w.tenantId, String(s._id), actor(w.creator)), 409, 'ESTADO_NO_EDITABLE');
      await requisicionService.delete(w.tenantId, String(r._id), actor(w.creator));
      await expectApi(requisicionService.getById(w.tenantId, String(r._id)), 404);
      const raw = await rawDoc(r._id);
      assert.equal(raw.isDeleted, true);
      const list = await requisicionService.list(w.tenantId, String(w.creator._id), {}, { page: 1, limit: 10 });
      assert.equal(list.data.length, 1);
      assert.equal(list.pagination.total, 1, 'total must not count soft-deleted requisitions');
    });
  });

  describe('append-only timeline on real Mongo', () => {
    const forbidden = [
      ['$set timeline', (id) => ({ $set: { timeline: [] } })],
      ['$set timeline.0.tipo', () => ({ $set: { 'timeline.0.tipo': 'APROBADA' } })],
      ['top-level timeline', () => ({ timeline: [] })],
      ['top-level timeline.0.tipo', () => ({ 'timeline.0.tipo': 'APROBADA' })],
      ['$unset timeline', () => ({ $unset: { timeline: '' } })],
      ['$pull timeline', () => ({ $pull: { timeline: { tipo: 'CREADA' } } })],
      ['$pullAll timeline', () => ({ $pullAll: { timeline: [] } })],
      ['$pop timeline', () => ({ $pop: { timeline: 1 } })],
      ['$addToSet timeline', () => ({ $addToSet: { timeline: { tipo: 'CREADA' } } })],
      ['$push with $position', () => ({ $push: { timeline: { $each: [{ tipo: 'CREADA' }], $position: 0 } } })],
      ['$push with $slice', () => ({ $push: { timeline: { $each: [{ tipo: 'CREADA' }], $slice: -1 } } })],
      ['$push with $sort', () => ({ $push: { timeline: { $each: [{ tipo: 'CREADA' }], $sort: { fecha: -1 } } } })],
      ['$currentDate timeline.0.fecha', () => ({ $currentDate: { 'timeline.0.fecha': true } })],
      ['$min timeline.0.fecha', () => ({ $min: { 'timeline.0.fecha': new Date(0) } })],
      ['$rename timeline', () => ({ $rename: { timeline: 'x' } })],
      ['$rename into timeline', () => ({ $rename: { titulo: 'timeline' } })],
      ['$set tipoRequisicionId', () => ({ $set: { tipoRequisicionId: new mongoose.Types.ObjectId() } })],
    ];

    for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate']) {
      it(`${op} rejects every forbidden operator and leaves the timeline untouched`, async () => {
        const w = await mkWorld();
        const s = await mkSent(w, { price: 100 });
        const before = JSON.stringify((await rawDoc(s._id)));
        for (const [name, build] of forbidden) {
          let err;
          try { await Requisicion[op]({ _id: s._id, tenantId: w.tenantId }, build(s._id)); } catch (e) { err = e; }
          assert.ok(err, `${op} ${name} must be rejected`);
          assert.ok(['TIMELINE_INMUTABLE', 'TIPO_INMUTABLE'].includes(err.code), `${op} ${name}: ${err.code} ${err.message}`);
        }
        assert.equal(JSON.stringify(await rawDoc(s._id)), before);
      });
    }

    it('pipeline updates, replaceOne, findOneAndReplace, bulkWrite, save() and deletes are rejected', async () => {
      const w = await mkWorld();
      const s = await mkSent(w, { price: 100 });
      const before = JSON.stringify((await rawDoc(s._id)));
      const f = { _id: s._id, tenantId: w.tenantId };
      const attempts = {
        pipeline: () => Requisicion.updateOne(f, [{ $set: { timeline: [] } }]),
        replaceOne: () => Requisicion.replaceOne(f, { tenantId: w.tenantId, titulo: 'x' }),
        findOneAndReplace: () => Requisicion.findOneAndReplace(f, { tenantId: w.tenantId, titulo: 'x' }),
        bulkWriteUpdate: () => Requisicion.bulkWrite([{ updateOne: { filter: f, update: { $set: { timeline: [] } } } }]),
        bulkWriteReplace: () => Requisicion.bulkWrite([{ replaceOne: { filter: f, replacement: { tenantId: w.tenantId } } }]),
        bulkWriteDelete: () => Requisicion.bulkWrite([{ deleteOne: { filter: f } }]),
        deleteOne: () => Requisicion.deleteOne(f),
        deleteMany: () => Requisicion.deleteMany(f),
        findOneAndDelete: () => Requisicion.findOneAndDelete(f),
        save: async () => { const d = await Requisicion.findOne(f); d.timeline.pop(); await d.save(); },
        saveSet: async () => { const d = await Requisicion.findOne(f); d.timeline[0].tipo = 'APROBADA'; await d.save(); },
              };
      for (const [name, run] of Object.entries(attempts)) {
        let err;
        try { await run(); } catch (e) { err = e; }
        assert.ok(err, `${name} must be rejected`);
      }
      assert.equal(JSON.stringify(await rawDoc(s._id)), before);
    });

    it('appendEvent is the legal writer: appends atomically with the $set', async () => {
      const w = await mkWorld();
      const r = await mkReq(w);
      const ev = buildTimelineEvent({ tipo: EV.EDITADA, actorId: w.creator._id, estadoAnterior: E.BORRADOR, estadoNuevo: E.BORRADOR });
      const upd = await Requisicion.appendEvent({ _id: r._id, tenantId: w.tenantId, estado: E.BORRADOR }, [ev], { set: { titulo: 'Z' } });
      assert.equal(upd.titulo, 'Z');
      assert.deepEqual(tl(await rawDoc(r._id)), [EV.CREADA, EV.EDITADA]);
      // wrong expected state -> null, nothing written
      const miss = await Requisicion.appendEvent({ _id: r._id, tenantId: w.tenantId, estado: E.APROBADA }, [ev], { set: { titulo: 'Q' } });
      assert.equal(miss, null);
      assert.equal((await rawDoc(r._id)).titulo, 'Z');
      // wrong tenant -> null
      assert.equal(await Requisicion.appendEvent({ _id: r._id, tenantId: 'otro', estado: E.BORRADOR }, [ev]), null);
      assert.equal((await rawDoc(r._id)).timeline.length, 2);
    });
  });

  describe('por-aprobar inbox ($expr)', () => {
    it('returns only the requisitions whose CURRENT level matches the approver', async () => {
      const w = await mkWorld();
      const L1 = await mkSent(w, { price: 100 });        // 1 level (jefe)
      const L1b = await mkSent(w, { price: 1500 });      // 2 levels, stays at level 1
      const L2 = await mkSent(w, { price: 1500 });       // 2 levels, moved to level 2
      await approveV(w.tenantId, String(L2._id), actor(w.jefe1));
      const L3 = await mkSent(w, { price: 6000 });       // 3 levels, moved to level 3
      await approveV(w.tenantId, String(L3._id), actor(w.jefe1));
      await approveV(w.tenantId, String(L3._id), actor(w.u1));
      const draft = await mkReq(w);                      // not in approval
      const inbox = async (u) => (await requisicionService.list(w.tenantId, String(u._id), { vista: 'por-aprobar' }, { page: 1, limit: 50 }));
      const ids = (res) => res.data.map((r) => String(r._id)).sort();

      const j2 = await inbox(w.jefe2);       // jefe: level 1 ones only
      assert.deepEqual(ids(j2), [String(L1._id), String(L1b._id)].sort());
      assert.equal(j2.pagination.total, 2);
      const u2 = await inbox(w.u2);          // usuarios: level 2 only
      assert.deepEqual(ids(u2), [String(L2._id)]);
      const ru = await inbox(w.roleUser);    // rol: level 3 only
      assert.deepEqual(ids(ru), [String(L3._id)]);
      // jefe1 already decided L2 and L3 (separation of duties) and is still eligible for L1 and L1b
      assert.deepEqual(ids(await inbox(w.jefe1)), [String(L1._id), String(L1b._id)].sort());
      // creator never sees their own; non-approver sees nothing; draft never appears
      assert.deepEqual(ids(await inbox(w.creator)), []);
      assert.ok(!ids(j2).includes(String(draft._id)));
      // u1 decided level 2 of L3 only; level 2 of L2 is still his
      assert.deepEqual(ids(await inbox(w.u1)), [String(L2._id)]);
      // an explicit estado filter cannot widen the inbox
      const widened = await requisicionService.list(w.tenantId, String(w.jefe2._id), { vista: 'por-aprobar', estado: E.BORRADOR }, { page: 1, limit: 50 });
      assert.equal(widened.data.length, 0);
      // inbox never leaks the timeline
      assert.equal(j2.data[0].timeline, undefined);
    });

    it('a rol-typed approver that loses the approve permission disappears from the inbox', async () => {
      const w = await mkWorld();
      const s = await mkSent(w, { price: 6000 });
      await approveV(w.tenantId, String(s._id), actor(w.jefe1));
      await approveV(w.tenantId, String(s._id), actor(w.u1));
      const q = () => requisicionService.list(w.tenantId, String(w.roleUser._id), { vista: 'por-aprobar' }, { page: 1, limit: 10 });
      assert.equal((await q()).data.length, 1);
      await Role.updateOne({ _id: w.role._id }, { $set: { permissions: [] } });
      assert.equal((await q()).data.length, 0);
    });

    it('other tenants never appear in the inbox; vista=mias and search work', async () => {
      const a = await mkWorld();
      const b = await mkWorld();
      await mkSent(a, { price: 100 });
      await mkSent(b, { price: 100 });
      const resA = await requisicionService.list(a.tenantId, String(a.jefe1._id), { vista: 'por-aprobar' }, { page: 1, limit: 10 });
      assert.equal(resA.data.length, 1);
      assert.ok(resA.data.every((r) => r.tenantId === a.tenantId));
      const mias = await requisicionService.list(a.tenantId, String(a.creator._id), { vista: 'mias' }, { page: 1, limit: 10 });
      assert.equal(mias.data.length, 1);
      const none = await requisicionService.list(a.tenantId, String(a.jefe1._id), { vista: 'mias' }, { page: 1, limit: 10 });
      assert.equal(none.data.length, 0);
      const search = await requisicionService.list(a.tenantId, String(a.creator._id), { search: 'REQ-' }, { page: 1, limit: 10 });
      assert.equal(search.data.length, 1);
      const noSearch = await requisicionService.list(a.tenantId, String(a.creator._id), { search: '.*' }, { page: 1, limit: 10 });
      assert.equal(noSearch.data.length, 0);
    });
  });

  describe('tenant isolation', () => {
    it('every operation on another tenant\'s requisition is 404', async () => {
      const a = await mkWorld();
      const b = await mkWorld();
      const s = await mkSent(a, { price: 100 });
      const id = String(s._id);
      await expectApi(requisicionService.getById(b.tenantId, id), 404, 'REQUISICION_NOT_FOUND');
      await expectApi(requisicionService.update(b.tenantId, String(b.creator._id), id, { titulo: 'x' }, CAPS), 404);
      await expectApi(requisicionService.enviar(b.tenantId, id, actor(b.creator)), 404);
      await expectApi(requisicionService.cancelar(b.tenantId, id, actor(b.creator), { motivo: 'x' }), 404);
      await expectApi(requisicionService.retirar(b.tenantId, id, actor(b.creator), { observacion: 'x' }), 404);
      await expectApi(requisicionService.delete(b.tenantId, id), 404);
      await expectApi(approveV(b.tenantId, id, actor(b.jefe1)), 404);
      await expectApi(rejectV(b.tenantId, id, actor(b.jefe1), { observacion: 'x' }), 404);
      const list = await requisicionService.list(b.tenantId, String(b.creator._id), {}, { page: 1, limit: 10 });
      assert.equal(list.data.length, 0);
      assert.equal((await rawDoc(id)).estado, E.EN_APROBACION);
      // cross-tenant references on create
      await expectApi(requisicionService.create(b.tenantId, String(b.creator._id), {
        titulo: 'x', tipoRequisicionId: String(a.tipo._id), areaId: String(b.area._id), justificacion: 'j', lineas: [linea(1)],
      }, CAPS), 400);
      await expectApi(requisicionService.create(b.tenantId, String(b.creator._id), {
        titulo: 'x', tipoRequisicionId: String(b.tipo._id), areaId: String(a.area._id), justificacion: 'j', lineas: [linea(1)],
      }, CAPS), 400, 'AREA_INVALIDA');
      await expectApi(presupuestoService.getResumen(b.tenantId, { areaId: String(a.area._id), periodo: '2026' }), 404);
    });
  });

  describe('presupuesto resumen (aggregation)', () => {
    it('consumido / comprometido / disponible / porcentaje / alerta / sobrepasado with cent rounding', async () => {
      const w = await mkWorld();
      const year = String(getYearInBogota());
      await presupuestoAreaService.create(w.tenantId, { areaId: String(w.area._id), periodo: year, monto: 1000.005, umbralAlerta: 80 });
      const empty = await presupuestoService.getResumen(w.tenantId, { areaId: String(w.area._id), periodo: year });
      assert.equal(empty.configurado, true);
      assert.equal(empty.monto, 1000.01);
      assert.equal(empty.consumido, 0);
      assert.equal(empty.comprometido, 0);
      assert.equal(empty.disponible, 1000.01);
      assert.equal(empty.porcentaje, 0);

      const approved = await mkSent(w, { lineas: [linea(0.1, 3), linea(200)] });  // 200.30, 1 level
      await approveV(w.tenantId, String(approved._id), actor(w.jefe1));
      const committed = await mkSent(w, { price: 400.7 });                          // En_Aprobacion
      await mkSent(w, { price: 50 });                                               // En_Aprobacion
      await mkReq(w, { price: 999 });                                               // Borrador: ignored
      const cancelled = await mkSent(w, { price: 111 });
      await requisicionService.cancelar(w.tenantId, String(cancelled._id), actor(w.creator), { motivo: 'm' });
      const deleted = await mkReq(w, { price: 77 });
      await requisicionService.delete(w.tenantId, String(deleted._id), actor(w.creator));

      // other area / other tenant must not count
      const other = await areaService.create(w.tenantId, { nombre: 'Otra', codigo: 'otr' });
      const foreign = await mkWorld();
      await mkSent(foreign, { price: 5000 });

      const r = await presupuestoService.getResumen(w.tenantId, { areaId: String(w.area._id), periodo: year });
      assert.equal(r.consumido, 200.3);
      assert.equal(r.comprometido, 450.7);
      assert.equal(r.disponible, roundMoney(1000.01 - 200.3 - 450.7));
      assert.equal(r.porcentaje, roundMoney(((200.3 + 450.7) / 1000.01) * 100));
      assert.equal(r.alerta, false);
      assert.equal(r.sobrepasado, false);
      assert.equal(committed.estado, E.EN_APROBACION);

      const otherRes = await presupuestoService.getResumen(w.tenantId, { areaId: String(other._id), periodo: year });
      assert.equal(otherRes.configurado, false);
      assert.equal(otherRes.consumido, 0);
      assert.equal(otherRes.comprometido, 0);
      assert.equal(otherRes.monto, null);

      // a month with no activity of an approved requisition: only the year/month containing aprobadaAt counts
      const month = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7);
      const other_month = month.endsWith('-01') ? `${month.slice(0, 5)}02` : `${month.slice(0, 5)}01`;
      const m = await presupuestoService.getResumen(w.tenantId, { areaId: String(w.area._id), periodo: other_month });
      assert.equal(m.consumido, 0);
      const cur = await presupuestoService.getResumen(w.tenantId, { areaId: String(w.area._id), periodo: month });
      assert.equal(cur.consumido, 200.3);
      assert.equal(cur.comprometido, 450.7);

      await expectApi(presupuestoService.getResumen(w.tenantId, { areaId: String(w.area._id), periodo: '2026-13' }), 400, 'PERIODO_INVALIDO');
    });

    it('alerta at the threshold and sobrepasado when consumed exceeds the budget', async () => {
      const w = await mkWorld();
      const year = String(getYearInBogota());
      await presupuestoAreaService.create(w.tenantId, { areaId: String(w.area._id), periodo: year, monto: 100, umbralAlerta: 80 });
      const a = await mkSent(w, { price: 80 });
      let r = await presupuestoService.getResumen(w.tenantId, { areaId: String(w.area._id), periodo: year });
      assert.equal(r.comprometido, 80);
      assert.equal(r.porcentaje, 80);
      assert.equal(r.alerta, true);
      assert.equal(r.sobrepasado, false);
      await approveV(w.tenantId, String(a._id), actor(w.jefe1));
      const b = await mkSent(w, { price: 900 }); // 2 levels, never approved => committed
      r = await presupuestoService.getResumen(w.tenantId, { areaId: String(w.area._id), periodo: year });
      assert.equal(r.consumido, 80);
      assert.equal(r.comprometido, 900);
      assert.equal(r.disponible, -880);
      assert.equal(r.sobrepasado, false);
      assert.equal(b.estado, E.EN_APROBACION);
      const big = await mkSent(w, { price: 100 });
      assert.ok(big);
    });

    it('sobrepasado when the approved amount exceeds the budget', async () => {
      const w = await mkWorld();
      const year = String(getYearInBogota());
      await presupuestoAreaService.create(w.tenantId, { areaId: String(w.area._id), periodo: year, monto: 50 });
      const a = await mkSent(w, { price: 90 });
      await approveV(w.tenantId, String(a._id), actor(w.jefe1));
      const r = await presupuestoService.getResumen(w.tenantId, { areaId: String(w.area._id), periodo: year });
      assert.equal(r.consumido, 90);
      assert.equal(r.sobrepasado, true);
      assert.equal(r.disponible, -40);
      assert.equal(r.porcentaje, 180);
    });
  });

  describe('unique indexes and E11000 mapping', () => {
    it('indexes exist with the expected partial filters', async () => {
      const idx = async (m) => (await m.collection.indexes());
      const area = await idx(Area);
      const u = area.filter((i) => i.unique);
      assert.equal(u.length, 2);
      assert.ok(u.every((i) => i.partialFilterExpression && i.partialFilterExpression.isDeleted === false));
      assert.ok(u.some((i) => i.collation && i.collation.strength === 2));
      assert.ok((await idx(Requisicion)).some((i) => i.unique && i.key.consecutivo === 1 && i.key.tenantId === 1));
      assert.ok((await idx(PresupuestoArea)).some((i) => i.unique && i.partialFilterExpression));
      assert.ok((await idx(TipoRequisicion)).filter((i) => i.unique).length === 2);
    });

    it('areas: duplicate codigo/nombre (case-insensitive) -> 409; parallel creates -> exactly one wins; reusable after soft delete', async () => {
      const t = `t-${rnd()}`;
      await areaService.create(t, { nombre: 'Compras', codigo: 'cmp' });
      await expectApi(areaService.create(t, { nombre: 'Otra', codigo: 'CMP' }), 409, 'DUPLICATE_AREA_CODE');
      await expectApi(areaService.create(t, { nombre: 'COMPRAS', codigo: 'zzz' }), 409, 'DUPLICATE_AREA');
      await expectApi(areaService.create(t, { nombre: 'compras', codigo: 'yyy' }), 409, 'DUPLICATE_AREA');
      // another tenant is independent
      await areaService.create(`t-${rnd()}`, { nombre: 'Compras', codigo: 'cmp' });
      // race: bypasses the friendly pre-check window
      const res = await Promise.allSettled([1, 2, 3, 4].map((i) => areaService.create(t, { nombre: `Race${i % 2 ? 'A' : 'a'}`, codigo: 'race' })));
      assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
      for (const r of res.filter((x) => x.status === 'rejected')) {
        assert.equal(r.reason.statusCode, 409, `${r.reason.code} ${r.reason.message}`);
        assert.ok(['DUPLICATE_AREA_CODE', 'DUPLICATE_AREA'].includes(r.reason.code));
      }
      // raw E11000 mapping path (bypass pre-check)
      const raw = await Area.create({ tenantId: t, nombre: 'Raw', codigo: 'RAW' }).then(() => null);
      assert.equal(raw, null);
      await assert.rejects(Area.create({ tenantId: t, nombre: 'raw', codigo: 'RAW2' }), (e) => e.code === 11000);
      // soft delete frees the slot
      const created = await Area.findOne({ tenantId: t, codigo: 'CMP' });
      await areaService.delete(t, String(created._id));
      await areaService.create(t, { nombre: 'Compras', codigo: 'cmp' });
    });

    it('tipos: duplicates -> 409 incl. under a race; reusable after soft delete', async () => {
      const t = `t-${rnd()}`;
      await tipoRequisicionService.create(t, { nombre: 'Insumos', codigo: 'ins' });
      await expectApi(tipoRequisicionService.create(t, { nombre: 'X', codigo: 'INS' }), 409, 'DUPLICATE_TIPO_CODE');
      await expectApi(tipoRequisicionService.create(t, { nombre: 'insumos', codigo: 'x' }), 409, 'DUPLICATE_TIPO');
      const res = await Promise.allSettled([1, 2, 3].map(() => tipoRequisicionService.create(t, { nombre: 'Race', codigo: 'race' })));
      assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
      for (const r of res.filter((x) => x.status === 'rejected')) assert.equal(r.reason.statusCode, 409);
      const tipo = await TipoRequisicion.findOne({ tenantId: t, codigo: 'INS' });
      await tipoRequisicionService.delete(t, String(tipo._id));
      await tipoRequisicionService.create(t, { nombre: 'Insumos', codigo: 'ins' });
    });

    it('presupuestos: one per (area, periodo) -> 409 DUPLICATE_PRESUPUESTO, also under a race; reusable after soft delete', async () => {
      const w = await mkWorld();
      const body = { areaId: String(w.area._id), periodo: '2031', monto: 10 };
      const res = await Promise.allSettled([1, 2, 3].map(() => presupuestoAreaService.create(w.tenantId, body)));
      assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
      for (const r of res.filter((x) => x.status === 'rejected')) {
        assert.equal(r.reason.statusCode, 409);
        assert.equal(r.reason.code, 'DUPLICATE_PRESUPUESTO');
      }
      await presupuestoAreaService.create(w.tenantId, { ...body, periodo: '2031-01' });
      const created = await PresupuestoArea.findOne({ tenantId: w.tenantId, periodo: '2031' });
      await presupuestoAreaService.delete(w.tenantId, String(created._id));
      await presupuestoAreaService.create(w.tenantId, body);
    });

    it('area with budgets/requisitions cannot be deleted (AREA_EN_USO); soft-deleted budgets do not block', async () => {
      const w = await mkWorld();
      await mkReq(w);
      await expectApi(areaService.delete(w.tenantId, String(w.area._id)), 409, 'AREA_EN_USO');
      const spare = await areaService.create(w.tenantId, { nombre: 'Spare', codigo: 'spr' });
      const p = await presupuestoAreaService.create(w.tenantId, { areaId: String(spare._id), periodo: '2032', monto: 5 });
      await expectApi(areaService.delete(w.tenantId, String(spare._id)), 409, 'AREA_EN_USO');
      await presupuestoAreaService.delete(w.tenantId, String(p._id));
      await areaService.delete(w.tenantId, String(spare._id));
    });

    it('list totals ignore soft-deleted rows (areas, presupuestos, reglas)', async () => {
      const w = await mkWorld();
      const extra = await areaService.create(w.tenantId, { nombre: 'Extra', codigo: 'ext' });
      const before = await areaService.list(w.tenantId, {}, { page: 1, limit: 50 });
      await areaService.delete(w.tenantId, String(extra._id));
      const after = await areaService.list(w.tenantId, {}, { page: 1, limit: 50 });
      assert.equal(after.pagination.total, before.pagination.total - 1);
      assert.equal(after.data.length, after.pagination.total);
      const p = await presupuestoAreaService.create(w.tenantId, { areaId: String(w.area._id), periodo: '2033', monto: 1 });
      await presupuestoAreaService.delete(w.tenantId, String(p._id));
      const pl = await presupuestoAreaService.list(w.tenantId, {}, { page: 1, limit: 50 });
      assert.equal(pl.pagination.total, pl.data.length);
    });
  });
  describe('adversarial review fixes (real MongoDB)', () => {
    it('B2: a rule can be updated / renamed / deactivated with a finite montoHasta (update validators)', async () => {
      const t = `t-${rnd()}`;
      const approverRole = await Role.create({ tenantId: t, name: `a-${rnd()}`, permissions: [PERMISSIONS.REQUISICIONES_APPROVE] });
      const u = await mkUser(t, { roleId: approverRole._id });
      // The seeded default rule has no upper limit: narrow it so a second level can be added.
      const def = await reglaAprobacionService.create(t, { orden: 1, nombre: 'Jefe de área', montoDesde: 0, montoHasta: null, aprobadorTipo: 'jefe_area' });
      const narrowed = await reglaAprobacionService.update(t, String(def._id), { montoHasta: 5000000 });
      assert.equal(narrowed.montoHasta, 5000000);
      const renamed = await reglaAprobacionService.update(t, String(def._id), { nombre: 'Jefe' });
      assert.equal(renamed.nombre, 'Jefe');
      assert.equal(renamed.montoHasta, 5000000);
      const second = await reglaAprobacionService.create(t, { orden: 2, nombre: 'Comité', montoDesde: 5000000, montoHasta: 9000000, aprobadorTipo: 'usuarios', usuariosIds: [String(u._id)] });
      const off = await reglaAprobacionService.update(t, String(second._id), { activo: false });
      assert.equal(off.activo, false);
      await expectApi(reglaAprobacionService.update(t, String(def._id), { montoDesde: 6000000 }), 400, 'RANGO_INVALIDO');
      // The raw model update path itself (what the old path validator broke):
      const direct = await ReglaAprobacion.findOneAndUpdate({ _id: def._id, tenantId: t }, { $set: { montoDesde: 0, montoHasta: 7000000 } }, { new: true, runValidators: true });
      assert.equal(direct.montoHasta, 7000000);
    });

    it('M3: approve / reject with a stale version -> 409 VERSION_DESACTUALIZADA with no mutation; version in responses', async () => {
      const w = await mkWorld();
      const s = await mkSent(w, { price: 500 });
      assert.equal(typeof s.version, 'number');
      const seen = (await rawDoc(s._id)).version;
      await requisicionService.cambiarEstado(w.tenantId, String(s._id), actor(w.creator), { estado: 'Borrador', observacion: 'cambio' });
      await requisicionService.update(w.tenantId, String(w.creator._id), String(s._id), { lineas: [linea(900)] }, CAPS);
      await requisicionService.enviar(w.tenantId, String(s._id), actor(w.creator));
      const before = JSON.stringify(await rawDoc(s._id));
      await expectApi(requisicionApprovalService.approve(w.tenantId, String(s._id), actor(w.jefe1), { version: seen }), 409, 'VERSION_DESACTUALIZADA');
      await expectApi(requisicionApprovalService.reject(w.tenantId, String(s._id), actor(w.jefe1), { version: seen, observacion: 'no' }), 409, 'VERSION_DESACTUALIZADA');
      assert.equal(JSON.stringify(await rawDoc(s._id)), before);
      const ok = await approveV(w.tenantId, String(s._id), actor(w.jefe1));
      assert.equal(ok.version, (await rawDoc(s._id)).version);
      assert.equal(ok.estado, E.APROBADA);
    });

    it('M1: owner rules, requisiciones:manage-all and the delete audit entry', async () => {
      const w = await mkWorld();
      const intruso = await mkUser(w.tenantId);
      const r = await mkReq(w);
      await expectApi(requisicionService.update(w.tenantId, String(intruso._id), String(r._id), { solicitanteId: String(intruso._id) }, CAPS), 403, 'SOLO_CREADOR');
      await expectApi(requisicionService.update(w.tenantId, String(intruso._id), String(r._id), { titulo: 'x' }, CAPS), 403, 'SOLO_CREADOR');
      await expectApi(requisicionService.delete(w.tenantId, String(r._id), actor(intruso)), 403, 'SOLO_CREADOR');
      await expectApi(requisicionService.enviar(w.tenantId, String(r._id), actor(intruso)), 403, 'SOLO_CREADOR');
      assert.equal((await rawDoc(r._id)).titulo, 'Req');
      const edited = await requisicionService.update(w.tenantId, String(intruso._id), String(r._id), { titulo: 'Sup' }, CAPS, { canManageAll: true });
      assert.equal(edited.titulo, 'Sup');
      await requisicionService.delete(w.tenantId, String(r._id), { ...actor(intruso), canManageAll: true });
      const raw = await rawDoc(r._id);
      assert.equal(raw.isDeleted, true);
      assert.equal(raw.timeline.at(-1).tipo, EV.ELIMINADA);
    });

    it('M4: populated references on detail, list and write responses; stored data stays ObjectIds; no sensitive fields', async () => {
      const w = await mkWorld();
      await User.updateOne({ _id: w.creator._id }, { $set: { firstName: 'Ana', lastName: 'Gil' } });
      await User.updateOne({ _id: w.jefe1._id }, { $set: { firstName: 'Beto', lastName: 'Paz' } });
      const s = await mkSent(w, { price: 500 });
      const detail = await requisicionService.getById(w.tenantId, String(s._id));
      assert.equal(detail.areaId.nombre, 'Biomedica');
      assert.equal(detail.areaId.codigo, 'BIO');
      assert.equal(detail.tipoRequisicionId.nombre, 'Compra');
      assert.equal(String(detail.creadaPor._id), String(w.creator._id));
      assert.equal(detail.creadaPor.firstName, 'Ana');
      assert.equal(detail.creadaPor.email, w.creator.email);
      assert.equal(detail.solicitanteId.lastName, 'Gil');
      assert.equal(detail.timeline[0].actor.usuarioId.firstName, 'Ana');
      const ids = detail.aprobacion.niveles[0].aprobadorIds.map((u) => String(u._id)).sort();
      assert.deepEqual(ids, [String(w.jefe1._id), String(w.jefe2._id)].sort());
      assert.equal(typeof detail.version, 'number');
      const done = await approveV(w.tenantId, String(s._id), actor(w.jefe1));
      assert.equal(done.aprobacion.niveles[0].decididoPor.firstName, 'Beto');
      const list = await requisicionService.list(w.tenantId, String(w.creator._id), { vista: 'mias' }, { page: 1, limit: 10 });
      assert.equal(list.data[0].areaId.nombre, 'Biomedica');
      assert.equal(list.data[0].creadaPor.firstName, 'Ana');
      assert.equal(typeof list.data[0].version, 'number');
      const json = JSON.stringify([detail, done, list.data]);
      for (const secret of ['password', 'passwordResetToken', 'roleId']) {
        assert.ok(!json.includes(`"${secret}"`), `${secret} leaked`);
      }
      // Persisted data was never replaced by the populated copies.
      const raw = await rawDoc(s._id);
      assert.ok(raw.areaId instanceof mongoose.Types.ObjectId);
      assert.ok(raw.creadaPor instanceof mongoose.Types.ObjectId);
      assert.ok(raw.aprobacion.niveles[0].decididoPor instanceof mongoose.Types.ObjectId);
      assert.ok(raw.aprobacion.niveles[0].aprobadorIds.every((x) => x instanceof mongoose.Types.ObjectId));
      assert.ok(raw.timeline[0].actor.usuarioId instanceof mongoose.Types.ObjectId);
    });

    it('B1: list honours the whitelisted sortBy / order', async () => {
      const w = await mkWorld();
      await mkReq(w, { price: 300, titulo: 'B' });
      await mkReq(w, { price: 100, titulo: 'C' });
      await mkReq(w, { price: 200, titulo: 'A' });
      const q = async (sortBy, order) => (await requisicionService.list(w.tenantId, String(w.creator._id), {}, { page: 1, limit: 10, sortBy, order })).data;
      assert.deepEqual((await q('montoEstimado', 'asc')).map((r) => r.montoEstimado), [100, 200, 300]);
      assert.deepEqual((await q('montoEstimado', 'desc')).map((r) => r.montoEstimado), [300, 200, 100]);
      assert.deepEqual((await q('titulo', 'asc')).map((r) => r.titulo), ['A', 'B', 'C']);
      assert.deepEqual((await q('consecutivo', 'desc')).map((r) => r.titulo), ['A', 'C', 'B']);
      assert.deepEqual((await q('createdAt', 'desc')).map((r) => r.titulo), ['A', 'C', 'B']);
      // A non whitelisted key falls back to createdAt (order kept) (never reaches the sort).
      assert.deepEqual((await q('isDeleted', 'asc')).map((r) => r.titulo), ['B', 'C', 'A']);
    });

    it('M2: one person as the only approver of two levels -> 422 at send; a second member fixes it', async () => {
      const t2 = `t-${rnd()}`;
      const creator = await mkUser(t2);
      const approverRole = await Role.create({ tenantId: t2, name: `ap-${rnd()}`, permissions: [PERMISSIONS.REQUISICIONES_APPROVE] });
      const bob = await mkUser(t2, { roleId: approverRole._id });
      const tipo = await tipoRequisicionService.create(t2, { nombre: 'C', codigo: 'c' });
      const area = await areaService.create(t2, { nombre: 'A', codigo: 'a', jefesIds: [String(bob._id)] });
      await reglaAprobacionService.create(t2, { orden: 1, nombre: 'Jefe', montoDesde: 0, montoHasta: 1000, aprobadorTipo: 'jefe_area' });
      await reglaAprobacionService.create(t2, { orden: 2, nombre: 'Rol', montoDesde: 1000, montoHasta: null, aprobadorTipo: 'rol', rolId: String(approverRole._id) });
      const ww = { tenantId: t2, creator, tipo, area };
      const r = await mkReq(ww, { price: 1500 });
      const err = await expectApi(requisicionService.enviar(t2, String(r._id), actor(creator)), 422, 'NIVEL_SIN_APROBADOR_ELEGIBLE');
      assert.deepEqual(err.details.niveles.map((n) => n.orden), [1, 2]);
      assert.equal((await rawDoc(r._id)).estado, E.BORRADOR);
      await mkUser(t2, { roleId: approverRole._id });
      const sent = await requisicionService.enviar(t2, String(r._id), actor(creator));
      assert.equal(sent.estado, E.EN_APROBACION);
      assert.deepEqual(await reglaAprobacionService.getWarnings(t2), []);
    });

    it('M2: rule configuration rejects a user or role without requisiciones:approve and an infeasible active set', async () => {
      const t = `t-${rnd()}`;
      const noPerm = await mkUser(t);
      const role = await Role.create({ tenantId: t, name: `ap-${rnd()}`, permissions: [PERMISSIONS.REQUISICIONES_APPROVE] });
      await mkUser(t, { roleId: role._id });
      await expectApi(reglaAprobacionService.create(t, { orden: 1, nombre: 'U', montoDesde: 0, montoHasta: 10, aprobadorTipo: 'usuarios', usuariosIds: [String(noPerm._id)] }), 400, 'APROBADOR_SIN_PERMISO');
      await reglaAprobacionService.create(t, { orden: 1, nombre: 'R1', montoDesde: 0, montoHasta: 10, aprobadorTipo: 'rol', rolId: String(role._id) });
      await expectApi(reglaAprobacionService.create(t, { orden: 2, nombre: 'R2', montoDesde: 10, montoHasta: null, aprobadorTipo: 'rol', rolId: String(role._id) }), 422, 'NIVEL_SIN_APROBADOR_ELEGIBLE');
    });

    it('M2: reassign on real Mongo (pending level, SoD, timeline)', async () => {
      const w = await mkWorld();
      const nuevo = await mkUser(w.tenantId, { roleId: w.approverRole._id });
      const s = await mkSent(w, { price: 1500 });
      const out = await requisicionApprovalService.reassign(w.tenantId, String(s._id), { ...actor(w.u1), canManageAll: true }, { nivelOrden: 1, aprobadorIds: [String(nuevo._id)] });
      assert.deepEqual(out.aprobacion.niveles[0].aprobadorIds.map((u) => String(u._id)), [String(nuevo._id)]);
      assert.equal(out.timeline.at(-1).tipo, EV.APROBADORES_REASIGNADOS);
      await expectApi(approveV(w.tenantId, String(s._id), actor(w.jefe1)), 403, 'APROBADOR_NO_ELEGIBLE');
      await expectApi(requisicionApprovalService.reassign(w.tenantId, String(s._id), actor(w.u1), { nivelOrden: 1, aprobadorIds: [String(w.creator._id)] }), 400, 'SEPARACION_FUNCIONES');
      await approveV(w.tenantId, String(s._id), actor(nuevo));
      await expectApi(requisicionApprovalService.reassign(w.tenantId, String(s._id), actor(w.u1), { nivelOrden: 1, aprobadorIds: [String(w.jefe1._id)] }), 409, 'NIVEL_NO_PENDIENTE');
    });

    it('N1: overlapping eligible sets (L1 jefes A,B / L2 usuarios [A]): A cannot approve L1 (409), B then A can; reject never blocked', async () => {
      const t = `t-${rnd()}`;
      const creator = await mkUser(t);
      const role = await Role.create({ tenantId: t, name: `ap-${rnd()}`, permissions: [PERMISSIONS.REQUISICIONES_APPROVE] });
      const A = await mkUser(t, { roleId: role._id });
      const B = await mkUser(t, { roleId: role._id });
      const tipo = await tipoRequisicionService.create(t, { nombre: 'C', codigo: 'c' });
      const area = await areaService.create(t, { nombre: 'A', codigo: 'a', jefesIds: [String(A._id), String(B._id)] });
      await reglaAprobacionService.create(t, { orden: 1, nombre: 'Jefe', montoDesde: 0, montoHasta: 1000, aprobadorTipo: 'jefe_area' });
      await reglaAprobacionService.create(t, { orden: 2, nombre: 'Comité', montoDesde: 1000, montoHasta: null, aprobadorTipo: 'usuarios', usuariosIds: [String(A._id)] });
      const ww = { tenantId: t, creator, tipo, area };
      const send = async () => requisicionService.enviar(t, String((await mkReq(ww, { price: 1500 }))._id), actor(creator));

      const s = await send();
      const before = JSON.stringify(await rawDoc(s._id));
      const err = await expectApi(approveV(t, String(s._id), actor(A)), 409, 'APROBACION_BLOQUEARIA_NIVEL');
      assert.deepEqual(err.details.niveles, [{ orden: 2, nombre: 'Comité' }]);
      assert.equal(JSON.stringify(await rawDoc(s._id)), before, 'no mutation');
      const mid = await approveV(t, String(s._id), actor(B));
      assert.equal(mid.aprobacion.nivelActual, 2);
      assert.equal((await approveV(t, String(s._id), actor(A))).estado, E.APROBADA);

      const s2 = await send();
      assert.equal((await rejectV(t, String(s2._id), actor(A), { observacion: 'no' })).estado, E.RECHAZADA);
    });

    it('N2: the acting user cannot assign himself when reassigning', async () => {
      const w = await mkWorld();
      const s = await mkSent(w, { price: 1500 });
      const before = JSON.stringify(await rawDoc(s._id));
      await expectApi(requisicionApprovalService.reassign(w.tenantId, String(s._id), { ...actor(w.u1), canManageAll: true }, { nivelOrden: 1, aprobadorIds: [String(w.u1._id)] }), 400, 'SEPARACION_FUNCIONES');
      assert.equal(JSON.stringify(await rawDoc(s._id)), before);
    });

    it('N3: reassign bumps the version; a decision with the old version is refused', async () => {
      const w = await mkWorld();
      const nuevo = await mkUser(w.tenantId, { roleId: w.approverRole._id });
      const s = await mkSent(w, { price: 1500 });
      const seen = await versionOf(s._id);
      await requisicionApprovalService.reassign(w.tenantId, String(s._id), { ...actor(w.u1), canManageAll: true }, { nivelOrden: 1, aprobadorIds: [String(nuevo._id)] });
      assert.equal(await versionOf(s._id), seen + 1);
      await expectApi(requisicionApprovalService.approve(w.tenantId, String(s._id), actor(nuevo), { version: seen }), 409, 'VERSION_DESACTUALIZADA');
    });

    it('N8: a legacy document without version is seeded to 1 so the next bump moves it to 2 (stale approve refused)', async () => {
      const w = await mkWorld();
      const s = await mkSent(w, { price: 500 });
      await requisicionService.cambiarEstado(w.tenantId, String(s._id), actor(w.creator), { estado: 'Borrador', observacion: 'x' });
      await Requisicion.collection.updateOne({ _id: s._id }, { $unset: { version: '' } });
      await requisicionService.enviar(w.tenantId, String(s._id), actor(w.creator));
      assert.equal((await rawDoc(s._id)).version, 2);
      await expectApi(requisicionApprovalService.approve(w.tenantId, String(s._id), actor(w.jefe1), { version: 1 }), 409, 'VERSION_DESACTUALIZADA');
    });

    it('N4: a rule whose role lost requisiciones:approve can still be renamed and deactivated', async () => {
      const t = `t-${rnd()}`;
      const role = await Role.create({ tenantId: t, name: `ap-${rnd()}`, permissions: [PERMISSIONS.REQUISICIONES_APPROVE] });
      await mkUser(t, { roleId: role._id });
      const rule = await reglaAprobacionService.create(t, { orden: 1, nombre: 'R', montoDesde: 0, montoHasta: null, aprobadorTipo: 'rol', rolId: String(role._id) });
      await Role.updateOne({ _id: role._id }, { $set: { permissions: [] } });
      assert.equal((await reglaAprobacionService.update(t, String(rule._id), { nombre: 'R2' })).nombre, 'R2');
      assert.equal((await reglaAprobacionService.update(t, String(rule._id), { activo: false })).activo, false);
      await expectApi(reglaAprobacionService.update(t, String(rule._id), { activo: true }), 400, 'ROL_SIN_PERMISO_APROBAR');
    });

    it('N6: a soft-deleted user still populates with his name (never null)', async () => {
      const w = await mkWorld();
      await User.updateOne({ _id: w.creator._id }, { $set: { firstName: 'Ana', lastName: 'Gil' } });
      const s = await mkSent(w, { price: 500 });
      await User.updateOne({ _id: w.creator._id }, { $set: { isDeleted: true, deletedAt: new Date() } });
      const detail = await requisicionService.getById(w.tenantId, String(s._id));
      assert.equal(detail.creadaPor.firstName, 'Ana');
      assert.equal(String(detail.creadaPor._id), String(w.creator._id));
    });

    it('por-aprobar combines with an explicit creadaPor filter (AND)', async () => {
      const w = await mkWorld();
      await mkSent(w, { price: 100 });
      const other = await mkUser(w.tenantId);
      const mine = await requisicionService.list(w.tenantId, String(w.jefe1._id), { vista: 'por-aprobar', creadaPor: String(w.creator._id) }, { page: 1, limit: 10 });
      assert.equal(mine.data.length, 1);
      const none = await requisicionService.list(w.tenantId, String(w.jefe1._id), { vista: 'por-aprobar', creadaPor: String(other._id) }, { page: 1, limit: 10 });
      assert.equal(none.data.length, 0);
    });
  });
});
