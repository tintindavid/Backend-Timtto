/**
 * tests/integration/equipoItem.estadoOperativo.routes.test.js
 *
 * "Integration" tests for the EstadoOperativo surface of
 * equipo-estado-operativo-editable-y-cronograma-excel (tasks.md 4.6/4.7).
 * Following the project convention (see
 * tests/integration/equipoItemDuplicate.routes.test.js): no
 * supertest/mongodb-memory-server — drive validate(dto) -> controller.<method>
 * in sequence with fake req/res objects, mocking only the service singleton
 * (the DB boundary).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { equipoItemController } from '../../src/controllers/equipoitem.controller.js';
import { equipoItemService } from '../../src/services/equipoitem.service.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import { updateEquipoItemDto } from '../../src/dtos/updateEquipoItem.dto.js';
import { ApiError } from '../../src/utils/apiError.util.js';

function buildRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const EQUIPO_ID = '507f1f77bcf86cd799439003';
const TENANT_1 = 'tenant-1';

describe('PUT /api/v1/equipo-items/:id — EstadoOperativo validation', () => {
  it('an invalid EstadoOperativo value is rejected with 400 VALIDATION_ERROR before the service runs', () => {
    let serviceCalled = false;
    equipoItemService.update = async () => { serviceCalled = true; return {}; };

    const req = { body: { EstadoOperativo: 'Roto' }, params: { id: EQUIPO_ID }, tenantId: TENANT_1, user: { userId: 'user-1' } };
    const res = buildRes();

    let validationErr;
    validate(updateEquipoItemDto, 'body')(req, res, (err) => { validationErr = err; });

    assert.ok(validationErr instanceof ApiError);
    assert.equal(validationErr.statusCode, 400);
    assert.equal(validationErr.code, 'VALIDATION_ERROR');
    assert.equal(serviceCalled, false);

    delete equipoItemService.update;
  });

  it('a valid EstadoOperativo + estadoOperativoMotivo passes validation and reaches the controller', async () => {
    let capturedData = null;
    equipoItemService.update = async (id, data) => { capturedData = data; return { _id: id, ...data }; };

    const req = {
      body: { EstadoOperativo: 'Fuera de Servicio', estadoOperativoMotivo: 'Falla eléctrica' },
      params: { id: EQUIPO_ID },
      tenantId: TENANT_1,
      user: { userId: 'user-1' },
    };
    const res = buildRes();

    let validationErr;
    validate(updateEquipoItemDto, 'body')(req, res, (err) => { validationErr = err; });
    assert.equal(validationErr, undefined);

    await equipoItemController.update(req, res, (err) => { throw err; });

    assert.equal(res.body.success, true);
    assert.equal(capturedData.EstadoOperativo, 'Fuera de Servicio');
    assert.equal(capturedData.estadoOperativoMotivo, 'Falla eléctrica');

    delete equipoItemService.update;
  });
});

describe('GET /api/v1/equipo-items/:id/populated — includes estadoOperativoHistory', () => {
  afterEach(() => { delete equipoItemService.getByIdPopulated; });

  it('the response payload includes the populated estadoOperativoHistory array', async () => {
    const history = [
      { from: null, to: 'Operativo', source: 'migration', changedByName: 'Migración', at: new Date('2026-01-01') },
      { from: 'Operativo', to: 'En Reparacion', source: 'manual', changedByName: 'M. Duran', motivo: 'Falla intermitente', at: new Date('2026-08-22') },
    ];
    equipoItemService.getByIdPopulated = async () => ({ _id: EQUIPO_ID, EstadoOperativo: 'En Reparacion', estadoOperativoHistory: history });

    const req = { params: { id: EQUIPO_ID }, tenantId: TENANT_1, user: { userId: 'user-1' } };
    const res = buildRes();

    await equipoItemController.getByIdPopulated(req, res, (err) => { throw err; });

    assert.equal(res.body.success, true);
    assert.equal(res.body.data.estadoOperativoHistory.length, 2);
    assert.equal(res.body.data.estadoOperativoHistory[1].source, 'manual');
    assert.equal(res.body.data.estadoOperativoHistory[1].motivo, 'Falla intermitente');
  });
});
