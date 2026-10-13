import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHVEquipoDto } from '../../src/dtos/createHVEquipo.dto.js';
import { updateHVEquipoDto } from '../../src/dtos/updateHVEquipo.dto.js';
import { HVEquipo } from '../../src/models/hvequipo.model.js';

const clienteId = '507f1f77bcf86cd799439011';

describe('UsoEquipo options', () => {
  const newOptions = [
    'Diagnóstico',
    'Monitoreo y soporte vital',
    'Terapéutico y rehabilitación',
    'Laboratorio clínico',
    'Anestesia y quirófano',
    'Imágenes diagnósticas',
  ];

  for (const uso of [...newOptions, 'Apoyo', 'Produccion']) {
    it(`accepts "${uso}" in create/update DTOs and the model`, () => {
      assert.equal(createHVEquipoDto.validate({ clienteId, UsoEquipo: uso }).error, undefined);
      assert.equal(updateHVEquipoDto.validate({ UsoEquipo: uso }).error, undefined);
      assert.equal(new HVEquipo({ clienteId, tenantId: 't', UsoEquipo: uso }).validateSync()?.errors?.UsoEquipo, undefined);
    });
  }

  it('still rejects unknown values', () => {
    assert.ok(createHVEquipoDto.validate({ clienteId, UsoEquipo: 'Otro' }).error);
  });
});

describe('Periodicity in months', () => {
  for (const dto of [createHVEquipoDto, updateHVEquipoDto]) {
    it('accepts whole months and empty string', () => {
      const base = dto === createHVEquipoDto ? { clienteId } : {};
      assert.equal(dto.validate({ ...base, PeriodicidadCalibracion: '12', PeriodicidadMantenimiento: '' }).error, undefined);
    });

    it('rejects text, decimals, negatives and more than 3 digits', () => {
      const base = dto === createHVEquipoDto ? { clienteId } : {};
      for (const bad of ['Anual', '1.5', '-3', '1000', '6 meses', '0', '000', '012']) {
        assert.ok(dto.validate({ ...base, PeriodicidadMantenimiento: bad }).error, `should reject "${bad}"`);
        assert.ok(dto.validate({ ...base, PeriodicidadCalibracion: bad }).error, `should reject "${bad}"`);
      }
    });
  }
});

describe('Documento categoria DTOs', () => {
  it('upload DTO accepts general/guia_rapida and rejects others', async () => {
    const { uploadDocumentoDto } = await import('../../src/dtos/uploadDocumento.dto.js');
    assert.equal(uploadDocumentoDto.validate({ nombre: 'G', categoria: 'guia_rapida' }).error, undefined);
    assert.equal(uploadDocumentoDto.validate({ nombre: 'G' }).error, undefined);
    assert.ok(uploadDocumentoDto.validate({ nombre: 'G', categoria: 'otra' }).error);
  });

  it('update DTO drops categoria instead of failing', async () => {
    const { updateDocumentoDto } = await import('../../src/dtos/uploadDocumento.dto.js');
    const { value, error } = updateDocumentoDto.validate({ nombre: 'G', categoria: 'guia_rapida' });
    assert.equal(error, undefined);
    assert.equal('categoria' in value, false);
  });

  it('bulk create/update DTOs ignore Documentos (server-owned fields cannot be set)', () => {
    const forged = [{ nombre: 'X', link: 'https://x.test', storagePath: 'hvequipo/documentos/otroTenant/hv/x.pdf', archivoUrl: 'https://evil.test/x' }];
    const created = createHVEquipoDto.validate({ clienteId, Documentos: forged });
    assert.equal(created.error, undefined);
    assert.equal('Documentos' in created.value, false);
    const updated = updateHVEquipoDto.validate({ Fabricante: 'F', Documentos: forged });
    assert.equal(updated.error, undefined);
    assert.equal('Documentos' in updated.value, false);
  });

  it('document links must be http(s)', async () => {
    const { uploadDocumentoDto, updateDocumentoDto } = await import('../../src/dtos/uploadDocumento.dto.js');
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'ftp://x.test/f']) {
      assert.ok(uploadDocumentoDto.validate({ nombre: 'D', link: bad }).error, `should reject ${bad}`);
      assert.ok(updateDocumentoDto.validate({ link: bad }).error, `should reject ${bad}`);
    }
    assert.equal(uploadDocumentoDto.validate({ nombre: 'D', link: 'https://ok.test/a' }).error, undefined);
  });
});
