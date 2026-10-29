/**
 * Shared fixture of the confirmation / closing tests (requisiciones-e2, group 4): a DB-free world plus an in-memory
 * `Repuestos` (solicitudes) and `RepuestoTrazabilidad`, and a fake stock service behind the service seam.
 */
import sift from 'sift';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { RepuestoTrazabilidad } from '../../src/models/repuestotrazabilidad.model.js';
import { requisicionRecepcionService } from '../../src/services/requisicionRecepcion.service.js';
import { ApiError } from '../../src/utils/apiError.util.js';
import { createWorld, oid } from './requisicionWorld.js';

export const T = 'acme';
export const svc = requisicionRecepcionService;
export { oid };

const deepCopy = (o) => JSON.parse(JSON.stringify(o));
const setPath = (o, p, v) => {
  const keys = p.split('.');
  let cur = o;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (cur[keys[i]] === undefined || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = v;
};

const realDeps = { ...requisicionRecepcionService.deps };

export function setupFixture() {
  const w = createWorld({ tenantId: T });
  const solicitudes = [];
  const traces = [];
  const stock = { calls: [], failOn: null, levels: new Map() };
  const saved = { find: Repuestos.find, updateOne: Repuestos.updateOne, trace: RepuestoTrazabilidad.create };

  Repuestos.find = (filter) => {
    const q = { select: () => q, lean: () => q, then: (res, rej) => Promise.resolve(solicitudes.filter((r) => sift(filter)(r)).map(deepCopy)).then(res, rej) };
    return q;
  };
  Repuestos.updateOne = async (filter, update) => {
    const hit = solicitudes.find((r) => sift(filter)(r));
    if (!hit) return { modifiedCount: 0 };
    for (const [p, v] of Object.entries(update.$set || {})) setPath(hit, p, deepCopy(v));
    for (const p of Object.keys(update.$unset || {})) delete hit[p];
    return { modifiedCount: 1 };
  };
  RepuestoTrazabilidad.create = async (doc) => { traces.push(doc); return doc; };

  svc.deps.startSession = async () => null;
  svc.deps.movimientos = {
    create: async (tenantId, data, userId) => {
      const idx = stock.calls.length;
      if (stock.failOn !== null && stock.failOn(data, idx)) throw new ApiError(404, 'InventarioRepuesto no encontrado', 'NOT_FOUND');
      stock.calls.push({ tenantId, userId, ...data });
      const k = String(data.itemId);
      stock.levels.set(k, (stock.levels.get(k) || 0) + (data.tipo === 'entrada' ? data.cantidad : -data.cantidad));
      return { _id: oid() };
    },
  };

  /**
   * Seeds a requisition En_Recepcion with one line (default 2 asked, 2 received in a single reception).
   * `line` and `rec` override the line / the reception item; `responsable` is the solicitud's responsible user.
   */
  function seed({ line = {}, rec = {}, estado = 'En_Recepcion', withOrigen = true, responsable = oid(), solicitante = oid(), recibidaPor = oid(), extraLines = [] } = {}) {
    const _id = oid();
    const lineaId = oid();
    const recepcionId = oid();
    let solicitud = null;
    if (withOrigen) {
      solicitud = {
        _id: oid(), tenantId: T, nombre: 'Sensor', Cantidad: '2', EstadoSolicitud: 'Solicitado', ResponsableSolicitud: responsable,
        requisicion: { requisicionId: _id, lineaId, consecutivo: 'REQ-2026-0001', disponibilidad: 'Recibida', cantidadConfirmada: 0 },
      };
      solicitudes.push(solicitud);
    }
    const req = w.seedRequisicion({
      _id, estado, solicitanteId: solicitante,
      lineas: [{
        lineaId, descripcion: 'Sensor', unidad: 'und', cantidadSolicitada: 2, precioEstimado: 10, estadoLinea: 'Recibida',
        cantidadRecibida: 2, cantidadConfirmada: 0, ...(solicitud ? { origenSolicitudRepuestoId: solicitud._id } : {}), ...line,
      }, ...extraLines],
      recepciones: [{
        recepcionId, fecha: new Date(), recibidaPor, evidencias: [], items: [{ lineaId, cantidadRecibida: 2, ...rec }],
      }],
    });
    return { req, id: _id, lineaId, recepcionId, solicitud, responsable, solicitante, recibidaPor };
  }

  const line = (id, lineaId) => w.requisiciones.find((r) => r._id === id).lineas.find((l) => String(l.lineaId) === String(lineaId));
  const doc = (id) => w.requisiciones.find((r) => r._id === id);

  function restore() {
    Repuestos.find = saved.find;
    Repuestos.updateOne = saved.updateOne;
    RepuestoTrazabilidad.create = saved.trace;
    Object.assign(svc.deps, realDeps);
    w.restore();
  }
  return { w, solicitudes, traces, stock, seed, line, doc, restore };
}

export const confirmItems = (lineaId, resultado = 'Recibido', extra = {}) => ({ items: [{ lineaId, resultado, ...extra }] });
export const user = (userId = oid(), canManageAll = false) => ({ userId, name: 'Usuario', canManageAll });
