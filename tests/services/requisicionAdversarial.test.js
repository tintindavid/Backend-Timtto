/**
 * requisiciones-e2 adversarial fixes (DB-free): A4 cancel after confirmation, B2 all lines cancelled, A3 reopen / send
 * revalidation, A2 duplicated stock items on lines that come from solicitudes.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { requisicionService } from '../../src/services/requisicion.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { setupFixture, svc, T, oid, user } from '../helpers/requisicionConfirmFixture.js';

let f;
beforeEach(() => { f = setupFixture(); });
afterEach(async () => { await flushRequisicionNotifications(); f.restore(); });

const sol = (id) => f.solicitudes.find((x) => x._id === id);
const mgr = () => ({ userId: oid(), name: 'Gerente', canManageAll: true });
const rej = (status, code) => (e) => e.statusCode === status && (code === undefined || e.code === code);

/** Adds a solicitud linked to `req` through `line`. */
function addSolicitud(req, line, over = {}) {
  const s = {
    _id: oid(), tenantId: T, nombre: 'Sensor', Cantidad: '2', EstadoSolicitud: 'Solicitado', ResponsableSolicitud: oid(),
    requisicion: { requisicionId: req._id, lineaId: line.lineaId, consecutivo: req.consecutivo, disponibilidad: 'En_Abastecimiento', cantidadConfirmada: 0 }, ...over,
  };
  line.origenSolicitudRepuestoId = s._id;
  f.solicitudes.push(s);
  return s;
}
const mkLine = (over = {}) => ({ lineaId: oid(), descripcion: 'Repuesto', unidad: 'und', cantidadSolicitada: 2, precioEstimado: 10, estadoLinea: 'Pendiente', ...over });

describe('A4: cancelling a requisition keeps the goods already confirmed', () => {
  for (const estadoLinea of ['Recibida_Parcial', 'En_Disputa', 'Recibida']) {
    it(`a ${estadoLinea} line with 1 unit confirmed is closed short (Confirmada + cierre) and stays Disponible; the other line is released`, async () => {
      const a = mkLine({ estadoLinea, cantidadRecibida: 1, cantidadConfirmada: 1 });
      const b = mkLine();
      const r = f.w.seedRequisicion({ estado: 'En_Recepcion', lineas: [a, b], recepciones: [] });
      const sa = addSolicitud(r, a, { requisicion: { requisicionId: r._id, lineaId: a.lineaId, consecutivo: r.consecutivo, disponibilidad: 'En_Abastecimiento', cantidadConfirmada: 1 } });
      const sb = addSolicitud(r, b);

      const out = await requisicionService.cancelar(T, r._id, mgr(), { motivo: 'Proveedor cerró' });
      assert.equal(out.estado, 'Cancelada');
      const la = f.line(r._id, a.lineaId);
      assert.equal(la.estadoLinea, 'Confirmada');
      assert.equal(la.cierre.motivo, 'Proveedor cerró');
      assert.ok(la.cierre.por && la.cierre.fecha);
      assert.equal(la.cantidadConfirmada, 1);
      assert.equal(sol(sa._id).requisicion.disponibilidad, 'Disponible');
      assert.equal(sol(sa._id).requisicion.cantidadConfirmada, 1);
      assert.equal(sol(sb._id).requisicion, undefined, 'nothing confirmed -> released');
      const tipos = f.doc(r._id).timeline.map((e) => e.tipo);
      assert.ok(tipos.includes('LINEA_CERRADA'));
      assert.equal(tipos.at(-1), 'CANCELADA');
      assert.equal(tipos.filter((t) => t === 'LINEA_CERRADA').length, 1);
    });
  }

  it('cancelling with nothing confirmed behaves as before (no LINEA_CERRADA, everything released)', async () => {
    const a = mkLine();
    const r = f.w.seedRequisicion({ estado: 'Aprobada', lineas: [a], recepciones: [] });
    const sa = addSolicitud(r, a);
    await requisicionService.cancelar(T, r._id, mgr(), { motivo: 'x' });
    assert.equal(sol(sa._id).requisicion, undefined);
    assert.ok(!f.doc(r._id).timeline.some((e) => e.tipo === 'LINEA_CERRADA'));
    assert.equal(f.line(r._id, a.lineaId).estadoLinea, 'Pendiente');
  });

  it('a confirmation racing the cancel (guard miss) is retried, not lost', async () => {
    const a = mkLine({ estadoLinea: 'Recibida_Parcial', cantidadRecibida: 1, cantidadConfirmada: 1 });
    const r = f.w.seedRequisicion({ estado: 'En_Recepcion', lineas: [a], recepciones: [] });
    addSolicitud(r, a);
    const out = await requisicionService.cancelar(T, r._id, mgr(), { motivo: 'x' });
    assert.equal(out.estado, 'Cancelada');
    assert.equal(f.line(r._id, a.lineaId).estadoLinea, 'Confirmada');
  });
});

