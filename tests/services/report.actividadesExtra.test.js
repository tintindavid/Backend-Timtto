/**
 * tests/services/report.actividadesExtra.test.js
 *
 * DB-free unit tests for report.service.js#addExtraActividades /
 * #removeExtraActividad, plus the sub-doc origin invariant enforcement in
 * #update (report-actividades-extra, spec: "Report sub-document integrity
 * for activities"). Same monkey-patched-statics style as
 * tests/services/reports.guard.test.js.
 */
import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { reportService } from '../../src/services/report.service.js';
import { Report } from '../../src/models/report.model.js';
import { ProtocoloMtto } from '../../src/models/protocolomtto.model.js';
import { ActividadMtto } from '../../src/models/actividadmtto.model.js';
import { ApiError } from '../../src/utils/apiError.util.js';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const REPORT_ID = '507f1f77bcf86cd799439001';
const PROTOCOLO_ID = '507f1f77bcf86cd799439002';
const ITEM_ID = '507f1f77bcf86cd799439003';
const EQUIPO_ID = '507f1f77bcf86cd799439004';

// Two ids the protocol already contains, three that live in the catalog only.
const PROTO_ACT_A = '507f1f77bcf86cd799439010';
const PROTO_ACT_B = '507f1f77bcf86cd799439011';
const CATALOG_C = '507f1f77bcf86cd799439020';
const CATALOG_D = '507f1f77bcf86cd799439021';
const CATALOG_E = '507f1f77bcf86cd799439022';

const PANEL_USER = { userId: '507f1f77bcf86cd799439099', firstName: 'M', lastName: 'D' };

function makeReport({ estado = 'Pendiente', procesado = false, actividadesRealizadas = [] } = {}) {
  const doc = {
    _id: REPORT_ID,
    tenantId: TENANT,
    estado,
    procesado,
    actividadesRealizadas,
    Equipo: {
      _id: EQUIPO_ID,
      ItemId: { _id: ITEM_ID, ProtocoloId: PROTOCOLO_ID },
    },
    toObject() {
      return {
        _id: this._id,
        tenantId: this.tenantId,
        estado: this.estado,
        procesado: this.procesado,
        actividadesRealizadas: this.actividadesRealizadas,
        Equipo: this.Equipo,
      };
    },
  };
  return doc;
}

function populatable(resolveWith) {
  const chain = {
    populate: () => chain,
    then: (onFulfilled, onRejected) => Promise.resolve(resolveWith).then(onFulfilled, onRejected),
  };
  return chain;
}

function chainableLean(resolveWith) {
  const c = { lean: () => Promise.resolve(resolveWith) };
  return c;
}

function resetMocks() {
  delete Report.findOne;
  delete Report.findOneAndUpdate;
  delete ProtocoloMtto.findOne;
  delete ProtocoloMtto.findById;
  delete ActividadMtto.find;
}

