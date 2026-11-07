/**
 * requisiciones-e4-oc-recepcion, tasks 1.10 / 2.5 (unit level, no database): constants and transition table, pure
 * calculations (excess at the exact margin, estimate 0), payload validation, strict DTOs, escaped PDF HTML, public/internal
 * DTO allowlists, model write guards, scripts filters and notification builders.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import {
  ENTREGA_ESTADO_VALUES, OC_ESTADO_VALUES, REQUISICION_ESTADO as E, REQUISICION_ESTADO_VALUES, REQUISICION_EVENTO_VALUES,
  REQUISICION_TRANSICIONES as T, OC_COUNTER_KEY, OC_MARGEN_REAPROBACION_DEFAULT, PRESUPUESTO_ESTADOS_CONSUMIDO,
} from '../../src/constants/requisicion.constants.js';
import { isTransitionAllowed } from '../../src/services/requisicionTransition.service.js';
import { computeExceso, buildOcLines, parseFechaEntrega } from '../../src/services/requisicionOrdenCompra.service.js';
import { buildOrdenCompraHtml, escapeHtml } from '../../src/services/requisicionOrdenCompraPdf.service.js';
import { findForbiddenRequisicionUpdate } from '../../src/models/requisicion.model.js';
import { toOrdenCompraDto, toPortalOrdenCompra, redactOrdenCompra } from '../../src/utils/requisicionOrdenCompraDto.util.js';
import { toPortalDto } from '../../src/utils/requisicionPortalDto.util.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import {
  emitirOrdenCompraDto, editarOrdenCompraDto, aprobarOrdenCompraDto, rechazarOrdenCompraDto, devolverEntregablesDto, subirEntregablesDto,
} from '../../src/dtos/requisicionOrdenCompra.dto.js';
import { PERMISSIONS, PERMISSIONS_BY_RESOURCE } from '../../src/constants/permissions.js';
import { NOTIFICATION_EVENTS } from '../../src/config/notificationEvents.js';
import { REQUISICION_PAYLOAD_BUILDERS } from '../../src/services/notifications/requisicionPayload.util.js';
import { E4_PERMISSIONS, E4_ROLE_FILTER } from '../../scripts/2026-11-04-backfill-requisiciones-permisos-e4.js';
import { REQUISICION_E4_EVENTS } from '../../scripts/seed-notification-rules-requisiciones-e4.js';
import { diasDesdeEntorno } from '../../scripts/requisiciones-recordatorios.mjs';
import { parseFlags } from '../../scripts/lib/parse-flags.js';
import router from '../../src/routes/requisicion.routes.js';
import { maskEmail } from '../../src/services/requisicionOrdenCompraEnvio.service.js';

const oid = () => new mongoose.Types.ObjectId();
const run = (mw, req) => { let err; mw(req, {}, (e) => { err = e; }); return err; };
const line = (over = {}) => ({ lineaId: oid(), descripcion: 'Sensor', cantidadSolicitada: 3, estadoLinea: 'Pendiente', ...over });

describe('E4 constants: states, transitions, events, permissions', () => {
  it('adds the four OC states additively and the documented transitions', () => {
    for (const s of ['OC_Emitida', 'OC_En_Reaprobacion', 'OC_Aprobada', 'OC_Enviada']) assert.ok(REQUISICION_ESTADO_VALUES.includes(s), s);
    assert.deepEqual([...T[E.ADJUDICADA]].sort(), [E.CANCELADA, E.CERRADA, E.OC_EMITIDA].sort());
    assert.deepEqual([...T[E.OC_EMITIDA]].sort(), [E.ADJUDICADA, E.CANCELADA, E.OC_APROBADA, E.OC_EN_REAPROBACION].sort());
    assert.deepEqual([...T[E.OC_EN_REAPROBACION]].sort(), [E.CANCELADA, E.OC_APROBADA, E.OC_EMITIDA].sort());
    assert.deepEqual([...T[E.OC_APROBADA]].sort(), [E.CANCELADA, E.OC_ENVIADA].sort());
    assert.deepEqual([...T[E.OC_ENVIADA]].sort(), [E.CANCELADA, E.CERRADA, E.EN_RECEPCION].sort());
    assert.equal(isTransitionAllowed(E.ADJUDICADA, E.EN_RECEPCION), false, 'the shortcut is gone');
    assert.equal(isTransitionAllowed(E.APROBADA, E.EN_RECEPCION), true, 'no-purchase flow kept');
    for (const s of [E.OC_EMITIDA, E.OC_EN_REAPROBACION, E.OC_APROBADA, E.OC_ENVIADA]) assert.ok(PRESUPUESTO_ESTADOS_CONSUMIDO.includes(s), s);
  });

  it('registers the OC and deliverable events, the sub-states and the counter key', () => {
    for (const ev of ['OC_EMITIDA', 'OC_EDITADA', 'OC_REAPROBACION_REQUERIDA', 'OC_APROBADA', 'OC_RECHAZADA', 'OC_ENVIADA', 'OC_REENVIADA',
      'ENTREGABLES_RECIBIDOS', 'PASO_REVISION_ENTREGA', 'DEVUELTA', 'ENTREGABLES_ACEPTADOS', 'RECORDATORIO_ENVIADO']) {
      assert.ok(REQUISICION_EVENTO_VALUES.includes(ev), ev);
    }
    assert.deepEqual([...ENTREGA_ESTADO_VALUES], ['Pendiente', 'Recibidos', 'En_Revision', 'Devolucion', 'Aceptados']);
    assert.deepEqual([...OC_ESTADO_VALUES], ['Emitida', 'En_Reaprobacion', 'Aprobada', 'Enviada']);
    assert.equal(OC_COUNTER_KEY(2026), 'ordenes-compra:2026');
    assert.equal(OC_MARGEN_REAPROBACION_DEFAULT, 10);
  });

  it('the three permissions exist under the requisiciones resource and in the E4 backfill', () => {
    for (const p of ['issue-po', 'approve-po', 'manage-deliverables']) {
      assert.ok(PERMISSIONS_BY_RESOURCE.requisiciones.includes(`requisiciones:${p}`), p);
    }
    assert.deepEqual([...E4_PERMISSIONS].sort(), [PERMISSIONS.REQUISICIONES_APPROVE_PO, PERMISSIONS.REQUISICIONES_ISSUE_PO, PERMISSIONS.REQUISICIONES_MANAGE_DELIVERABLES].sort());
  });

  it('the backfill filter targets admin / system roles only, never default roles, and only roles missing a permission', () => {
    assert.deepEqual(E4_ROLE_FILTER.isDefault, { $ne: true });
    assert.deepEqual(E4_ROLE_FILTER.isDeleted, { $ne: true });
    assert.equal(E4_ROLE_FILTER.$and[0].$or.length, 2);
    assert.equal(E4_ROLE_FILTER.$and[1].$or.length, 3);
  });

  it('the notification rules seed and the event catalog agree with the payload builders', () => {
    for (const e of REQUISICION_E4_EVENTS) {
      assert.ok(NOTIFICATION_EVENTS.includes(e), e);
      assert.equal(typeof REQUISICION_PAYLOAD_BUILDERS[e], 'function', e);
      const p = REQUISICION_PAYLOAD_BUILDERS[e]({ requisicionId: 'r1', consecutivo: 'REQ-1', ocNumero: 'OC-1', actorName: 'Ana', reason: 'x' });
      assert.match(p.title, /REQ-1/);
      assert.ok(p.data.link.startsWith('/requisiciones/r1'));
    }
  });

  it('reminder thresholds come from the environment with a default of 3 days', () => {
    assert.equal(diasDesdeEntorno(undefined), 3);
    assert.equal(diasDesdeEntorno('5'), 5);
    assert.equal(diasDesdeEntorno('0'), 3);
    assert.equal(diasDesdeEntorno('abc'), 3);
    assert.equal(diasDesdeEntorno('-2'), 3);
  });
});

describe('computeExceso: the exact margin and the estimate 0', () => {
  it('the boundary itself is not excess; one cent above is', () => {
    assert.equal(computeExceso({ estimado: 1000000, total: 1100000, margenPct: 10 }).requerido, false);
    assert.equal(computeExceso({ estimado: 1000000, total: 1100000.01, margenPct: 10 }).requerido, true);
    assert.equal(computeExceso({ estimado: 1000000, total: 1100001, margenPct: 10 }).requerido, true);
    assert.equal(computeExceso({ estimado: 1000000, total: 999999, margenPct: 10 }).requerido, false);
  });
  it('margin 0 and 100, fractional margins and huge amounts keep exact integer math', () => {
    assert.equal(computeExceso({ estimado: 100, total: 100, margenPct: 0 }).requerido, false);
    assert.equal(computeExceso({ estimado: 100, total: 100.01, margenPct: 0 }).requerido, true);
    assert.equal(computeExceso({ estimado: 100, total: 200, margenPct: 100 }).requerido, false);
    assert.equal(computeExceso({ estimado: 100, total: 200.01, margenPct: 100 }).requerido, true);
    assert.equal(computeExceso({ estimado: 1000, total: 1005, margenPct: 0.5 }).requerido, false);
    assert.equal(computeExceso({ estimado: 1000, total: 1005.01, margenPct: 0.5 }).requerido, true);
    assert.equal(computeExceso({ estimado: 9e12, total: 9.9e12, margenPct: 10 }).requerido, false);
    assert.equal(computeExceso({ estimado: 9e12, total: 9.9e12 + 0.01, margenPct: 10 }).requerido, true);
  });
  it('an estimate of 0 always requires re-approval, whatever the total; a missing margin falls back to 10 %', () => {
    assert.equal(computeExceso({ estimado: 0, total: 0, margenPct: 10 }).requerido, true);
    assert.equal(computeExceso({ estimado: 0, total: 1, margenPct: 0 }).requerido, true);
    assert.equal(computeExceso({ estimado: 100, total: 110, margenPct: undefined }).requerido, false);
    assert.equal(computeExceso({ estimado: 100, total: 110.01, margenPct: undefined }).margenPct, 10);
  });
});

describe('buildOcLines: one real price per active line, quantity from the requisition', () => {
  const doc = { lineas: [line({ cantidadSolicitada: 3 }), line({ cantidadSolicitada: 10 }), line({ estadoLinea: 'Cancelada' })] };
  const ids = doc.lineas.map((l) => String(l.lineaId));
  it('computes subtotals and total in the server (rounded to cents) and skips cancelled lines', () => {
    const out = buildOcLines(doc, [{ lineaId: ids[0], precioUnitario: 100.333 }, { lineaId: ids[1], precioUnitario: 0 }]);
    assert.equal(out.lineas.length, 2);
    assert.deepEqual(out.lineas.map((l) => l.cantidad), [3, 10]);
    assert.equal(out.lineas[0].subtotal, 301);
    assert.equal(out.total, 301);
  });
  it('rejects missing, negative, non numeric, infinite, repeated, foreign and cancelled lines', () => {
    const ok = [{ lineaId: ids[0], precioUnitario: 1 }, { lineaId: ids[1], precioUnitario: 1 }];
    const code = (input) => { try { buildOcLines(doc, input); return 'ok'; } catch (e) { return e.code; } };
    assert.equal(code(ok), 'ok');
    assert.equal(code([ok[0]]), 'PRECIO_FALTANTE');
    assert.equal(code([]), 'PRECIO_FALTANTE');
    assert.equal(code([ok[0], { ...ok[1], precioUnitario: -0.01 }]), 'PRECIO_INVALIDO');
    assert.equal(code([ok[0], { ...ok[1], precioUnitario: '5' }]), 'PRECIO_INVALIDO');
    assert.equal(code([ok[0], { ...ok[1], precioUnitario: Infinity }]), 'PRECIO_INVALIDO');
    assert.equal(code([ok[0], { ...ok[1], precioUnitario: undefined }]), 'PRECIO_INVALIDO');
    assert.equal(code([ok[0], ok[0], ok[1]]), 'LINEA_REPETIDA');
    assert.equal(code([...ok, { lineaId: String(oid()), precioUnitario: 1 }]), 'LINEA_NO_ENCONTRADA');
    assert.equal(code([...ok, { lineaId: String(doc.lineas[2].lineaId), precioUnitario: 1 }]), 'LINEA_NO_ENCONTRADA');
    assert.equal(code(null), 'PRECIO_FALTANTE');
  });
  it('a quantity sent by the client is ignored (it always comes from the requisition)', () => {
    const out = buildOcLines(doc, [{ lineaId: ids[0], precioUnitario: 1, cantidad: 999 }, { lineaId: ids[1], precioUnitario: 1 }]);
    assert.equal(out.lineas[0].cantidad, 3);
  });
});

describe('parseFechaEntrega', () => {
  it('accepts today or later, refuses the past and garbage', () => {
    const now = new Date('2026-11-04T15:00:00Z');
    assert.ok(parseFechaEntrega('2026-11-04T05:00:00.000Z', now));
    assert.ok(parseFechaEntrega(new Date('2027-01-01'), now));
    for (const bad of ['2026-11-03T04:00:00Z', '', null, undefined, 'x']) {
      assert.throws(() => parseFechaEntrega(bad, now), (e) => e.statusCode === 400 && e.code === 'FECHA_ENTREGA_INVALIDA', String(bad));
    }
  });
});

describe('PDF HTML is escaped', () => {
  const evil = '<img src=x onerror=alert(1)> "q" \'s\' & <script>1</script>';
  const oc = {
    numero: `OC-2026-0001${evil}`, version: 2, moneda: 'COP', total: 1500, emitidaEn: new Date(), fechaEntrega: new Date(), condiciones: `${evil}\nlinea 2`, requiereEntregables: true,
    lineas: [{ descripcion: evil, cantidad: 2, precioUnitario: 750, subtotal: 1500 }],
  };
  it('no value reaches the document unescaped; line breaks of the conditions become <br/> after escaping', () => {
    const html = buildOrdenCompraHtml(oc, { tenantNombre: evil, consecutivo: evil, titulo: evil, proveedorNombre: evil });
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('<script>1'));
    assert.ok(!html.includes('onerror=alert(1)>'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(html.includes('&lt;script&gt;1&lt;/script&gt;<br/>linea 2'));
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(5), '5');
  });
  it('shows no approval data and no estimate', () => {
    const html = buildOrdenCompraHtml({ ...oc, exceso: { requerido: true, estimado: 5 }, aprobacion: { niveles: [{ nombre: 'Nivel secreto' }] } }, {});
    assert.ok(!html.includes('Nivel secreto'));
    assert.ok(!/estimad/i.test(html));
  });
});

describe('DTOs: strict allowlists', () => {
  const lin = { lineaId: String(oid()), precioUnitario: 10 };
  const base = { lineas: [lin], fechaEntrega: '2030-01-01', requiereEntregables: false };
  it('emit / edit accept the contract and refuse every protected field', () => {
    for (const dto of [emitirOrdenCompraDto, editarOrdenCompraDto]) {
      assert.equal(run(validate(dto), { body: base }), undefined);
      assert.equal(run(validate(dto), { body: { ...base, condiciones: 'x' } }), undefined);
      for (const f of ['total', 'numero', 'estado', 'emitidaPor', 'tenantId', 'version', 'exceso', 'aprobacion', 'entrega', 'moneda', 'isDeleted']) {
        assert.equal(run(validate(dto), { body: { ...base, [f]: 'x' } })?.statusCode, 400, f);
      }
      assert.equal(run(validate(dto), { body: { ...base, lineas: [{ ...lin, cantidad: 5 }] } })?.statusCode, 400, 'quantity is not accepted');
      assert.equal(run(validate(dto), { body: { ...base, lineas: [{ ...lin, subtotal: 5 }] } })?.statusCode, 400);
      assert.equal(run(validate(dto), { body: { ...base, lineas: [] } })?.statusCode, 400);
      assert.equal(run(validate(dto), { body: { ...base, lineas: [{ ...lin, precioUnitario: '10' }] } })?.statusCode, 400);
      assert.equal(run(validate(dto), { body: { ...base, lineas: [{ ...lin, precioUnitario: -1 }] } })?.statusCode, 400);
      assert.equal(run(validate(dto), { body: { ...base, requiereEntregables: 'true' } })?.statusCode, 400);
      assert.equal(run(validate(dto), { body: { ...base, fechaEntrega: undefined } })?.statusCode, 400);
      assert.equal(run(validate(dto), { body: { ...base, requiereEntregables: undefined } })?.statusCode, 400);
    }
  });
  it('approve / reject / return payloads', () => {
    assert.equal(run(validate(aprobarOrdenCompraDto), { body: {} }), undefined);
    assert.equal(run(validate(aprobarOrdenCompraDto), { body: { version: 2 } }), undefined);
    assert.equal(run(validate(aprobarOrdenCompraDto), { body: { estado: 'OC_Aprobada' } })?.statusCode, 400);
    assert.equal(run(validate(rechazarOrdenCompraDto), { body: {} })?.statusCode, 400);
    assert.equal(run(validate(rechazarOrdenCompraDto), { body: { observacion: 'no' } }), undefined);
    assert.equal(run(validate(rechazarOrdenCompraDto), { body: { observacion: 'no', tenantId: 'x' } })?.statusCode, 400);
    assert.equal(run(validate(devolverEntregablesDto), { body: {} })?.statusCode, 400);
    assert.equal(run(validate(devolverEntregablesDto), { body: { observacion: 'Falta la factura' } }), undefined);
    assert.equal(run(validate(subirEntregablesDto), { body: {} }), undefined);
    assert.equal(run(validate(subirEntregablesDto), { body: { estado: 'Aceptados' } })?.statusCode, 400);
  });
});

describe('DTO allowlists of the OC block', () => {
  const stored = {
    numero: 'OC-2026-0001', version: 2, estado: 'Enviada', total: 1500, moneda: 'COP', condiciones: 'Pago a 30', fechaEntrega: new Date(), requiereEntregables: true,
    lineas: [{ lineaId: oid(), descripcion: 'A', cantidad: 2, precioUnitario: 750, subtotal: 1500, secreto: 'x' }],
    emitidaPor: { _id: oid(), firstName: 'Ana', lastName: 'Gil' }, emitidaEn: new Date(),
    exceso: { requerido: true, estimado: 100, total: 1500, margenPct: 10 },
    aprobacion: { niveles: [{ orden: 1, estado: 'Aprobado' }], nivelActual: null },
    aprobadaPor: { _id: oid(), firstName: 'Beto', lastName: 'Paz' }, aprobadaEn: new Date(),
    envio: { enviadaEn: new Date(), estadoCorreo: 'Enviado' },
    entrega: { estado: 'Devolucion', ultimaObservacion: 'Falta factura', ultimoRecordatorio: null, devueltaAt: new Date(),
      archivos: [{ url: 'https://f/x.pdf', nombre: 'x.pdf', tipo: 'application/pdf', tamano: 10, storagePath: 'tenants/t/secret', subidoPor: 'proveedor', fecha: new Date(), usuarioId: oid() }] },
  };
  it('internal DTO: contract keys, no storage path, entrega null when not required, null without OC', () => {
    const d = toOrdenCompraDto(stored);
    assert.deepEqual(Object.keys(d).sort(), ['aprobacion', 'aprobadaEn', 'aprobadaPor', 'condiciones', 'editadaPor', 'emitidaEn', 'emitidaPor', 'entrega', 'envio', 'estado', 'exceso',
      'fechaEntrega', 'lineas', 'moneda', 'numero', 'requiereEntregables', 'total', 'version'].sort());
    assert.deepEqual(d.emitidaPor, { usuarioId: String(stored.emitidaPor._id), nombre: 'Ana Gil' });
    assert.equal(d.entrega.estado, 'Devolucion');
    assert.deepEqual(Object.keys(d.entrega.archivos[0]).sort(), ['fecha', 'nombre', 'subidoPor', 'tamano', 'tipo', 'url']);
    assert.ok(!JSON.stringify(d).includes('secret'));
    assert.ok(!('secreto' in d.lineas[0]));
    assert.equal(toOrdenCompraDto({ ...stored, requiereEntregables: false }).entrega, null);
    assert.equal(toOrdenCompraDto(undefined), null);
    assert.equal(toOrdenCompraDto({}), null);
  });
  it('portal DTO: only the allowlisted fields (no estimate, no approval, no issuer, no ids)', () => {
    const p = toPortalOrdenCompra(stored);
    assert.deepEqual(Object.keys(p).sort(), ['condiciones', 'entrega', 'fechaEntrega', 'lineas', 'moneda', 'numero', 'requiereEntregables', 'total', 'version']);
    assert.deepEqual(Object.keys(p.lineas[0]).sort(), ['cantidad', 'descripcion', 'precioUnitario', 'subtotal']);
    assert.deepEqual(Object.keys(p.entrega).sort(), ['archivos', 'estado', 'ultimaObservacion']);
    const text = JSON.stringify(p);
    for (const leak of ['secret', 'Ana', 'Beto', 'exceso', 'aprobacion', 'storagePath', 'usuarioId', 'margenPct']) assert.ok(!text.includes(leak), leak);
    const view = toPortalDto({ consecutivo: 'REQ-1', items: [], ordenCompra: stored }, { estadoEnvio: 'Ganador' }, { tenantNombre: 't', cerrada: true });
    assert.equal(view.ordenCompra.numero, 'OC-2026-0001');
    assert.ok(!('ordenCompra' in toPortalDto({ consecutivo: 'REQ-1', items: [] }, { estadoEnvio: 'Ganador' }, { tenantNombre: 't', cerrada: true })));
  });
  it('redaction removes the real prices and the approval data but keeps the state', () => {
    const r = redactOrdenCompra(toOrdenCompraDto(stored));
    assert.equal(r.total, null);
    assert.equal(r.condiciones, null);
    assert.ok(r.lineas.every((l) => l.precioUnitario === null && l.subtotal === null));
    assert.deepEqual(r.aprobacion, { niveles: [], nivelActual: null });
    assert.equal(r.exceso.estimado, 0);
    assert.equal(r.estado, 'Enviada');
  });
});

describe('model write guards of ordenCompra', () => {
  const f = (update, options) => findForbiddenRequisicionUpdate(update, options);
  const pinned = { filter: { _id: oid(), tenantId: 't', estado: 'Adjudicada' } };
  it('allows leaf $set, appending files, and the whole block only when the filter pins Adjudicada', () => {
    assert.equal(f({ $set: { 'ordenCompra.estado': 'Aprobada', 'ordenCompra.aprobadaEn': new Date(), 'ordenCompra.aprobacion.niveles': [] } }), null);
    assert.equal(f({ $set: { 'ordenCompra.entrega.estado': 'Recibidos' }, $push: { 'ordenCompra.entrega.archivos': { $each: [{ url: 'u' }] } } }), null);
    assert.equal(f({ $set: { ordenCompra: { numero: 'OC-1' } } }, pinned), null);
    assert.equal(f({ $set: { ordenCompra: { numero: 'OC-1' } } }, { filter: { $and: [{ _id: oid(), tenantId: 't', estado: 'Adjudicada' }] } }), null);
  });
  it('refuses everything else', () => {
    const code = (u, o) => f(u, o)?.code;
    assert.equal(code({ $set: { ordenCompra: { numero: 'X' } } }), 'ORDEN_COMPRA_INMUTABLE');
    assert.equal(code({ $set: { ordenCompra: { numero: 'X' } } }, { filter: { estado: 'OC_Emitida' } }), 'ORDEN_COMPRA_INMUTABLE');
    assert.equal(code({ ordenCompra: { numero: 'X' } }), 'ORDEN_COMPRA_INMUTABLE');
    assert.equal(code({ $set: { 'ordenCompra.numero': 'X' } }), 'ORDEN_COMPRA_INMUTABLE');
    assert.equal(code({ $set: { 'ordenCompra.emitidaPor': oid() } }), 'ORDEN_COMPRA_INMUTABLE');
    assert.equal(code({ $set: { 'ordenCompra.entrega': {} } }), 'ORDEN_COMPRA_INMUTABLE');
    assert.equal(code({ $set: { 'ordenCompra.entrega.archivos': [] } }), 'ORDEN_COMPRA_INMUTABLE');
    assert.equal(code({ $unset: { ordenCompra: 1 } }), 'ORDEN_COMPRA_INMUTABLE');
    assert.equal(code({ $unset: { 'ordenCompra.entrega': 1 } }), 'ORDEN_COMPRA_INMUTABLE');
    assert.equal(code({ $inc: { 'ordenCompra.version': 1 } }), 'ORDEN_COMPRA_INMUTABLE');
    assert.equal(code({ $pull: { 'ordenCompra.entrega.archivos': {} } }), 'ORDEN_COMPRA_INMUTABLE');
    assert.equal(code({ $push: { 'ordenCompra.lineas': {} } }), 'ORDEN_COMPRA_INMUTABLE');
    assert.equal(code({ $push: { 'ordenCompra.entrega.archivos': { $each: [{}], $position: 0 } } }), 'ORDEN_COMPRA_INMUTABLE');
    assert.equal(code({ $rename: { ordenCompra: 'x' } }), 'ORDEN_COMPRA_INMUTABLE');
    assert.equal(code({ $addToSet: { 'ordenCompra.lineas': {} } }), 'ORDEN_COMPRA_INMUTABLE');
    assert.equal(code([{ $set: { ordenCompra: {} } }]), 'TIMELINE_INMUTABLE');
  });
});

describe('B1: date-only delivery date', () => {
  const now = new Date('2026-11-05T17:00:00Z'); // 12:00 in Bogota
  it('YYYY-MM-DD is that Bogota calendar day (stored at local midnight); today is allowed, yesterday is not', () => {
    assert.equal(parseFechaEntrega('2026-11-05', now).toISOString(), '2026-11-05T05:00:00.000Z');
    assert.equal(parseFechaEntrega('2026-12-31', now).toISOString(), '2026-12-31T05:00:00.000Z');
    assert.throws(() => parseFechaEntrega('2026-11-04', now), (e) => e.code === 'FECHA_ENTREGA_INVALIDA');
    assert.throws(() => parseFechaEntrega('2027-02-30', now), (e) => e.code === 'FECHA_ENTREGA_INVALIDA');
    assert.throws(() => parseFechaEntrega('2027-13-01', now), (e) => e.code === 'FECHA_ENTREGA_INVALIDA');
  });
  it('late evening in Bogota is still "today" (UTC already tomorrow)', () => {
    const late = new Date('2026-11-06T03:30:00Z'); // 22:30 of the 5th in Bogota
    assert.ok(parseFechaEntrega('2026-11-05', late));
    assert.throws(() => parseFechaEntrega('2026-11-04', late), (e) => e.code === 'FECHA_ENTREGA_INVALIDA');
  });
  it('the PDF prints the same calendar day that was chosen', () => {
    const d = parseFechaEntrega('2026-11-05', now);
    const html = buildOrdenCompraHtml({ numero: 'OC-1', version: 1, moneda: 'COP', total: 1, fechaEntrega: d, emitidaEn: d, lineas: [] }, {});
    assert.ok(html.includes('5 de noviembre de 2026'));
    assert.ok(!html.includes('4 de noviembre de 2026'));
  });
  it('the DTOs accept date-only and full ISO and keep the string untouched', () => {
    const lin = { lineaId: String(oid()), precioUnitario: 1 };
    const req = { body: { lineas: [lin], fechaEntrega: '2030-01-01', requiereEntregables: false } };
    assert.equal(run(validate(emitirOrdenCompraDto), req), undefined);
    assert.equal(req.body.fechaEntrega, '2030-01-01');
    assert.equal(run(validate(editarOrdenCompraDto), { body: { lineas: [lin], fechaEntrega: '2030-01-01T10:00:00Z', requiereEntregables: true } }), undefined);
    assert.equal(run(validate(emitirOrdenCompraDto), { body: { lineas: [lin], fechaEntrega: '01/01/2030', requiereEntregables: true } })?.statusCode, 400);
  });
});

describe('script flags are strict (a typo never falls back to writing)', () => {
  const spec = { boolean: ['dry-run'], value: ['tenant'] };
  it('accepts the declared flags', () => {
    assert.deepEqual(parseFlags([], spec), {});
    assert.deepEqual(parseFlags(['--dry-run', '--tenant=acme'], spec), { 'dry-run': true, tenant: 'acme' });
  });
  it('rejects unknown flags, empty values and values on booleans', () => {
    for (const bad of [['--dryrun'], ['--dry-run=false'], ['--tenant='], ['--tenant= '], ['--tenant'], ['dry-run'], ['-d'], ['--force']]) {
      assert.throws(() => parseFlags(bad, spec), Error, bad.join(' '));
    }
    assert.throws(() => parseFlags(['--tenant=x'], { boolean: ['dry-run'] }));
  });
});

describe('M2 route level, M5 masking, security 7 redaction', () => {
  it('aprobar / rechazar are open to approve-po OR approve at route level, and to nobody else', () => {
    const routes = router.stack.filter((l) => l.route);
    for (const path of ['/:id/orden-compra/aprobar', '/:id/orden-compra/rechazar']) {
      const r = routes.find((x) => x.route.path === path);
      const guard = r.route.stack[0].handle;
      const go = (permissions) => { let err; guard({ user: { userId: 'u', tenantId: 't', role: 'user', permissions } }, {}, (e) => { err = e; }); return err; };
      assert.equal(go([PERMISSIONS.REQUISICIONES_APPROVE_PO]), undefined, path);
      assert.equal(go([PERMISSIONS.REQUISICIONES_APPROVE]), undefined, path);
      assert.equal(go([PERMISSIONS.REQUISICIONES_ISSUE_PO])?.statusCode, 403, path);
    }
  });
  it('maskEmail keeps no full address', () => {
    assert.equal(maskEmail('juan.perez@prov.co'), 'ju***@prov.co');
    assert.ok(!maskEmail('a@b.co').includes('a@'));
  });
  it('redaction also drops the file URLs of the deliverables', () => {
    const r = redactOrdenCompra({ lineas: [], entrega: { estado: 'Recibidos', archivos: [{ url: 'https://x/secret.pdf', nombre: 'a.pdf', storagePath: 'p', subidoPor: 'proveedor' }] } });
    assert.equal(r.entrega.archivos[0].url, null);
    assert.ok(!JSON.stringify(r).includes('secret') && !JSON.stringify(r).includes('"p"'));
    assert.equal(r.entrega.archivos[0].nombre, 'a.pdf');
    assert.equal(redactOrdenCompra({ lineas: [], entrega: null }).entrega, null);
  });
});
