/**
 * Output shapes of the tendering block (E3). Built FIELD BY FIELD (allowlist): `tokenHash`, the access log (`vistas`) and
 * any future internal field can never leak through a spread of the stored document.
 */

const idOf = (v) => (v === null || v === undefined ? null : String(v?._id ?? v));

/** Quotation as stored -> response shape. Null when the supplier has not quoted yet. */
export function toCotizacionDto(c) {
  if (!c) return null;
  const arch = (a) => (a && a.url ? { url: a.url, nombre: a.nombre ?? null, tipo: a.tipo ?? null, tamano: a.tamano ?? null } : null);
  const archivo = arch(c.archivo);
  return {
    archivo,
    linkPropuesta: c.linkPropuesta ?? null,
    observacion: c.observacion ?? null,
    valorTotal: c.valorTotal ?? null,
    moneda: c.moneda ?? null,
    tiempoEntregaDias: c.tiempoEntregaDias ?? null,
    fechaRespuesta: c.fechaRespuesta ?? null,
    origen: c.origen ?? null,
    registradaPor: idOf(c.registradaPor),
    // Previous submissions, oldest first (internal responses only; the portal never receives them).
    versiones: (c.versiones || []).map((v) => ({
      fechaRespuesta: v.fechaRespuesta ?? null,
      archivo: arch(v.archivo),
      linkPropuesta: v.linkPropuesta ?? null,
      observacion: v.observacion ?? null,
      valorTotal: v.valorTotal ?? null,
      moneda: v.moneda ?? null,
      origen: v.origen ?? null,
    })),
  };
}

export function toProveedorLicitacionDto(p) {
  return {
    _id: idOf(p._id),
    proveedorId: idOf(p.proveedorId),
    nombre: p.nombre ?? null,
    correoEnvio: p.correoEnvio ?? null,
    tokenHint: p.tokenHint ?? null,
    estadoEnvio: p.estadoEnvio,
    fechaEnvio: p.fechaEnvio ?? null,
    cotizacion: toCotizacionDto(p.cotizacion),
    tieneCotizacion: Boolean(p.cotizacion),
    vistasCount: Number(p.vistasCount) || 0,
  };
}

/** Internal tendering block. Always present (empty when the requisition never had a tender). */
export function toLicitacionDto(l) {
  const src = l || {};
  const cd = src.compraDirecta || null;
  return {
    fechaLimiteCotizacion: src.fechaLimiteCotizacion ?? null,
    instrucciones: src.instrucciones || null,
    ganadorId: idOf(src.ganadorId),
    compraDirecta: cd
      ? { proveedorId: idOf(cd.proveedorId), justificacion: cd.justificacion ?? null, porId: idOf(cd.porId), at: cd.at ?? null }
      : null,
    proveedores: (src.proveedores || []).map(toProveedorLicitacionDto),
  };
}
