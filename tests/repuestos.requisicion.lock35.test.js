/**
 * requisiciones-e2 adversarial round 2, 3.5: broadened lock and installation quantity safe. DB-free stubs.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { repuestosService } from '../src/services/repuestos.service.js';
import { Repuestos } from '../src/models/repuestos.model.js';
import { RepuestoTrazabilidad } from '../src/models/repuestotrazabilidad.model.js';
import { Tenant } from '../src/models/tenant.model.js';
import { Requisicion } from '../src/models/requisicion.model.js';
import { InventarioRepuesto } from '../src/models/inventarioRepuesto.model.js';

const oid = () => new mongoose.Types.ObjectId();
const T = 'tenant-a';
const stubs = [];
function stub(target, key, value) { stubs.push([target, key, target[key]]); target[key] = value; }
let savedEnforce;
let capsOn;

beforeEach(() => {
  savedEnforce = process.env.ENFORCE_TENANT_CAPABILITIES;
  process.env.ENFORCE_TENANT_CAPABILITIES = 'on';
  capsOn = true;
  stub(Tenant, 'findOne', () => ({ lean: async () => ({ capabilities: { usesRequisiciones: capsOn } }) }));
  stub(RepuestoTrazabilidad, 'create', async (d) => d);
  stub(InventarioRepuesto, 'findOne', () => ({ select: () => ({ lean: async () => ({ _id: 'item' }) }) }));
});
afterEach(() => {
  while (stubs.length) { const [t, k, o] = stubs.pop(); t[k] = o; }
  if (savedEnforce === undefined) delete process.env.ENFORCE_TENANT_CAPABILITIES; else process.env.ENFORCE_TENANT_CAPABILITIES = savedEnforce;
});

function arrange(disponibilidad, over = {}) {
  const reqId = oid();
  const current = {
    _id: 'r1', tenantId: T, nombre: 'Sensor', Cantidad: '2', EstadoSolicitud: 'Solicitado',
    InventarioItemId: oid(), ReporteSolicitudId: oid(), ResponsableInstalacion: oid(), FechaInstalacion: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date(), requisicion: { requisicionId: reqId, lineaId: oid(), consecutivo: 'REQ-1', disponibilidad, cantidadConfirmada: disponibilidad === 'Disponible' ? 2 : 0 }, ...over,
  };
  stub(Requisicion, 'find', () => ({ lean: async () => [{ _id: reqId, estado: 'En_Recepcion', consecutivo: 'REQ-1', lineas: [] }] }));
  stub(Repuestos, 'findOne', () => ({ lean: async () => current }));
  stub(Repuestos, 'findOneAndUpdate', async (f, u) => ({ _id: f._id, tenantId: T, ...u.$set, toJSON() { return {}; } }));
  return current;
}
const locked = (e) => e.statusCode === 409 && e.code === 'SOLICITUD_EN_REQUISICION';
const caps = { usesRequisiciones: true };

describe('3.5: broadened lock on a linked, not Disponible solicitud', () => {
  const changes = {
    InventarioItemId: () => oid(),
    ReporteSolicitudId: () => oid(),
    ReporteInstalacionId: () => oid(),
    ResponsableInstalacion: () => oid(),
    FechaInstalacion: () => new Date('2026-11-05T00:00:00Z'),
  };
  for (const [field, make] of Object.entries(changes)) {
    it(`changing ${field} -> 409 SOLICITUD_EN_REQUISICION`, async () => {
      arrange('En_Abastecimiento');
      await assert.rejects(() => repuestosService.update('r1', { [field]: make() }, T, caps), locked);
    });
  }

  it('unchanged values (ids as strings, date as ISO string) pass: no false positives', async () => {
    const c = arrange('En_Abastecimiento');
    const out = await repuestosService.update('r1', {
      InventarioItemId: String(c.InventarioItemId), ReporteSolicitudId: String(c.ReporteSolicitudId),
      ResponsableInstalacion: String(c.ResponsableInstalacion), FechaInstalacion: c.FechaInstalacion.toISOString(), observacion: 'ok',
    }, T, caps);
    assert.ok(out);
  });

  it('Disponible: the same fields are free; module OFF: free', async () => {
    arrange('Disponible');
    await repuestosService.update('r1', { InventarioItemId: oid(), ResponsableInstalacion: oid() }, T, caps);
    capsOn = false;
    arrange('En_Abastecimiento');
    await repuestosService.update('r1', { InventarioItemId: oid() }, T, { usesRequisiciones: false });
  });
});

describe('3.5: installation quantity cannot exceed what the requisition confirmed once the stock was discounted', () => {
  it('marker + CantidadInstalacion 4 over confirmed 2 -> 409 CANTIDAD_EXCEDE_CONFIRMADA', async () => {
    arrange('Disponible', { stockDescontadoPor: 'requisicion' });
    await assert.rejects(
      () => repuestosService.update('r1', { CantidadInstalacion: 4 }, T, caps),
      (e) => e.statusCode === 409 && e.code === 'CANTIDAD_EXCEDE_CONFIRMADA' && e.details.cantidadConfirmada === 2,
    );
  });

  it('marker + CantidadInstalacion <= confirmed passes; no marker passes; module OFF passes', async () => {
    arrange('Disponible', { stockDescontadoPor: 'requisicion' });
    await repuestosService.update('r1', { CantidadInstalacion: 2 }, T, caps);
    await repuestosService.update('r1', { CantidadInstalacion: 1 }, T, caps);
    arrange('Disponible');
    await repuestosService.update('r1', { CantidadInstalacion: 9 }, T, caps);
    capsOn = false;
    arrange('Disponible', { stockDescontadoPor: 'requisicion' });
    await repuestosService.update('r1', { CantidadInstalacion: 9 }, T, { usesRequisiciones: false });
  });
});