describe('reportService#addExtraActividades', () => {
  afterEach(resetMocks);

  it('happy path: appends entries with snapshot descripcion and esExtra=true', async () => {
    const report = makeReport({ actividadesRealizadas: [] });
    let capturedPush = null;
    let capturedFindQuery = null;

    Report.findOne = () => populatable(report);
    Report.findOneAndUpdate = (query, update) => {
      capturedFindQuery = query;
      capturedPush = update.$push?.actividadesRealizadas?.$each;
      const updated = makeReport({
        actividadesRealizadas: capturedPush,
      });
      return populatable(updated);
    };
    ProtocoloMtto.findOne = () => chainableLean({
      _id: PROTOCOLO_ID,
      actividadesMtto: [PROTO_ACT_A, PROTO_ACT_B],
    });
    ProtocoloMtto.findById = () => chainableLean({ _id: PROTOCOLO_ID, actividadesMtto: [PROTO_ACT_A, PROTO_ACT_B] });
    ActividadMtto.find = () => chainableLean([
      { _id: CATALOG_C, Nombre: 'Limpieza filtro', Descripcion: 'Limpieza mensual del filtro HEPA' },
      { _id: CATALOG_D, Nombre: '', Descripcion: 'Sin nombre — fallback' },
    ]);

    const result = await reportService.addExtraActividades(REPORT_ID, [CATALOG_C, CATALOG_D], TENANT, PANEL_USER);

    assert.equal(capturedFindQuery.tenantId, TENANT, 'update scoped by tenant');
    assert.equal(capturedPush.length, 2);
    assert.equal(capturedPush[0].actividadMttoId, CATALOG_C);
    assert.equal(capturedPush[0].descripcion, 'Limpieza filtro');
    // descripcionLarga: parity with protocol activities — separate long-form
    // snapshot for the "Incluir descripción" toggle.
    assert.equal(capturedPush[0].descripcionLarga, 'Limpieza mensual del filtro HEPA');
    assert.equal(capturedPush[0].esExtra, true);
    assert.equal(capturedPush[0].realizado, false);
    assert.equal(capturedPush[1].actividadMttoId, CATALOG_D);
    // Fallback: empty Nombre → descripcion uses Descripcion, and descripcionLarga
    // stays empty so the toggle doesn't produce a self-duplication.
    assert.equal(capturedPush[1].descripcion, 'Sin nombre — fallback');
    assert.equal(capturedPush[1].descripcionLarga, '');
    assert.equal(result._id, REPORT_ID);
  });

  it('dedupes ids in the input batch', async () => {
    const report = makeReport();
    let capturedPush = null;

    Report.findOne = () => populatable(report);
    Report.findOneAndUpdate = (_q, update) => {
      capturedPush = update.$push?.actividadesRealizadas?.$each;
      return populatable(makeReport({ actividadesRealizadas: capturedPush }));
    };
    ProtocoloMtto.findOne = () => chainableLean({ actividadesMtto: [] });
    ProtocoloMtto.findById = () => chainableLean({});
    ActividadMtto.find = () => chainableLean([{ _id: CATALOG_C, Nombre: 'A' }]);

    await reportService.addExtraActividades(REPORT_ID, [CATALOG_C, CATALOG_C], TENANT, PANEL_USER);

    assert.equal(capturedPush.length, 1, 'duplicate ids collapse to one entry');
  });

  it('rejects REPORT_LOCKED when procesado=true', async () => {
    const report = makeReport({ procesado: true, estado: 'Procesado' });
    Report.findOne = () => populatable(report);

    await assert.rejects(
      () => reportService.addExtraActividades(REPORT_ID, [CATALOG_C], TENANT, PANEL_USER),
      (err) => err instanceof ApiError && err.code === 'REPORT_LOCKED' && err.statusCode === 400
    );
  });

  it('rejects REPORT_LOCKED when estado=Cerrado', async () => {
    Report.findOne = () => populatable(makeReport({ estado: 'Cerrado' }));

    await assert.rejects(
      () => reportService.addExtraActividades(REPORT_ID, [CATALOG_C], TENANT, PANEL_USER),
      (err) => err instanceof ApiError && err.code === 'REPORT_LOCKED'
    );
  });

  it('rejects ACTIVITY_IN_PROTOCOL when an id already belongs to the item protocol', async () => {
    Report.findOne = () => populatable(makeReport());
    ProtocoloMtto.findOne = () => chainableLean({
      _id: PROTOCOLO_ID,
      actividadesMtto: [PROTO_ACT_A, PROTO_ACT_B],
    });

    await assert.rejects(
      () => reportService.addExtraActividades(REPORT_ID, [PROTO_ACT_A, CATALOG_C], TENANT, PANEL_USER),
      (err) =>
        err instanceof ApiError &&
        err.code === 'ACTIVITY_IN_PROTOCOL' &&
        Array.isArray(err.details?.ids) &&
        err.details.ids.includes(PROTO_ACT_A)
    );
  });

  it('rejects ACTIVITY_ALREADY_EXTRA when the id is already an extra on the report', async () => {
    const existing = [{ _id: 'sub1', actividadMttoId: CATALOG_C, esExtra: true, descripcion: 'x', realizado: false }];
    Report.findOne = () => populatable(makeReport({ actividadesRealizadas: existing }));
    ProtocoloMtto.findOne = () => chainableLean({ actividadesMtto: [] });

    await assert.rejects(
      () => reportService.addExtraActividades(REPORT_ID, [CATALOG_C, CATALOG_D], TENANT, PANEL_USER),
      (err) => err instanceof ApiError && err.code === 'ACTIVITY_ALREADY_EXTRA' && err.details.ids.includes(CATALOG_C)
    );
  });

  it('rejects ACTIVIDAD_NOT_FOUND when the catalog load returns fewer than requested (tenant isolation)', async () => {
    Report.findOne = () => populatable(makeReport());
    ProtocoloMtto.findOne = () => chainableLean({ actividadesMtto: [] });
    // Only CATALOG_C returned — CATALOG_E is either missing or in another tenant.
    ActividadMtto.find = () => chainableLean([{ _id: CATALOG_C, Nombre: 'A' }]);

    await assert.rejects(
      () => reportService.addExtraActividades(REPORT_ID, [CATALOG_C, CATALOG_E], TENANT, PANEL_USER),
      (err) => err instanceof ApiError && err.code === 'ACTIVIDAD_NOT_FOUND' && err.details.ids.includes(CATALOG_E)
    );
  });

  it('404 when the report does not exist for this tenant', async () => {
    Report.findOne = () => populatable(null);

    await assert.rejects(
      () => reportService.addExtraActividades(REPORT_ID, [CATALOG_C], TENANT, PANEL_USER),
      (err) => err instanceof ApiError && err.statusCode === 404
    );
  });

  it('reads protocol scoped by tenantId (defense-in-depth, cross-tenant leak protection)', async () => {
    let protocoloFindQuery = null;
    Report.findOne = () => populatable(makeReport());
    ProtocoloMtto.findOne = (q) => {
      protocoloFindQuery = q;
      return chainableLean({ actividadesMtto: [] });
    };
    ProtocoloMtto.findById = () => chainableLean({});
    ActividadMtto.find = () => chainableLean([{ _id: CATALOG_C, Nombre: 'A' }]);
    Report.findOneAndUpdate = () => populatable(makeReport({ actividadesRealizadas: [{ actividadMttoId: CATALOG_C, esExtra: true }] }));

    await reportService.addExtraActividades(REPORT_ID, [CATALOG_C], TENANT, PANEL_USER);

    assert.equal(protocoloFindQuery.tenantId, TENANT, 'protocol lookup must include tenantId filter');
  });
});

