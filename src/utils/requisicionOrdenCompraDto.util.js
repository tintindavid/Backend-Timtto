import { ENTREGA_ESTADO, OC_ESTADO } from '../constants/requisicion.constants.js';

/**
 * Output shapes of the purchase order (E4). Built FIELD BY FIELD (allowlist): the internal storage path of a file and any
 * future internal field can never leak through a spread of the stored document.
 *  - `toOrdenCompraDto`: internal detail block (`ordenCompra` inside the requisition).
 *  - `toPortalOrdenCompra`: the winner's view in the public portal (no approval data, no estimated amount).
 */

const idOf = (v) => (v === null || v === undefined ? null : String(v?._id ?? v));
const num = (v) => (v === undefined || v === null ? null : Number(v));

/** `{ usuarioId, nombre }` of a populated (or bare) user reference; null when absent. */
export function toUserRef(u) {
  if (u === null || u === undefined) return null;
  const nombre = u && typeof u === 'object' ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() : '';
  return { usuarioId: idOf(u), nombre: nombre || null };
}

export function toEntregaArchivoDto(a) {
  return {
    url: a.url ?? null,
    nombre: a.nombre ?? null,
    tipo: a.tipo ?? null,
    tamano: a.tamano ?? null,
    subidoPor: a.subidoPor ?? null,
    fecha: a.fecha ?? null,
  };
}

export function toEntregaDto(e) {
  const src = e || {};
  return {
    estado: src.estado || ENTREGA_ESTADO.PENDIENTE,
    archivos: (src.archivos || []).map(toEntregaArchivoDto),
    ultimaObservacion: src.ultimaObservacion ?? null,
    ultimoRecordatorio: src.ultimoRecordatorio ?? null,
  };
}

/** Internal block; null when the requisition has no purchase order. */
export function toOrdenCompraDto(oc) {
  if (!oc || !oc.numero) return null;
  const ex = oc.exceso || {};
  const aprob = oc.aprobacion || {};
  return {
    numero: oc.numero,
    version: Number(oc.version) || 1,
    estado: oc.estado || OC_ESTADO.EMITIDA,
    lineas: (oc.lineas || []).map((l) => ({
      lineaId: idOf(l.lineaId),
      descripcion: l.descripcion ?? null,
      cantidad: num(l.cantidad),
      precioUnitario: num(l.precioUnitario),
      subtotal: num(l.subtotal),
    })),
    total: num(oc.total),
    moneda: oc.moneda ?? null,
    condiciones: oc.condiciones ?? null,
    fechaEntrega: oc.fechaEntrega ?? null,
    requiereEntregables: Boolean(oc.requiereEntregables),
    emitidaPor: toUserRef(oc.emitidaPor),
    emitidaEn: oc.emitidaEn ?? null,
    editadaPor: toUserRef(oc.editadaPor),
    exceso: {
      requerido: Boolean(ex.requerido),
      estimado: num(ex.estimado) ?? 0,
      total: num(ex.total) ?? 0,
      margenPct: num(ex.margenPct) ?? 0,
    },
    aprobacion: {
      niveles: Array.isArray(aprob.niveles) ? aprob.niveles : [],
      nivelActual: aprob.nivelActual ?? null,
    },
    aprobadaPor: toUserRef(oc.aprobadaPor),
    aprobadaEn: oc.aprobadaEn ?? null,
    envio: {
      enviadaEn: oc.envio?.enviadaEn ?? null,
      estadoCorreo: oc.envio?.estadoCorreo ?? null,
    },
    // Only an OC that requires deliverables has a delivery to follow.
    entrega: oc.requiereEntregables ? toEntregaDto(oc.entrega) : null,
  };
}

/**
 * Winner's portal view: header data the supplier needs to fulfil the order, plus the state of the deliverables and the
 * last return observation. NEVER the estimate, the excess, the approval levels, the issuer or internal ids.
 */
export function toPortalOrdenCompra(oc) {
  if (!oc || !oc.numero) return null;
  return {
    numero: oc.numero,
    version: Number(oc.version) || 1,
    lineas: (oc.lineas || []).map((l) => ({
      descripcion: l.descripcion ?? null,
      cantidad: num(l.cantidad),
      precioUnitario: num(l.precioUnitario),
      subtotal: num(l.subtotal),
    })),
    total: num(oc.total),
    moneda: oc.moneda ?? null,
    condiciones: oc.condiciones ?? null,
    fechaEntrega: oc.fechaEntrega ?? null,
    requiereEntregables: Boolean(oc.requiereEntregables),
    entrega: oc.requiereEntregables
      ? {
        estado: oc.entrega?.estado || ENTREGA_ESTADO.PENDIENTE,
        archivos: (oc.entrega?.archivos || []).map(toEntregaArchivoDto),
        ultimaObservacion: oc.entrega?.ultimaObservacion ?? null,
      }
      : null,
  };
}

/** Prices and approval data removed (viewers without access to purchasing). */
export function redactOrdenCompra(oc) {
  if (!oc) return oc;
  return {
    ...oc,
    lineas: (oc.lineas || []).map((l) => ({ ...l, precioUnitario: null, subtotal: null })),
    total: null,
    condiciones: null,
    exceso: { requerido: Boolean(oc.exceso?.requerido), estimado: 0, total: 0, margenPct: 0 },
    aprobacion: { niveles: [], nivelActual: null },
    // the supports of the supplier are as sensitive as the prices (the URL is the access)
    entrega: oc.entrega
      ? { ...oc.entrega, archivos: (oc.entrega.archivos || []).map(({ url: _u, storagePath: _s, ...rest }) => ({ ...rest, url: null })) }
      : oc.entrega,
  };
}
