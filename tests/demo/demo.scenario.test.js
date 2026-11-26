/** Cuentas demo — Tareas 6 y 7: escenario de ejemplo (función pura). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildDemoDataset } from '../../src/services/demo/scenario/index.js';
import { demoId } from '../../src/services/demo/demoIds.js';
import { loadDemoCatalog, DEFAULT_CATALOG_PATH } from '../../src/services/demo/demoCatalog.js';
import { catalogoFixture } from './catalogoFixture.js';

const NOW = new Date('2026-03-04T15:00:00.000Z');
const admin = { _id: demoId('t', 'admin'), fullName: 'Ana Ruiz' };
const build = (tenantId, catalog = catalogoFixture(), now = NOW) => buildDemoDataset({ tenantId, admin, catalog, now });

const docsOf = (dataset, name) => dataset.batches.filter((b) => b.Model.modelName === name).flatMap((b) => b.docs);

/** Every value of every schema path declared with `ref`, subdocuments included. */
function refValues(schema, value, prefix = '') {
  const out = [];
  schema.eachPath((path, type) => {
    const v = path.split('.').reduce((acc, k) => acc?.[k], value);
    if (v === undefined || v === null) return;
    const ref = type.options?.ref ?? type.caster?.options?.ref;
    if (ref) for (const one of [v].flat()) out.push({ path: prefix + path, id: String(one) });
    else if (type.schema) for (const sub of [v].flat()) out.push(...refValues(type.schema, sub, `${prefix}${path}.`));
  });
  return out;
}

function checkIntegrity(dataset, tenantId) {
  const ids = new Set([String(admin._id)]);
  for (const { docs } of dataset.batches) for (const d of docs) {
    assert.equal(ids.has(String(d._id)), false, `duplicated _id ${d._id}`);
    ids.add(String(d._id));
  }
  for (const { Model, docs } of dataset.batches) {
    for (const d of docs) {
      assert.equal(d.tenantId, tenantId, Model.modelName);
      const instance = new Model(d);
      assert.equal(instance.validateSync()?.message, undefined, Model.modelName);
      for (const { path, id } of refValues(Model.schema, instance.toObject({ depopulate: true }))) {
        assert.ok(ids.has(id), `${Model.modelName}.${path} -> ${id} is dangling`);
      }
      // Nothing is silently dropped by strict mode.
      for (const key of Object.keys(d)) assert.ok(Model.schema.path(key) || Model.schema.nested[key], `${Model.modelName}.${key} is not in the schema`);
    }
  }
  for (const item of docsOf(dataset, 'Items')) if (item.ProtocoloId) assert.ok(ids.has(item.ProtocoloId), 'Items.ProtocoloId');
  return ids;
}