describe('reportService#removeExtraActividad', () => {
  afterEach(resetMocks);

  it('happy path: pulls the entry and returns the updated report', async () => {
    const SUB_ID = 'sub-extra-1';
    const reportInstance = {
      ...makeReport({
        actividadesRealizadas: [
          { _id: SUB_ID, actividadMttoId: CATALOG_C, esExtra: true, descripcion: 'x', realizado: false },
        ],
      }),
    };
    // Mongoose sub-doc .id() lookup
    reportInstance.actividadesRealizadas.id = function (id) {
      return this.find((a) => a._id === id) || null;
    };

    let capturedPull = null;
    Report.findOne = () => populatable(reportInstance);
    Report.findOneAndUpdate = (_q, update) => {
      capturedPull = update.$pull?.actividadesRealizadas?._id;
      const updated = makeReport({ actividadesRealizadas: [] });
      return populatable(updated);
    };
    ProtocoloMtto.findById = () => chainableLean({});

    await reportService.removeExtraActividad(REPORT_ID, SUB_ID, TENANT, PANEL_USER);

    assert.equal(capturedPull, SUB_ID);
  });

  it('rejects ACTIVIDAD_NOT_EXTRA when target entry is protocol-originated', async () => {
    const SUB_ID = 'sub-proto-1';
    const reportInstance = {
      ...makeReport({
        actividadesRealizadas: [
          { _id: SUB_ID, actividadProtocoloId: PROTO_ACT_A, esExtra: false, descripcion: 'x' },
        ],
      }),
    };
    reportInstance.actividadesRealizadas.id = function (id) {
      return this.find((a) => a._id === id) || null;
    };
    Report.findOne = () => populatable(reportInstance);

    await assert.rejects(
      () => reportService.removeExtraActividad(REPORT_ID, SUB_ID, TENANT, PANEL_USER),
      (err) => err instanceof ApiError && err.code === 'ACTIVIDAD_NOT_EXTRA' && err.statusCode === 400
    );
  });

  it('rejects REPORT_LOCKED for terminal states', async () => {
    Report.findOne = () => populatable(makeReport({ estado: 'Cancelado' }));

    await assert.rejects(
      () => reportService.removeExtraActividad(REPORT_ID, 'sub1', TENANT, PANEL_USER),
      (err) => err instanceof ApiError && err.code === 'REPORT_LOCKED'
    );
  });

  it('404 when the sub-doc id does not exist on the report', async () => {
    const reportInstance = {
      ...makeReport({ actividadesRealizadas: [] }),
    };
    reportInstance.actividadesRealizadas.id = function () { return null; };
    Report.findOne = () => populatable(reportInstance);

    await assert.rejects(
      () => reportService.removeExtraActividad(REPORT_ID, 'nope', TENANT, PANEL_USER),
      (err) => err instanceof ApiError && err.statusCode === 404
    );
  });
});

describe('reportService#update — sub-doc origin invariant', () => {
  afterEach(resetMocks);

  it('rejects payload with an entry that has BOTH origins set', async () => {
    // Report.findById would be called BEFORE Report.findByIdAndUpdate in the
    // service, but the invariant check runs first — so we don't need mocks
    // beyond the throw target.
    Report.findById = () => ({ lean: async () => ({ _id: REPORT_ID }) });
    Report.findByIdAndUpdate = async () => { throw new Error('should not reach mongo'); };

    await assert.rejects(
      () => reportService.update(REPORT_ID, {
        actividadesRealizadas: [
          { actividadProtocoloId: PROTO_ACT_A, actividadMttoId: CATALOG_C, esExtra: true },
        ],
      }, TENANT),
      (err) => err instanceof ApiError && err.code === 'INVALID_ACTIVITY_ORIGIN' && err.statusCode === 400
    );

    delete Report.findById;
    delete Report.findByIdAndUpdate;
  });

  it('rejects payload with an entry that has NEITHER origin set', async () => {
    Report.findById = () => ({ lean: async () => ({ _id: REPORT_ID }) });
    Report.findByIdAndUpdate = async () => { throw new Error('should not reach mongo'); };

    await assert.rejects(
      () => reportService.update(REPORT_ID, {
        actividadesRealizadas: [{ descripcion: 'orphan' }],
      }, TENANT),
      (err) => err instanceof ApiError && err.code === 'INVALID_ACTIVITY_ORIGIN'
    );

    delete Report.findById;
    delete Report.findByIdAndUpdate;
  });
});
