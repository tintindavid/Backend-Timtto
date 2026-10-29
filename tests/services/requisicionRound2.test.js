/**
 * requisiciones-e2 adversarial round 2 (DB-free): 3.2 enviar refuses non-eligible origins, 3.4 cancel from En_Recepcion.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { requisicionService } from '../../src/services/requisicion.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { setupFixture, T, oid } from '../helpers/requisicionConfirmFixture.js';

let f;
beforeEach(() => { f = setupFixture(); });
afterEach(async () => { await flushRequisicionNotifications(); f.restore(); });

const sol = (id) => f.solicitudes.find((x) => x._id === id);
const mgr = () => ({ userId: oid(), name: 'Gerente', canManageAll: true });
const mkLine = (over = {}) => ({ lineaId: oid(), descripcion: 'Repuesto', unidad: 'und', cantidadSolicitada: 2, precioEstimado: 10, estadoLinea: 'Pendiente', ...over });
function addSolicitud(req, line, over = {}) {
  const s = {
    _id: oid(), tenantId: T, nombre: 'Sensor', Cantidad: '2', EstadoSolicitud: 'Solicitado', ResponsableSolicitud: oid(),
    requisicion: { requisicionId: req._id, lineaId: line.lineaId, consecutivo: req.consecutivo, disponibilidad: 'En_Abastecimiento', cantidadConfirmada: 0 }, ...over,
  };
  line.origenSolicitudRepuestoId = s._id;
  f.solicitudes.push(s);
  return s;
}

describe('3.2: enviar refuses an origin line whose solicitud is no longer eligible', () => {
  for (const estado of ['Instalado', 'En Proceso']) {
    it(`unlinked solicitud now ${estado} -> 409 SOLICITUD_NO_ELEGIBLE with the ids; the draft stays Borrador`, async () => {
      const a = mkLine();
      const r = f.w.seedRequisicion({ estado: 'Borrador', lineas: [a], recepciones: [] });
      const s = addSolicitud(r, a, { EstadoSolicitud: estado });
      delete s.requisicion;
      await assert.rejects(
        requisicionService.enviar(T, r._id, mgr(), { justificacion: 'Necesario' }),
        (e) => e.statusCode === 409 && e.code === 'SOLICITUD_NO_ELEGIBLE' && e.details.ids[0] === s._id,
      );
      assert.equal(f.doc(r._id).estado, 'Borrador');
    });
  }
});

describe('3.4: cancel from En_Recepcion', () => {
  const recep = (lineaId, cantidad, confirmada) => ({
    recepcionId: oid(), fecha: new Date(), recibidaPor: oid(),
    items: [{ lineaId, cantidadRecibida: cantidad, ...(confirmada ? { confirmacion: { por: oid(), fecha: new Date(), resultado: 'Recibido', cantidad } } : {}) }],
  });

  function seed() {
    const resp = oid();
    const a = mkLine({ cantidadSolicitada: 4, precioEstimado: 10, estadoLinea: 'Recibida_Parcial', cantidadRecibida: 3, cantidadConfirmada: 2, responsableId: resp });
    const b = mkLine({ cantidadSolicitada: 5, precioEstimado: 10 });
    const r = f.w.seedRequisicion({ estado: 'En_Recepcion', lineas: [a, b], recepciones: [recep(a.lineaId, 2, true), recep(a.lineaId, 1, false)] });
    const sa = addSolicitud(r, a, { requisicion: { requisicionId: r._id, lineaId: a.lineaId, consecutivo: r.consecutivo, disponibilidad: 'En_Abastecimiento', cantidadConfirmada: 2 } });
    addSolicitud(r, b);
    return { r, a, b, sa, resp };
  }

  it('(a) montoEstimado prices the line closed short by what was confirmed (2x10) plus the untouched line (5x10)', async () => {
    const { r } = seed();
    await requisicionService.cancelar(T, r._id, mgr(), { motivo: 'x' });
    assert.equal(f.doc(r._id).montoEstimado, 70);
  });

  it('(c) the CANCELADA event records the units received but not confirmed', async () => {
    const { r, a } = seed();
    await requisicionService.cancelar(T, r._id, mgr(), { motivo: 'x' });
    const ev = f.doc(r._id).timeline.at(-1);
    assert.equal(ev.tipo, 'CANCELADA');
    assert.deepEqual(ev.datos.recibidasSinConfirmar.map((x) => [x.lineaId, x.cantidad]), [[String(a.lineaId), 1]]);
  });

  it('(c) nothing received unconfirmed -> no datos key', async () => {
    const a = mkLine();
    const r = f.w.seedRequisicion({ estado: 'Aprobada', lineas: [a], recepciones: [] });
    await requisicionService.cancelar(T, r._id, mgr(), { motivo: 'x' });
    assert.equal(f.doc(r._id).timeline.at(-1).datos, undefined);
  });

  it('(b) the responsible of the solicitud that became Disponible gets requisicion.delivery.confirmed', async () => {
    const { r, sa, resp } = seed();
    await requisicionService.cancelar(T, r._id, mgr(), { motivo: 'x' });
    await flushRequisicionNotifications();
    assert.equal(sol(sa._id).requisicion.disponibilidad, 'Disponible');
    const ev = f.w.emits.filter((e) => e.event === 'requisicion.delivery.confirmed');
    assert.equal(ev.length, 1);
    assert.ok(JSON.stringify(ev[0]).includes(String(resp)));
  });
});