describe('buildDemoDataset', () => {
  const data = build('demo1');

  it('has no broken references and every document is valid', () => { checkIntegrity(data, 'demo1'); });

  it('creates the agreed sample content within the limits', () => {
    const count = (n) => docsOf(data, n).length;
    assert.equal(docsOf(data, 'Customer').filter((c) => c.kind === 'customer').length, 1);
    assert.equal(docsOf(data, 'Customer').filter((c) => c.kind === 'provider').length, 1);
    assert.equal(count('Sedes'), 2);
    assert.equal(count('Servicios'), 3);
    assert.equal(count('EquipoItem'), 15);
    assert.equal(count('OT'), 9);
    assert.equal(count('SheetWork'), 6);
    assert.equal(count('HVEquipo'), 2);
    assert.equal(count('Ticket'), 3);
    assert.equal(count('ServiceQr'), 1);
    assert.ok(count('EquipmentQr') >= 2 && count('Repuestos') >= 2 && count('CadenaActividad') === 2);
    assert.equal(count('Items'), 3);
    assert.equal(new Set(docsOf(data, 'EquipoItem').map((e) => e.Serie)).size, 15);
  });

  it('uses only items with a protocol with activities', () => {
    const usable = String(docsOf(data, 'Items').find((i) => i.Nombre === 'Monitor de signos')._id);
    assert.ok(docsOf(data, 'EquipoItem').every((e) => String(e.ItemId) === usable));
    assert.ok(docsOf(data, 'Report').filter((r) => r.estado !== 'Pendiente' && r.origen !== 'externo').every((r) => r.actividadesRealizadas.length === 2));
  });

  it('links work orders, reports and the signed sheet both ways', () => {
    const reports = new Map(docsOf(data, 'Report').map((r) => [String(r._id), r]));
    for (const ot of docsOf(data, 'OT')) {
      assert.ok(ot.reportes.length > 0);
      for (const id of ot.reportes) assert.equal(String(reports.get(String(id)).orden), String(ot._id));
    }
    for (const sheet of docsOf(data, 'SheetWork')) {
      assert.equal(sheet.estado, 'Firmada');
      assert.ok(sheet.firmaFile.startsWith('data:image/png;base64,'));
      for (const id of sheet.reports) {
        assert.equal(String(reports.get(String(id)).hojaDeTrabajo), String(sheet._id));
        assert.equal(reports.get(String(id)).estado, 'Cerrado');
      }
    }
    for (const ot of docsOf(data, 'OT')) {
      const closed = ot.reportes.filter((id) => reports.get(String(id)).estado === 'Cerrado').length;
      assert.equal(ot.Avance, Math.round((closed / ot.reportes.length) * 100), ot.Consecutivo);
    }
  });

  it('puts the two featured pieces of equipment in every work order', () => {
    const featured = docsOf(data, 'HVEquipo').map((hv) => String(hv.EquipoId));
    for (const ot of docsOf(data, 'OT')) {
      const equipos = docsOf(data, 'Report').filter((r) => String(r.orden) === String(ot._id)).map((r) => String(r.Equipo));
      assert.ok(featured.every((id) => equipos.includes(id)), ot.Consecutivo);
    }
  });

  it('gives them a long verification history that crosses every tolerance band', () => {
    for (const hv of docsOf(data, 'HVEquipo')) {
      const tolerances = new Map(hv.verificationTolerances.map((t) => [t.magnitud, t]));
      const rows = docsOf(data, 'Report')
        .filter((r) => String(r.Equipo) === String(hv.EquipoId))
        .flatMap((r) => (r.verificationParam ?? []).map((p) => ({ ...p, fecha: r.fechaProcesado.getTime() })));
      assert.ok(new Set(rows.map((r) => r.fecha)).size >= 8, 'eight different dates');
      assert.ok(tolerances.size >= 2, 'at least two charts');
      const bands = new Set();
      for (const row of rows) {
        const t = tolerances.get(row.magnitud);
        const pct = (Math.abs(row.valorMedido - row.valorReferencia) / row.valorReferencia) * 100;
        bands.add(pct >= t.umbralFueraToleranciaPct ? 'fuera' : pct >= t.umbralAlertaPct ? 'alerta' : 'estable');
        if (row.unidad === '%') assert.ok(row.valorMedido <= 100);
      }
      assert.deepEqual([...bands].sort(), ['alerta', 'estable', 'fuera']);
    }
  });

  it('numbers work orders in chronological order', () => {
    const ots = [...docsOf(data, 'OT')].sort((a, b) => a.Consecutivo.localeCompare(b.Consecutivo));
    assert.ok(ots.every((o, i) => i === 0 || o.FechaCreacion >= ots[i - 1].FechaCreacion));
  });

  it('keeps stock consistent with the movements', () => {
    for (const item of docsOf(data, 'InventarioRepuesto')) {
      const moves = docsOf(data, 'InventarioMovimiento').filter((m) => String(m.itemId) === String(item._id));
      let stock = 0;
      for (const m of moves) {
        assert.equal(m.stockAnterior, stock);
        stock += m.tipo === 'salida' ? -m.cantidad : m.cantidad;
        assert.equal(m.stockResultante, stock);
      }
      assert.equal(item.stockActual, stock);
    }
  });

  it('external activity chains point to their current activity and back', () => {
    const activities = new Map(docsOf(data, 'EquipoActividadExterna').map((a) => [String(a._id), a]));
    const chains = docsOf(data, 'CadenaActividad');
    for (const c of chains) assert.equal(String(activities.get(String(c.actividadVigenteId)).cadenaId), String(c._id));
    assert.ok(chains.some((c) => c.fechaProxima < NOW) && chains.some((c) => c.fechaProxima > NOW));
    assert.equal(docsOf(data, 'Report').filter((r) => r.origen === 'externo').length, 1);
  });

  it('never dates executed work in the future', () => {
    for (const r of docsOf(data, 'Report')) for (const k of ['FechaCreacion', 'fechaProcesado', 'fechaFinalizdo']) if (r[k]) assert.ok(r[k] <= NOW, k);
    for (const o of docsOf(data, 'OT')) assert.ok(o.FechaCreacion <= NOW);
    for (const t of docsOf(data, 'Ticket')) assert.ok(t.createdAt <= NOW);
  });

  it('leaves the counters at or above the highest consecutive used', () => {
    const seq = Object.fromEntries(data.counters.map((c) => [c.key, c.seq]));
    const max = (list) => Math.max(...list.map((s) => Number(String(s).match(/(\d+)$/)[1])));
    assert.ok(seq.OT >= max(docsOf(data, 'OT').map((o) => o.Consecutivo)));
    assert.ok(seq.REPORT >= max(docsOf(data, 'Report').map((r) => r.consecutivo)));
    assert.ok(seq.SHEET >= max(docsOf(data, 'SheetWork').map((s) => s.numeroHoja)));
    assert.ok(seq['tickets:2026'] >= max(docsOf(data, 'Ticket').map((t) => t.consecutivo)));
  });

  it('shares no _id between tenants and repeats them for the same tenant', () => {
    const idsOf = (d) => d.batches.flatMap((b) => b.docs.map((x) => String(x._id)));
    const other = new Set(idsOf(build('demo2')));
    assert.ok(idsOf(data).every((i) => !other.has(i)));
    assert.deepEqual(idsOf(build('demo1')), idsOf(data));
  });

  it('QR tokens are random, never derived from the tenant', () => {
    const tokens = (d) => [...docsOf(d, 'EquipmentQr'), ...docsOf(d, 'ServiceQr')].map((q) => q.qrToken);
    const again = new Set(tokens(build('demo1')));
    assert.ok(tokens(data).every((t) => t.length === 21 && !again.has(t)));
  });

  it('works in January (history crosses the year)', () => {
    checkIntegrity(build('demo1', catalogoFixture(), new Date('2026-01-02T00:00:00Z')), 'demo1');
  });
});

describe('with the real base catalogue', () => {
  it('builds a consistent dataset', { skip: !fs.existsSync(DEFAULT_CATALOG_PATH) }, () => {
    const catalog = loadDemoCatalog();
    const data = build('demo1', catalog);
    checkIntegrity(data, 'demo1');
    assert.equal(docsOf(data, 'Items').length, catalog.items.length);
    assert.equal(new Set(docsOf(data, 'EquipoItem').map((e) => String(e.ItemId))).size, 15);
    const names = new Map(docsOf(data, 'Items').map((i) => [String(i._id), i.Nombre]));
    const [monitor, bomba] = docsOf(data, 'EquipoItem').map((e) => names.get(String(e.ItemId)));
    assert.match(monitor, /MONITOR MULTIPAR/i);
    assert.match(bomba, /BOMBA DE INFUSI/i);
  });
});
