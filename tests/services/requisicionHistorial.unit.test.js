import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { tiposForAccion, isParticipant, participationFilter } from '../../src/services/requisicionHistorial.service.js';
import { requisicionService } from '../../src/services/requisicion.service.js';
import { Requisicion } from '../../src/models/requisicion.model.js';
import { queryRequisicionDto } from '../../src/dtos/requisicion.dto.js';
import { REQUISICION_ACCIONES_HISTORIAL } from '../../src/constants/requisicion.constants.js';
import {
  authorizeReadOrParticipation, authorizeListOrMiHistorial, userCanReadRequisiciones,
} from '../../src/middlewares/requisicionReadAccess.middleware.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';

const oid = () => new mongoose.Types.ObjectId();
const run = (mw, req) => { let err; mw(req, {}, (e) => { err = e; }); return err; };

describe('REQUISICION_ACCIONES_HISTORIAL / tiposForAccion', () => {
  it('maps each action and todo is the union without system events', () => {
    assert.deepEqual(tiposForAccion('aprobe'), ['NIVEL_APROBADO']);
    assert.deepEqual(tiposForAccion('rechace'), ['NIVEL_RECHAZADO', 'RECHAZADA']);
    assert.deepEqual(tiposForAccion('recibi'), ['RECEPCION_REGISTRADA']);
    assert.deepEqual(tiposForAccion('confirme'), ['ENTREGA_CONFIRMADA', 'ENTREGA_DISPUTADA']);
    assert.deepEqual(tiposForAccion('cree'), ['CREADA']);
    assert.deepEqual(tiposForAccion('adjudique'), ['PROVEEDOR_SELECCIONADO', 'COMPRA_DIRECTA_JUSTIFICADA']);
    const all = tiposForAccion('todo');
    assert.equal(all.length, Object.values(REQUISICION_ACCIONES_HISTORIAL).flat().length);
    assert.deepEqual(tiposForAccion(undefined), all);
    assert.ok(!all.includes('APROBADA') && !all.includes('COTIZACION_RECIBIDA'));
  });
});

describe('queryRequisicionDto mi-historial', () => {
  it('accepts vista + accion and the usual list params; rejects a bad accion', () => {
    const ok = queryRequisicionDto.validate({ vista: 'mi-historial', accion: 'aprobe', page: 2, limit: 5, sortBy: 'createdAt', order: 'asc', search: 'x', estado: 'Cerrada' });
    assert.equal(ok.error, undefined);
    assert.equal(queryRequisicionDto.validate({ vista: 'mi-historial', accion: 'todo' }).error, undefined);
    assert.ok(queryRequisicionDto.validate({ vista: 'mi-historial', accion: 'borrar' }).error);
  });
});

describe('participation', () => {
  const me = oid(); const other = oid();
  const ev = (tipo, id, actorTipo = 'usuario') => ({ tipo, actor: { tipo: actorTipo, usuarioId: id } });
  it('counts creator, requester, line responsible and user events only', () => {
    assert.ok(isParticipant({ creadaPor: me }, me));
    assert.ok(isParticipant({ solicitanteId: String(me) }, me));
    assert.ok(isParticipant({ lineas: [{ responsableId: me }] }, String(me)));
    assert.ok(isParticipant({ timeline: [ev('NIVEL_APROBADO', me)] }, me));
    assert.ok(!isParticipant({ timeline: [ev('COTIZACION_RECIBIDA', me, 'proveedor')] }, me));
    assert.ok(!isParticipant({ creadaPor: other, timeline: [ev('CREADA', other)] }, me));
    assert.ok(!isParticipant({ creadaPor: me }, undefined));
    assert.deepEqual(participationFilter('nope'), { _id: null });
    assert.equal(participationFilter(me).$or.length, 4);
  });

  it('getById: reader without read gets 404 unless participant; readers unaffected', async () => {
    const me2 = oid();
    const doc = { _id: oid(), tenantId: 't', creadaPor: oid(), timeline: [], lineas: [], toObject() { return this; } };
    const orig = Requisicion.findOne; const origPop = Requisicion.populate;
    Requisicion.findOne = async () => doc;
    Requisicion.populate = async (d) => d;
    try {
      await assert.rejects(() => requisicionService.getById('t', doc._id, { userId: String(me2), canRead: false }), (e) => e.statusCode === 404 && e.code === 'REQUISICION_NOT_FOUND');
      const out = await requisicionService.getById('t', doc._id, { userId: String(doc.creadaPor), canRead: false });
      assert.equal(String(out._id), String(doc._id));
      const out2 = await requisicionService.getById('t', doc._id, { userId: String(me2), canRead: true });
      assert.equal(String(out2._id), String(doc._id));
      assert.ok(await requisicionService.getById('t', doc._id));
    } finally { Requisicion.findOne = orig; Requisicion.populate = origPop; }
  });
});

