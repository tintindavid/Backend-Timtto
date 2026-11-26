/** Cuentas demo — Tarea 5: catálogo base. DB-free. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sanitizeCatalog, loadDemoCatalog, parseExport } from '../../src/services/demo/demoCatalog.js';

const oid = (n) => ({ $oid: String(n).padStart(24, '0') });
const id = (n) => oid(n).$oid;

const raw = () => ({
  actividades: [
    { _id: oid(1), tenantId: 't1', Nombre: 'Limpieza', Descripcion: 'd', EsObligatoria: 'false', isDeleted: false },
    { _id: oid(2), tenantId: 't1', Nombre: 'Borrada', isDeleted: true },
    { _id: oid(3), tenantId: 'otro', Nombre: 'Ajena', isDeleted: false },
  ],
  protocolos: [{ _id: oid(10), tenantId: 't1', nombre: 'P', actividadesMtto: [oid(1), oid(2), oid(3), oid(99)] }],
  items: [
    { _id: oid(20), tenantId: 't1', Nombre: 'Item', ProtocoloId: id(10), Precio: 5, Iva: 19, IvaIncluido: true },
    { _id: oid(21), tenantId: 't1', Nombre: 'Huérfano', ProtocoloId: id(77) },
    { _id: oid(22), tenantId: 'otro', Nombre: 'Ajeno', ProtocoloId: id(10) },
  ],
  protocoloActividades: [{ _id: oid(30), tenantId: 't1', ProtocoloId: oid(10), ActividadId: oid(1) }],
});

describe('sanitizeCatalog', () => {
  const { catalog, discarded } = sanitizeCatalog(raw(), { tenantId: 't1' });
  const text = JSON.stringify(catalog);

  it('drops prices, tenant, source ids and deleted or foreign records', () => {
    for (const forbidden of ['Precio', 'Iva', 'tenantId', '_id', 'isDeleted', 'Borrada', 'Ajena', 'Ajeno', id(1), id(10)]) {
      assert.equal(text.includes(forbidden), false, forbidden);
    }
    assert.ok(discarded.some((d) => d.reason === 'otro tenant' && d.name === 'Ajeno'));
  });

  it('rewrites links to opaque keys and reports broken ones', () => {
    const [p] = catalog.protocolos;
    assert.deepEqual(p.actividadKeys, [catalog.actividades[0].key]);
    assert.equal(catalog.items[0].protocoloKey, p.key);
    assert.equal(catalog.items[1].protocoloKey, null);
    assert.deepEqual(catalog.protocoloActividades, [{ protocoloKey: p.key, actividadKey: catalog.actividades[0].key }]);
    assert.ok(discarded.some((d) => d.type === 'item' && d.name === 'Huérfano'));
    assert.ok(discarded.some((d) => d.type === 'protocolo' && d.reason.startsWith('3 actividad')));
  });
});

describe('parseExport', () => {
  it('accepts a JSON array or one document per line, with BOM', () => {
    assert.equal(parseExport('﻿[{"a":1}]').length, 1);
    assert.equal(parseExport('{"a":1}\n{"a":2}\n').length, 2);
  });
});

describe('loadDemoCatalog', () => {
  const missing = (e) => e.statusCode === 503 && e.code === 'DEMO_CATALOG_MISSING';
  it('rejects a missing, invalid or useless catalogue', () => {
    assert.throws(() => loadDemoCatalog(path.join(os.tmpdir(), 'nope-demo.json')), missing);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-'));
    const file = path.join(dir, 'c.json');
    fs.writeFileSync(file, '{');
    assert.throws(() => loadDemoCatalog(file), missing);
    fs.writeFileSync(file, JSON.stringify({ actividades: [], protocolos: [], items: [], protocoloActividades: [] }));
    assert.throws(() => loadDemoCatalog(file), missing);
  });
});

describe('static guard', () => {
  it('the build script never touches a database', () => {
    const src = fs.readFileSync(new URL('../../scripts/build-demo-catalog.js', import.meta.url), 'utf8');
    assert.equal(/mongoose|\/models\/|mongodb/i.test(src), false);
  });
});