describe('B2: every line cancelled with nothing confirmed ends the requisition Cancelada', () => {
  it('cerrarLinea on the last pending line -> Cancelada, CANCELADA event with the aggregated reason, solicitud released', async () => {
    const a = mkLine();
    const r = f.w.seedRequisicion({ estado: 'Aprobada', lineas: [a], recepciones: [] });
    const sa = addSolicitud(r, a);
    const out = await svc.cerrarLinea(T, r._id, a.lineaId, user(oid()), { motivo: 'Ya no se necesita' });
    assert.equal(out.estado, 'Cancelada');
    const ev = f.doc(r._id).timeline.at(-1);
    assert.equal(ev.tipo, 'CANCELADA');
    assert.match(ev.observacion, /Ya no se necesita/);
    assert.match(f.doc(r._id).canceladaMotivo, /Ya no se necesita/);
    assert.equal(sol(sa._id).requisicion, undefined);
    await flushRequisicionNotifications();
    assert.ok(f.w.emits.some((e) => e.event === 'requisicion.cancelled'));
    assert.ok(!f.w.emits.some((e) => e.event === 'requisicion.closed'));
  });

  it('one line cancelled and one confirmed still closes (Cerrada)', async () => {
    const a = mkLine({ estadoLinea: 'Confirmada', cantidadConfirmada: 2, cantidadRecibida: 2 });
    const b = mkLine();
    const r = f.w.seedRequisicion({ estado: 'En_Recepcion', lineas: [a, b], recepciones: [] });
    const out = await svc.cerrarLinea(T, r._id, b.lineaId, user(oid()), { motivo: 'x' });
    assert.equal(out.estado, 'Cerrada');
  });
});

describe('A3: reabrir / enviar revalidate the links of the lines', () => {
  function rejectedWith(...kinds) {
    const lines = kinds.map(() => mkLine());
    const r = f.w.seedRequisicion({ estado: 'Rechazada', lineas: lines, recepciones: [] });
    const other = f.w.seedRequisicion({ estado: 'En_Aprobacion', lineas: [mkLine()], recepciones: [] });
    const sols = kinds.map((k, i) => {
      const s = addSolicitud(r, lines[i], k === 'free' ? {} : {});
      if (k === 'free') delete s.requisicion;
      if (k === 'taken') s.requisicion = { requisicionId: other._id, lineaId: oid(), consecutivo: other.consecutivo, disponibilidad: 'En_Aprobacion' };
      if (k === 'staleCancelled') {
        const dead = f.w.seedRequisicion({ estado: 'Cancelada', lineas: [mkLine({ origenSolicitudRepuestoId: s._id, estadoLinea: 'Pendiente' })], recepciones: [] });
        s.requisicion = { requisicionId: dead._id, lineaId: oid(), consecutivo: dead.consecutivo, disponibilidad: 'En_Abastecimiento' };
      }
      if (k === 'installed') { delete s.requisicion; s.EstadoSolicitud = 'Instalado'; }
      return s;
    });
    return { r, lines, sols, other };
  }

  it('removes the lines whose solicitud belongs to ANOTHER active requisition, with advertencias and a timeline note', async () => {
    const { r, lines, sols } = rejectedWith('free', 'taken');
    const out = await requisicionService.reabrir(T, r._id, mgr(), { observacion: 'Corregida' });
    assert.equal(out.estado, 'Borrador');
    assert.equal(out.lineas.length, 1);
    assert.equal(String(out.lineas[0].lineaId), String(lines[0].lineaId));
    assert.equal(out.advertencias.length, 1);
    assert.equal(out.advertencias[0].repuestoId, sols[1]._id);
    assert.match(out.advertencias[0].motivo, /ya pertenece a la requisición/);
    const ev = f.doc(r._id).timeline.at(-1);
    assert.equal(ev.tipo, 'REABIERTA');
    assert.match(ev.observacion, /Corregida/);
    assert.match(ev.observacion, /retiradas/);
    assert.equal(f.doc(r._id).montoEstimado, 20);
    assert.equal(sol(sols[0]._id).requisicion.requisicionId, r._id, 're-claimed by the reopened draft');
    assert.notEqual(sol(sols[1]._id).requisicion.requisicionId, r._id, 'the other requisition keeps it');
  });

  it('a stale link (other requisition Cancelada) is healed and the line is kept; an Instalado solicitud is removed', async () => {
    const { r, sols } = rejectedWith('staleCancelled', 'installed', 'free');
    const out = await requisicionService.reabrir(T, r._id, mgr(), {});
    assert.equal(out.lineas.length, 2);
    assert.equal(out.advertencias.length, 1);
    assert.match(out.advertencias[0].motivo, /Solicitado/);
    assert.equal(sol(sols[0]._id).requisicion.requisicionId, r._id);
  });

  it('nothing taken -> no advertencias key and the content is untouched', async () => {
    const { r } = rejectedWith('free', 'free');
    const out = await requisicionService.reabrir(T, r._id, mgr(), {});
    assert.equal(out.lineas.length, 2);
    assert.equal('advertencias' in out, false);
  });

  it('no line left -> 409 SIN_LINEAS_VIGENTES and the requisition stays Rechazada (it can be cancelled)', async () => {
    const { r } = rejectedWith('taken', 'taken');
    await assert.rejects(requisicionService.reabrir(T, r._id, mgr(), {}), rej(409, 'SIN_LINEAS_VIGENTES'));
    assert.equal(f.doc(r._id).estado, 'Rechazada');
    const out = await requisicionService.cancelar(T, r._id, mgr(), { motivo: 'Ya compradas' });
    assert.equal(out.estado, 'Cancelada');
  });

  it('cambiarEstado to Borrador from Rechazada goes through the same revalidation', async () => {
    const { r } = rejectedWith('taken', 'taken');
    await assert.rejects(requisicionService.cambiarEstado(T, r._id, mgr(), { estado: 'Borrador' }), rej(409, 'SIN_LINEAS_VIGENTES'));
  });

  it('enviar refuses a line whose link is held by another requisition: 409 SOLICITUD_YA_VINCULADA with the ids', async () => {
    const a = mkLine();
    const r = f.w.seedRequisicion({ estado: 'Borrador', lineas: [a], recepciones: [] });
    const other = f.w.seedRequisicion({ estado: 'Aprobada', lineas: [mkLine()], recepciones: [] });
    const s = addSolicitud(r, a);
    s.requisicion = { requisicionId: other._id, lineaId: oid(), consecutivo: other.consecutivo, disponibilidad: 'En_Abastecimiento' };
    await assert.rejects(requisicionService.enviar(T, r._id, mgr(), {}), (e) => e.statusCode === 409 && e.code === 'SOLICITUD_YA_VINCULADA' && e.details.ids[0] === s._id);
    assert.equal(f.doc(r._id).estado, 'Borrador');
  });
});

