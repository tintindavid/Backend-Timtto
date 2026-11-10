/**
 * requisiciones-e3-compras-portal, task 1.4: tendering block of the model (guards, token never exposed), constants.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { Requisicion, findForbiddenRequisicionUpdate as forbidden, buildTimelineEvent } from '../../src/models/requisicion.model.js';
import { toPublic } from '../../src/utils/requisicionPublic.util.js';
import { toLicitacionDto } from '../../src/utils/requisicionLicitacionDto.util.js';
import {
  REQUISICION_ESTADO as E,
  REQUISICION_TRANSICIONES as T,
  REQUISICION_EVENTO_VALUES,
  TIMELINE_ACTOR_TIPO,
  LICITACION_MAX_PROVEEDORES,
  LICITACION_MAX_VISTAS,
  LICITACION_MAX_DIAS_LIMITE,
  COMPRA_DIRECTA_MIN_JUSTIFICACION,
} from '../../src/constants/requisicion.constants.js';

const oid = () => new mongoose.Types.ObjectId();
const NO_WINNER = { 'licitacion.ganadorId': null };

describe('E3 constants', () => {
  it('states, transitions and limits', () => {
    assert.deepEqual([...T[E.APROBADA]].sort(), [E.ADJUDICADA, E.CANCELADA, E.CERRADA, E.EN_LICITACION, E.EN_RECEPCION].sort());
    assert.deepEqual([...T[E.EN_LICITACION]].sort(), [E.CANCELADA, E.COTIZACION_RECIBIDA].sort());
    assert.deepEqual([...T[E.COTIZACION_RECIBIDA]].sort(), [E.ADJUDICADA, E.CANCELADA].sort());
    // E4: the awarded goods are received only after the purchase order was sent (no more Adjudicada -> En_Recepcion).
    assert.deepEqual([...T[E.ADJUDICADA]].sort(), [E.CANCELADA, E.CERRADA, E.OC_EMITIDA].sort());
    assert.equal(T[E.ADJUDICADA].includes(E.EN_RECEPCION), false);
    assert.equal(LICITACION_MAX_PROVEEDORES, 25);
    assert.equal(LICITACION_MAX_VISTAS, 200);
    assert.equal(LICITACION_MAX_DIAS_LIMITE, 90);
    assert.equal(COMPRA_DIRECTA_MIN_JUSTIFICACION, 20);
  });

  it('events are registered', () => {
    for (const ev of ['PROVEEDOR_ASIGNADO', 'PROVEEDOR_QUITADO', 'LICITACION_INICIADA', 'INVITACIONES_ENVIADAS', 'INVITACION_ACEPTADA', 'INVITACION_RECHAZADA', 'COTIZACION_RECIBIDA', 'COTIZACIONES_CERRADAS', 'PROVEEDOR_SELECCIONADO', 'PROVEEDOR_DESCARTADO', 'COMPRA_DIRECTA_JUSTIFICADA']) {
      assert.ok(REQUISICION_EVENTO_VALUES.includes(ev), ev);
    }
  });

  it('an external supplier actor carries only a name', () => {
    const e = buildTimelineEvent({ tipo: 'COTIZACION_RECIBIDA', actorExterno: { nombre: 'Proveedor SA' } });
    assert.deepEqual(e.actor, { tipo: TIMELINE_ACTOR_TIPO.PROVEEDOR, nombreExterno: 'Proveedor SA' });
  });
});

describe('licitacion write guards', () => {
  it('allows the legal writes of the tendering services', () => {
    assert.equal(forbidden({ $push: { 'licitacion.proveedores': { $each: [{ proveedorId: oid() }] } } }), null);
    assert.equal(forbidden({ $set: { 'licitacion.fechaLimiteCotizacion': new Date(), 'licitacion.proveedores.$[p].estadoEnvio': 'Enviado' } }, { arrayFilters: [{ 'p._id': oid() }] }), null);
    assert.equal(forbidden({ $push: { 'licitacion.proveedores.$[p].vistas': { $each: [{ ip: '1.1.1.1' }], $slice: -200 } }, $inc: { 'licitacion.proveedores.$[p].vistasCount': 1 } }, { arrayFilters: [{ 'p._id': oid() }] }), null);
    assert.equal(forbidden({ $pull: { 'licitacion.proveedores': { _id: oid() } } }), null);
    assert.equal(forbidden({ $set: { 'licitacion.ganadorId': oid() } }, { filter: { $and: [{ _id: oid(), tenantId: 't' }, NO_WINNER] } }), null);
    assert.equal(forbidden({ $set: { 'licitacion.ganadorId': oid() } }, { filter: NO_WINNER }), null);
  });

  it('rejects replacing the whole block or the whole suppliers array', () => {
    for (const upd of [{ $set: { licitacion: { ganadorId: oid() } } }, { licitacion: { proveedores: [] } }, { $set: { 'licitacion.proveedores': [] } }]) {
      assert.equal(forbidden(upd)?.code, 'LICITACION_INMUTABLE', JSON.stringify(upd));
    }
  });

  it('rejects $unset / $rename / $pop / $addToSet and pipelines on the block', () => {
    for (const upd of [
      { $unset: { 'licitacion.ganadorId': 1 } },
      { $rename: { 'licitacion.ganadorId': 'x' } },
      { $rename: { x: 'licitacion' } },
      { $pop: { 'licitacion.proveedores': 1 } },
      { $addToSet: { 'licitacion.proveedores': {} } },
      { $pull: { 'licitacion.proveedores': { estadoEnvio: 'Enviado' } } },
      { $push: { 'licitacion.proveedores': { $each: [{}], $position: 0 } } },
    ]) {
      assert.ok(forbidden(upd), JSON.stringify(upd));
    }
    assert.ok(forbidden([{ $set: { licitacion: {} } }]));
  });

  it('the winner can only be written with the ganadorId = null condition', () => {
    const upd = { $set: { 'licitacion.ganadorId': oid() } };
    assert.equal(forbidden(upd)?.code, 'LICITACION_INMUTABLE');
    assert.equal(forbidden(upd, { filter: { _id: oid(), tenantId: 't' } })?.code, 'LICITACION_INMUTABLE');
    assert.equal(forbidden(upd, { filter: { 'licitacion.ganadorId': { $exists: false } } })?.code, 'LICITACION_INMUTABLE');
  });

  const base = () => ({ tenantId: 't', consecutivo: 'REQ-1', titulo: 'x', tipoRequisicionId: oid(), areaId: oid(), creadaPor: oid(), solicitanteId: oid(), lineas: [{ descripcion: 'a', unidad: 'u', cantidadSolicitada: 1 }] });

  it('save() of a modified block on an existing document is rejected', async () => {
    const doc = Requisicion.hydrate({ _id: oid(), ...base() });
    doc.licitacion = { proveedores: [{ proveedorId: oid(), nombre: 'P' }] };
    await assert.rejects(doc.save(), (e) => e.code === 'LICITACION_INMUTABLE');
  });

  it('a new document cannot be created with a tendering block', async () => {
    const doc = new Requisicion({ ...base(), licitacion: { ganadorId: oid() } });
    await assert.rejects(doc.save(), (e) => e.code === 'LICITACION_INMUTABLE');
  });
});

describe('the token hash and the access log are never exposed', () => {
  const build = () => new Requisicion({
    tenantId: 't', consecutivo: 'REQ-3', titulo: 'x', tipoRequisicionId: oid(), areaId: oid(), creadaPor: oid(), solicitanteId: oid(),
    lineas: [{ descripcion: 'a', unidad: 'u', cantidadSolicitada: 1 }],
  });
  const stored = () => ({
    fechaLimiteCotizacion: new Date(),
    ganadorId: null,
    proveedores: [{ _id: oid(), proveedorId: oid(), nombre: 'P', correoEnvio: 'p@x.co', tokenHash: 'a'.repeat(64), tokenHint: 'abcd', estadoEnvio: 'Enviado', vistasCount: 3, vistas: [{ ip: '9.9.9.9' }] }],
  });

  it('toObject / toJSON / toPublic drop tokenHash and vistas', () => {
    const doc = build();
    doc.licitacion = stored();
    for (const out of [doc.toObject(), doc.toJSON(), toPublic(doc)]) {
      const s = JSON.stringify(out);
      assert.equal(s.includes('tokenHash'), false);
      assert.equal(s.includes('9.9.9.9'), false);
      assert.equal(s.includes('a'.repeat(64)), false);
    }
    assert.equal(toPublic(doc).licitacion.proveedores[0].tokenHint, 'abcd');
    assert.equal(toPublic(doc).licitacion.proveedores[0].vistasCount, 3);
  });

  it('the DTO is an allowlist even for a raw (lean) document', () => {
    const raw = stored();
    raw.proveedores[0].secretoInterno = 'x';
    const dto = toLicitacionDto(raw);
    assert.deepEqual(Object.keys(dto.proveedores[0]).sort(), ['_id', 'correoEnvio', 'cotizacion', 'estadoEnvio', 'fechaEnvio', 'nombre', 'proveedorId', 'tieneCotizacion', 'tokenHint', 'vistasCount']);
    assert.equal(JSON.stringify(dto).includes('secretoInterno'), false);
    assert.deepEqual(toLicitacionDto(undefined), { fechaLimiteCotizacion: null, instrucciones: null, ganadorId: null, compraDirecta: null, proveedores: [] });
  });

  it('tokenHash and vistas are excluded from queries by default (select: false) and the hash is indexed', () => {
    const sub = Requisicion.schema.path('licitacion').schema.path('proveedores').schema;
    assert.equal(sub.path('tokenHash').options.select, false);
    assert.equal(sub.path('vistas').options.select, false);
    assert.ok(Requisicion.schema.indexes().some(([k]) => k['licitacion.proveedores.tokenHash'] === 1));
  });
});