describe('read-access middleware', () => {
  const user = (permissions, role = 'user') => ({ userId: 'u', tenantId: 't', role, permissions });
  it('sets req.canRead and gates only the plain list', () => {
    const noRead = user([PERMISSIONS.AREAS_READ]);
    const r1 = { user: noRead, query: { vista: 'mi-historial' } };
    assert.equal(run(authorizeListOrMiHistorial, r1), undefined);
    assert.equal(r1.canRead, false);
    for (const query of [{}, { vista: 'por-aprobar' }, { vista: 'por-recibir' }, { vista: ['mias', 'mias'] }, { vista: 'Mias' }, { vista: 'mias ' }, { vista: { $ne: 'x' } }, undefined]) {
      assert.equal(run(authorizeListOrMiHistorial, { user: noRead, query })?.statusCode, 403);
    }
    for (const vista of ['mias', 'por-confirmar']) assert.equal(run(authorizeListOrMiHistorial, { user: noRead, query: { vista } }), undefined, vista);
    const r2 = { user: noRead, params: {} };
    assert.equal(run(authorizeReadOrParticipation(), r2), undefined);
    assert.equal(r2.canRead, false);
    assert.equal(run(authorizeListOrMiHistorial, { user: user([PERMISSIONS.REQUISICIONES_READ]), query: {} }), undefined);
    assert.equal(run(authorizeListOrMiHistorial, {})?.statusCode, 401);
  });
  it('canRead semantics: read, manage-all, superadmin', () => {
    assert.ok(userCanReadRequisiciones(user([PERMISSIONS.REQUISICIONES_READ])));
    assert.ok(userCanReadRequisiciones(user([PERMISSIONS.REQUISICIONES_MANAGE_ALL])));
    assert.ok(userCanReadRequisiciones(user([], 'superadmin')));
    assert.ok(!userCanReadRequisiciones(user([])));
  });
});

describe('compactActividad', () => {
  const at = (iso) => new Date(iso);
  it('drops RECHAZADA paired with NIVEL_RECHAZADO and collapses same-minute same-type events', async () => {
    const { compactActividad } = await import('../../src/services/requisicionHistorial.service.js');
    const rej = compactActividad([
      { tipo: 'RECHAZADA', fecha: at('2026-01-01T10:00:00.500Z'), estadoNuevo: 'Rechazada' },
      { tipo: 'NIVEL_RECHAZADO', fecha: at('2026-01-01T10:00:00.500Z'), estadoNuevo: 'En_Aprobacion' },
    ]);
    assert.deepEqual(rej.map((e) => e.tipo), ['NIVEL_RECHAZADO']);
    const lines = compactActividad([1, 2, 3, 4].map((i) => ({ tipo: 'ENTREGA_CONFIRMADA', fecha: at(`2026-01-01T10:00:0${i}Z`) })));
    assert.equal(lines.length, 1);
    assert.equal(at('2026-01-01T10:00:04Z').getTime(), new Date(lines[0].fecha).getTime(), 'newest kept');
    const many = compactActividad(Array.from({ length: 9 }, (_, i) => ({ tipo: 'CREADA', fecha: at(`2026-01-01T1${i}:00:00Z`) })));
    assert.equal(many.length, 5);
    assert.ok(new Date(many[0].fecha) > new Date(many[4].fecha));
    // a RECHAZADA with no twin is kept
    assert.equal(compactActividad([{ tipo: 'RECHAZADA', fecha: at('2026-01-01T10:00:00Z') }]).length, 1);
  });
});