describe('A2: a stock item may repeat on lines that come from solicitudes', () => {
  const caps = { usesInventoryBasic: true, usesRequisiciones: true };
  const lineOf = (itemId, over = {}) => ({ descripcion: 'x', unidad: 'und', cantidadSolicitada: 1, precioEstimado: 1, inventarioItemId: itemId, ...over });

  it('two origin lines with the same item are accepted and keep their item', async () => {
    const item = f.w.addItem();
    const out = await requisicionService.buildLineas(T, [
      lineOf(item._id, { origenSolicitudRepuestoId: oid() }),
      lineOf(item._id, { origenSolicitudRepuestoId: oid() }),
    ], { capabilities: caps, moneda: 'COP', allowOrigen: true });
    assert.equal(out.length, 2);
    assert.ok(out.every((l) => String(l.inventarioItemId) === String(item._id) && l.origenSolicitudRepuestoId));
  });

  it('manual duplicates (and a manual line repeating an origin item) still answer 409 LINEA_DUPLICADA', async () => {
    const item = f.w.addItem();
    const opts = { capabilities: caps, moneda: 'COP', allowOrigen: true };
    await assert.rejects(requisicionService.buildLineas(T, [lineOf(item._id), lineOf(item._id)], opts), rej(409, 'LINEA_DUPLICADA'));
    await assert.rejects(requisicionService.buildLineas(T, [lineOf(item._id), lineOf(item._id, { origenSolicitudRepuestoId: oid() })], opts), rej(409, 'LINEA_DUPLICADA'));
  });

  it('a draft edit keeps accepting the repeated item of origin lines (matched by lineaId)', async () => {
    const item = f.w.addItem();
    const existing = [mkLine({ lineaId: oid(), inventarioItemId: item._id, origenSolicitudRepuestoId: oid() }), mkLine({ lineaId: oid(), inventarioItemId: item._id, origenSolicitudRepuestoId: oid() })];
    const payload = existing.map((l) => lineOf(item._id, { lineaId: l.lineaId }));
    const out = await requisicionService.buildLineas(T, payload, { capabilities: caps, moneda: 'COP', existing });
    assert.equal(out.length, 2);
    assert.ok(out.every((l) => l.origenSolicitudRepuestoId));
  });
});
