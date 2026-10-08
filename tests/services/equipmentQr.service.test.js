/**
 * tests/services/equipmentQr.service.test.js
 *
 * Same convention as tests/integration/clientPortal.routes.test.js: no
 * supertest/mongodb-memory-server in this repo — mock the Mongoose model
 * statics at the DB boundary and exercise the real service logic.
 *
 * Covers: idempotency (D3), race recovery (D13), bulk cap (D12),
 * cross-tenant filter yielding zero results (no data leak).
 */
import { describe, it, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';

import { equipmentQrService } from '../../src/services/equipmentQr.service.js';
import { EquipmentQr } from '../../src/models/equipmentQr.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { getQrPngAbsolutePath } from '../../src/utils/qrImage.util.js';

// generateForEquipo's PNG persistence is best-effort (try/catch) and runs
// against the REAL qrImage.util (not mocked) — track real ids saved via the
// `save` stub so the on-disk PNGs it writes get cleaned up afterwards.
const savedIds = [];

function mockQuery(result) {
  const q = {
    select: () => q,
    populate: () => q,
    sort: () => q,
    skip: () => q,
    limit: () => q,
    lean: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return q;
}

describe('equipmentQrService', () => {
  afterEach(() => {
    delete EquipoItem.findOne;
    delete EquipoItem.find;
    delete EquipoItem.countDocuments;
    delete EquipmentQr.findOne;
    delete EquipmentQr.find;
    delete EquipmentQr.countDocuments;
    delete EquipmentQr.prototype.save;
  });

  after(async () => {
    await Promise.all(
      savedIds.map((id) => fs.rm(getQrPngAbsolutePath(id, 'equipment-qrs'), { force: true }).catch(() => {}))
    );
  });

  describe('generateForEquipo (idempotency + race recovery)', () => {
    it('creates a new QR when none exists for the equipo', async () => {
      const equipoId = '507f1f77bcf86cd799439011';
      EquipoItem.findOne = () => mockQuery({ _id: equipoId, tenantId: 't1' });
      EquipmentQr.findOne = () => mockQuery(null);

      let saved = null;
      EquipmentQr.prototype.save = async function () {
        saved = this;
        savedIds.push(this._id.toString());
        return this;
      };

      const result = await equipmentQrService.generateForEquipo(equipoId, 't1', 'user-1');

      assert.equal(result.created, true);
      assert.equal(result.doc.tenantId, 't1');
      assert.ok(saved);
    });

    it('returns the existing active QR (200-equivalent) without creating a duplicate', async () => {
      const equipoId = '507f1f77bcf86cd799439011';
      const existing = { _id: 'existing-qr', tenantId: 't1', equipoId, qrToken: 'abc' };
      EquipoItem.findOne = () => mockQuery({ _id: equipoId, tenantId: 't1' });
      EquipmentQr.findOne = () => mockQuery(existing);

      let saveCalled = false;
      EquipmentQr.prototype.save = async function () { saveCalled = true; return this; };

      const result = await equipmentQrService.generateForEquipo(equipoId, 't1', 'user-1');

      assert.equal(result.created, false);
      assert.equal(result.doc, existing);
      assert.equal(saveCalled, false);
    });

    it('404s when the equipo does not belong to the tenant', async () => {
      EquipoItem.findOne = () => mockQuery(null);

      await assert.rejects(
        () => equipmentQrService.generateForEquipo('507f1f77bcf86cd799439011', 't1'),
        (err) => err.statusCode === 404 && err.code === 'EQUIPO_NOT_FOUND'
      );
    });

    it('recovers the existing doc on a duplicate-key race (D13)', async () => {
      const equipoId = '507f1f77bcf86cd799439011';
      const recovered = { _id: 'recovered-qr', tenantId: 't1', equipoId, qrToken: 'xyz' };
      EquipoItem.findOne = () => mockQuery({ _id: equipoId, tenantId: 't1' });

      let call = 0;
      EquipmentQr.findOne = () => {
        call += 1;
        // First call (pre-check): nothing found -> proceeds to insert.
        // Second call (post-race recovery): returns the winner's doc.
        return mockQuery(call === 1 ? null : recovered);
      };

      EquipmentQr.prototype.save = async function () {
        const err = new Error('duplicate key');
        err.code = 11000;
        throw err;
      };

      const result = await equipmentQrService.generateForEquipo(equipoId, 't1', 'user-1');

      assert.equal(result.created, false);
      assert.equal(result.doc, recovered);
    });
  });

  describe('generateBulk (D12 hard cap)', () => {
    it('rejects with BULK_LIMIT_EXCEEDED when the filter resolves beyond MAX_BULK_SIZE', async () => {
      EquipoItem.countDocuments = () => Promise.resolve(501);

      await assert.rejects(
        () => equipmentQrService.generateBulk({ ClienteId: 'c1' }, 't1'),
        (err) => err.statusCode === 400 && err.code === 'BULK_LIMIT_EXCEEDED'
      );
    });

    it('summarizes created/reused counts when below the cap', async () => {
      const eq1 = '507f1f77bcf86cd799439021';
      const eq2 = '507f1f77bcf86cd799439022';
      EquipoItem.countDocuments = () => Promise.resolve(2);
      EquipoItem.find = () => mockQuery([{ _id: eq1 }, { _id: eq2 }]);
      EquipoItem.findOne = () => mockQuery({ _id: 'eq', tenantId: 't1' });
      let callIdx = 0;
      EquipmentQr.findOne = () => {
        callIdx += 1;
        // eq1 has no QR yet (created), eq2 already has one (reused).
        return mockQuery(callIdx === 1 ? null : { _id: 'existing', equipoId: eq2, tenantId: 't1' });
      };
      EquipmentQr.prototype.save = async function () { savedIds.push(this._id.toString()); return this; };

      const result = await equipmentQrService.generateBulk({}, 't1', 'user-1');

      assert.equal(result.created, 1);
      assert.equal(result.reused, 1);
      assert.equal(result.items.length, 2);
    });
  });

  describe('list (equipo-centric, tenant isolation)', () => {
    it('cross-tenant ClienteId filter resolves to zero equipos -> empty list, no data leak', async () => {
      EquipoItem.find = () => mockQuery([]);
      EquipoItem.countDocuments = () => Promise.resolve(0);

      const result = await equipmentQrService.list({ ClienteId: 'customer-of-tenant-b' }, {}, 't1');

      assert.deepEqual(result.data, []);
      assert.equal(result.pagination.total, 0);
    });

    it('returns equipo-centric rows with left-joined qr (null when absent)', async () => {
      const equipos = [
        { _id: 'e1', item: 'Ecógrafo', Marca: 'GE', Modelo: 'Logiq', Serie: 'A1', Inventario: 'INV-1', Ubicacion: 'Piso 2', EstadoOperativo: 'Operativo' },
        { _id: 'e2', item: 'Monitor', Marca: 'Mindray', Modelo: 'uMEC', Serie: 'B2', Inventario: 'INV-2', Ubicacion: 'UCI', EstadoOperativo: 'En Mantenimiento' },
      ];
      EquipoItem.find = () => mockQuery(equipos);
      EquipoItem.countDocuments = () => Promise.resolve(2);
      EquipmentQr.find = () => mockQuery([
        { _id: 'q1', equipoId: 'e1', qrToken: 'tok1', active: true },
      ]);

      const result = await equipmentQrService.list({ ClienteId: 'c1' }, {}, 't1');

      assert.equal(result.data.length, 2);
      assert.equal(result.data[0].equipoId, 'e1');
      assert.equal(result.data[0].marca, 'GE');
      assert.equal(result.data[0].qr?.qrToken, 'tok1');
      assert.equal(result.data[1].equipoId, 'e2');
      assert.equal(result.data[1].qr, null);
      assert.equal(result.pagination.total, 2);
    });
  });
});
