/**
 * tests/services/informeGenerate.signature.test.js
 *
 * Verifies informeGenerateService.generate() includes meta.responsableFirmaUrl
 * from currentUser.fileFirma (tasks.md 6.5, informes-firma-autor). DB-free —
 * model statics monkey-patched, same convention as informeGenerateByOt.test.js.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { informeGenerateService } from '../../src/services/informeGenerate.service.js';
import { Customer } from '../../src/models/customer.model.js';
import { EquipoItem } from '../../src/models/equipoitem.model.js';
import { Report } from '../../src/models/report.model.js';
import { Repuestos } from '../../src/models/repuestos.model.js';
import { Tenant } from '../../src/models/tenant.model.js';

const TENANT_A = 'tenant-a';
const CLIENTE_ID = '507f1f77bcf86cd799439001';

function chainable(result) {
  const obj = {
    select() { return obj; },
    populate() { return obj; },
    lean: () => Promise.resolve(result),
  };
  return obj;
}

function setupMocks() {
  Customer.findOne = () => chainable({ _id: CLIENTE_ID, Razonsocial: 'ACME', Ciudad: 'Bogota' });
  EquipoItem.find = () => chainable([{
    _id: 'equipo-1', ItemId: { Nombre: 'Monitor' }, Marca: 'Philips', Serie: 'S1', Inventario: 'INV1',
    SedeId: { nombreSede: 'Sede A' }, Servicio: { nombre: 'UCI' }, mesesMtto: ['Enero'], EstadoOperativo: 'Operativo',
  }]);
  Report.find = () => chainable([]);
  Repuestos.find = () => chainable([]);
  Tenant.findOne = () => chainable(null); // fallback to the caller-provided tenant object
}

function cleanupMocks() {
  delete Customer.findOne;
  delete EquipoItem.find;
  delete Report.find;
  delete Repuestos.find;
  delete Tenant.findOne;
}

describe('informeGenerateService.generate — meta.responsableFirmaUrl', () => {
  afterEach(cleanupMocks);

  it('includes the signature URL from currentUser.fileFirma when present', async () => {
    setupMocks();
    const payload = await informeGenerateService.generate(
      CLIENTE_ID, 'ene', 'ene', TENANT_A,
      { fullName: 'Juan Perez', fileFirma: 'https://cdn.example.com/firma.png' },
      { name: 'Tenant Demo' },
    );
    assert.equal(payload.meta.responsableFirmaUrl, 'https://cdn.example.com/firma.png');
  });

  it('is null when currentUser has no fileFirma', async () => {
    setupMocks();
    const payload = await informeGenerateService.generate(
      CLIENTE_ID, 'ene', 'ene', TENANT_A,
      { fullName: 'Juan Perez' },
      { name: 'Tenant Demo' },
    );
    assert.equal(payload.meta.responsableFirmaUrl, null);
  });
});
