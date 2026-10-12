import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { EquipoActividadExterna } from '../../src/models/equipoActividadExterna.model.js';

const baseDoc = (overrides = {}) => new EquipoActividadExterna({
  tenantId: 't1',
  clienteId: new mongoose.Types.ObjectId(),
  equipoId: new mongoose.Types.ObjectId(),
  cadenaId: new mongoose.Types.ObjectId(),
  tipo: 'calibracion',
  consecutivoExterno: 'CAL-001',
  fecha: new Date('2026-01-15'),
  proveedor: 'ACME',
  estadoFinal: 'aprobada',
  esInicioCadena: true,
  createdByUserId: new mongoose.Types.ObjectId(),
  ...overrides,
});

const validationError = (doc) => doc.validate().then(() => undefined, (e) => e);

describe('EquipoActividadExterna model', () => {
  it('acepta documento válido', async () => {
    assert.equal(await validationError(baseDoc()), undefined);
  });

  it('rechaza fecha futura', async () => {
    const future = new Date(Date.now() + 86_400_000);
    const err = await validationError(baseDoc({ fecha: future }));
    assert.ok(err.errors.fecha);
  });

  it('rechaza enlace que no empieza con http(s)', async () => {
    const err = await validationError(baseDoc({ enlace: 'javascript:alert(1)' }));
    assert.ok(err.errors.enlace);
  });

  it('requiere estadoFinalCustom cuando estadoFinal = otro', async () => {
    const err = await validationError(baseDoc({ estadoFinal: 'otro' }));
    assert.ok(err.errors.estadoFinalCustom);
  });

  it('requiere evidencia.storagePath si evidencia presente', async () => {
    const err = await validationError(baseDoc({
      evidencia: { url: 'https://x', nombreOriginal: 'a.pdf', mimetype: 'application/pdf', tamanoBytes: 100 },
    }));
    assert.ok(err.errors['evidencia.storagePath']);
  });

  it('toJSON excluye evidencia.storagePath', () => {
    const doc = baseDoc({
      evidencia: { url: 'https://x', storagePath: 'secret/path.pdf', nombreOriginal: 'a.pdf', mimetype: 'application/pdf', tamanoBytes: 100, uploadedAt: new Date() },
    });
    const json = doc.toJSON();
    assert.equal(json.evidencia.storagePath, undefined);
    assert.equal(json.evidencia.url, 'https://x');
  });
});
