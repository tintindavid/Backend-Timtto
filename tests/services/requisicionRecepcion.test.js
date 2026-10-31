/**
 * requisiciones-e2-solicitudes-recepcion, tasks 3.1 / 3.2 / 3.4 / 3.5: registering a reception (DB-free world,
 * Firebase mocked through the service seam `deps.storage`).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import router from '../../src/routes/requisicion.routes.js';
import { requisicionRecepcionService } from '../../src/services/requisicionRecepcion.service.js';
import { requisicionService } from '../../src/services/requisicion.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';
import { registrarRecepcionDto, queryRequisicionDto, REQUISICION_VISTAS } from '../../src/dtos/requisicion.dto.js';
import { validate } from '../../src/middlewares/validate.middleware.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { createWorld, oid } from '../helpers/requisicionWorld.js';

const T = 'acme';
let w;
let uploads;
let deleted;
const realStorage = requisicionRecepcionService.deps.storage;
const svc = requisicionRecepcionService;

const fakeStorage = {
  uploadRequisicionEvidencia: async (buffer, name, mime, { tenantId, requisicionId }) => {
    const storagePath = `tenants/${tenantId}/requisiciones/${requisicionId}/recepciones/${name}`;
    uploads.push(storagePath);
    return { nombre: name, url: `https://cdn/${storagePath}`, tipo: mime, storagePath };
  },
  deleteByPath: async (p) => { deleted.push(p); },
};

const L1 = oid();
const L2 = oid();
const mkLine = (lineaId, cantidadSolicitada, over = {}) => ({
  lineaId, descripcion: `Item ${lineaId.slice(-4)}`, unidad: 'caja', cantidadSolicitada, precioEstimado: 10, estadoLinea: 'Pendiente', ...over,
});
const actor = (userId = oid()) => ({ userId, name: 'Bodega' });
const file = (name = 'remision.pdf', mimetype = 'application/pdf') => ({ buffer: Buffer.from('x'), originalname: name, mimetype });
const seed = (over = {}) => w.seedRequisicion({
  estado: 'Aprobada', lineas: [mkLine(L1, 10), mkLine(L2, 4)], ...over,
});
const stored = (id) => w.requisiciones.find((r) => r._id === id);

beforeEach(() => {
  w = createWorld({ tenantId: T });
  uploads = [];
  deleted = [];
  svc.deps.storage = fakeStorage;
});
afterEach(async () => {
  await flushRequisicionNotifications();
  svc.deps.storage = realStorage;
  w.restore();
});

describe('registrar: happy paths', () => {
  it('total reception moves Aprobada -> En_Recepcion, the line to Recibida, stores evidences and event', async () => {
    const r = seed();
    const u = oid();
    const out = await svc.registrar(T, r._id, actor(u), {
      documento: 'REM-1', observacion: 'Todo bien', items: [{ lineaId: L1, cantidadRecibida: 10 }],
    }, [file('a.pdf'), file('b.png', 'image/png')]);
    assert.equal(out.estado, 'En_Recepcion');
    const line = out.lineas.find((l) => String(l.lineaId) === L1);
    assert.equal(line.estadoLinea, 'Recibida');
    assert.equal(line.cantidadRecibida, 10);
    assert.equal(out.lineas.find((l) => String(l.lineaId) === L2).estadoLinea, 'Pendiente');
    assert.equal(out.recepciones.length, 1);
    const rec = out.recepciones[0];
    assert.equal(String(rec.recibidaPor), u);
    assert.equal(rec.documento, 'REM-1');
    assert.deepEqual(rec.evidencias.map((e) => Object.keys(e).sort()), [['nombre', 'tipo', 'url'], ['nombre', 'tipo', 'url']]);
    assert.ok(uploads.every((p) => p.startsWith(`tenants/${T}/requisiciones/${r._id}/recepciones/`)));
    const ev = stored(r._id).timeline.at(-1);
    assert.equal(ev.tipo, 'RECEPCION_REGISTRADA');
    assert.equal(w.writes.count, 1, 'one atomic write');
  });

  it('partial reception -> Recibida_Parcial; a second one completes the line; line stays within the cap', async () => {
    const r = seed();
    await svc.registrar(T, r._id, actor(), { items: [{ lineaId: L1, cantidadRecibida: 4 }] });
    let line = stored(r._id).lineas.find((l) => String(l.lineaId) === L1);
    assert.equal(line.estadoLinea, 'Recibida_Parcial');
    assert.equal(line.cantidadRecibida, 4);
    assert.equal(stored(r._id).estado, 'En_Recepcion');
    await svc.registrar(T, r._id, actor(), { items: [{ lineaId: L1, cantidadRecibida: 6 }] });
    line = stored(r._id).lineas.find((l) => String(l.lineaId) === L1);
    assert.equal(line.estadoLinea, 'Recibida');
    assert.equal(line.cantidadRecibida, 10);
    assert.equal(stored(r._id).recepciones.length, 2);
  });

  it('a line in En_Disputa can be received again and moves to Recibida_Parcial/Recibida', async () => {
    const r = seed({ estado: 'En_Recepcion', lineas: [mkLine(L1, 10, { estadoLinea: 'En_Disputa', cantidadRecibida: 3, cantidadConfirmada: 0 })] });
    await svc.registrar(T, r._id, actor(), { items: [{ lineaId: L1, cantidadRecibida: 7 }] });
    assert.equal(stored(r._id).lineas[0].estadoLinea, 'Recibida');
  });

  it('does not move stock (no inventory movement service is touched)', async () => {
    const r = seed();
    let called = false;
    svc.deps.movimientos = { create: async () => { called = true; } };
    await svc.registrar(T, r._id, actor(), { items: [{ lineaId: L1, cantidadRecibida: 1 }] });
    assert.equal(called, false);
  });

  it('fires requisicion.delivery.registered outside the critical path', async () => {
    const r = seed();
    await svc.registrar(T, r._id, actor(), { items: [{ lineaId: L1, cantidadRecibida: 1 }] });
    await flushRequisicionNotifications();
    assert.ok(w.emits.some((e) => e.event === 'requisicion.delivery.registered'));
  });
});

describe('registrar: rejections write nothing', () => {
  it('exceeds the requested quantity -> 400 CANTIDAD_EXCEDE', async () => {
    const r = seed();
    await assert.rejects(
      svc.registrar(T, r._id, actor(), { items: [{ lineaId: L1, cantidadRecibida: 11 }] }, [file()]),
      (e) => e.statusCode === 400 && e.code === 'CANTIDAD_EXCEDE',
    );
    assert.equal(w.writes.count, 0);
    assert.equal(stored(r._id).estado, 'Aprobada');
    assert.equal(uploads.length, 0, 'validation happens before the upload');
  });

  it('cumulative cap: 8 then 3 on a line of 10 is rejected', async () => {
    const r = seed();
    await svc.registrar(T, r._id, actor(), { items: [{ lineaId: L1, cantidadRecibida: 8 }] });
    await assert.rejects(
      svc.registrar(T, r._id, actor(), { items: [{ lineaId: L1, cantidadRecibida: 3 }] }),
      (e) => e.code === 'CANTIDAD_EXCEDE',
    );
    assert.equal(stored(r._id).lineas[0].cantidadRecibida, 8);
  });

  it('a multi-line reception where one line exceeds writes nothing for the others', async () => {
    const r = seed();
    await assert.rejects(
      svc.registrar(T, r._id, actor(), { items: [{ lineaId: L1, cantidadRecibida: 2 }, { lineaId: L2, cantidadRecibida: 5 }] }),
      (e) => e.code === 'CANTIDAD_EXCEDE',
    );
    assert.equal(w.writes.count, 0);
    assert.equal(stored(r._id).lineas[0].cantidadRecibida, undefined);
  });

  it('zero / negative quantity -> 400', async () => {
    const r = seed();
    for (const q of [0, -1]) {
      await assert.rejects(svc.registrar(T, r._id, actor(), { items: [{ lineaId: L1, cantidadRecibida: q }] }), (e) => e.statusCode === 400);
    }
  });

  it('a line of another requisition -> 400 LINEA_NO_ENCONTRADA', async () => {
    const r = seed();
    await assert.rejects(
      svc.registrar(T, r._id, actor(), { items: [{ lineaId: oid(), cantidadRecibida: 1 }] }),
      (e) => e.statusCode === 400 && e.code === 'LINEA_NO_ENCONTRADA',
    );
  });

  it('inactive lines (Confirmada / Cancelada) are not receivable', async () => {
    const r = seed({ estado: 'En_Recepcion', lineas: [mkLine(L1, 10, { estadoLinea: 'Cancelada' }), mkLine(L2, 4)] });
    await assert.rejects(svc.registrar(T, r._id, actor(), { items: [{ lineaId: L1, cantidadRecibida: 1 }] }), (e) => e.statusCode === 409);
  });

  for (const estado of ['Borrador', 'Enviada', 'En_Aprobacion', 'Rechazada', 'Cancelada', 'Cerrada']) {
    it(`state ${estado} -> 409 TRANSICION_INVALIDA`, async () => {
      const r = seed({ estado });
      await assert.rejects(
        svc.registrar(T, r._id, actor(), { items: [{ lineaId: L1, cantidadRecibida: 1 }] }),
        (e) => e.statusCode === 409 && e.code === 'TRANSICION_INVALIDA',
      );
      assert.equal(w.writes.count, 0);
    });
  }

  it('tenant isolation: another tenant gets 404 and nothing changes', async () => {
    const r = seed();
    await assert.rejects(
      svc.registrar('other', r._id, actor(), { items: [{ lineaId: L1, cantidadRecibida: 1 }] }),
      (e) => e.statusCode === 404,
    );
    assert.equal(w.writes.count, 0);
  });

  it('invalid evidence type / oversized / spoofed content are rejected before writing (real validator)', async () => {
    const r = seed();
    svc.deps.storage = firebaseStorageService;
    const items = [{ lineaId: L1, cantidadRecibida: 1 }];
    await assert.rejects(svc.registrar(T, r._id, actor(), { items }, [file('x.exe', 'application/x-msdownload')]), (e) => e.code === 'INVALID_FILE_TYPE');
    await assert.rejects(
      svc.registrar(T, r._id, actor(), { items }, [{ buffer: Buffer.alloc(5 * 1024 * 1024 + 1), originalname: 'big.png', mimetype: 'image/png' }]),
      (e) => e.code === 'FILE_TOO_LARGE',
    );
    await assert.rejects(svc.registrar(T, r._id, actor(), { items }, [file('fake.png', 'image/png')]), (e) => e.code === 'FILE_CONTENT_MISMATCH');
    assert.equal(w.writes.count, 0);
    assert.equal(stored(r._id).estado, 'Aprobada');
  });

  it('a failing second upload cleans the first one and writes nothing', async () => {
    const r = seed();
    let n = 0;
    svc.deps.storage = {
      ...fakeStorage,
      uploadRequisicionEvidencia: async (...a) => { n += 1; if (n === 2) throw new Error('boom'); return fakeStorage.uploadRequisicionEvidencia(...a); },
    };
    await assert.rejects(svc.registrar(T, r._id, actor(), { items: [{ lineaId: L1, cantidadRecibida: 1 }] }, [file('a.pdf'), file('b.pdf')]));
    assert.equal(deleted.length, 1);
    assert.equal(w.writes.count, 0);
  });

  it('a write that loses the race cleans the uploaded evidences', async () => {
    const r = seed();
    const items = [{ lineaId: L1, cantidadRecibida: 10 }];
    const results = await Promise.allSettled([
      svc.registrar(T, r._id, actor(), { items }, [file('a.pdf')]),
      svc.registrar(T, r._id, actor(), { items }, [file('b.pdf')]),
    ]);
    assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1, 'parallel receptions can never exceed the request');
    assert.equal(stored(r._id).lineas[0].cantidadRecibida, 10);
    assert.equal(deleted.length, 1, 'the loser evidence is removed');
  });
});

describe('route: permission, multipart wiring, DTO and vista por-recibir', () => {
  const route = router.stack.find((l) => l.route && l.route.path === '/:id/recepciones' && l.route.methods.post).route;
  const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json() { return this; } });
  const run = (mw, req) => { let err; mw(req, res(), (e) => { err = e; }); return err; };
  const user = (permissions) => ({ userId: 'u', tenantId: T, role: 'user', permissions });

  it('requires requisiciones:receive or manage-all (403 otherwise)', () => {
    const guard = route.stack[0].handle;
    assert.equal(run(guard, { user: user([PERMISSIONS.REQUISICIONES_CREATE]) })?.statusCode, 403);
    assert.equal(run(guard, { user: user([PERMISSIONS.REQUISICIONES_RECEIVE]) }), undefined);
    assert.equal(run(guard, { user: user([PERMISSIONS.REQUISICIONES_MANAGE_ALL]) }), undefined);
  });

  it('DTO: items arrive as a JSON string; unknown fields and bad items are rejected', () => {
    const body = (b) => ({ body: b });
    assert.equal(run(validate(registrarRecepcionDto), body({ items: JSON.stringify([{ lineaId: L1, cantidadRecibida: 2 }]), documento: 'R-1' })), undefined);
    assert.equal(run(validate(registrarRecepcionDto), body({ items: '[]' }))?.statusCode, 400);
    assert.equal(run(validate(registrarRecepcionDto), body({ items: 'no json' }))?.statusCode, 400);
    assert.equal(run(validate(registrarRecepcionDto), body({ items: [{ lineaId: L1, cantidadRecibida: 0 }] }))?.statusCode, 400);
    assert.equal(run(validate(registrarRecepcionDto), body({ items: [{ lineaId: L1, cantidadRecibida: 1 }], tenantId: 'x' }))?.statusCode, 400);
    assert.equal(run(validate(registrarRecepcionDto), body({ items: [{ lineaId: L1, cantidadRecibida: 1, estadoLinea: 'Recibida' }] }))?.statusCode, 400);
  });

  it('query DTO accepts vista=por-recibir', () => {
    assert.ok(REQUISICION_VISTAS.includes('por-recibir'));
    assert.equal(run(validate(queryRequisicionDto, 'query'), { query: { vista: 'por-recibir' } }), undefined);
  });

  it('vista=por-recibir: only receivers see Aprobada/En_Recepcion with a line left to receive', async () => {
    const pend = seed({ estado: 'Aprobada' });
    seed({ estado: 'Borrador' });
    seed({ estado: 'En_Recepcion', lineas: [mkLine(oid(), 2, { estadoLinea: 'Confirmada', cantidadConfirmada: 2 })] });
    const part = seed({ estado: 'En_Recepcion', lineas: [mkLine(oid(), 2, { estadoLinea: 'Recibida_Parcial', cantidadRecibida: 1 })] });
    const ok = await requisicionService.list(T, 'u', { vista: 'por-recibir' }, {}, { canReceive: true });
    assert.deepEqual(ok.data.map((x) => String(x._id)).sort(), [pend._id, part._id].sort());
    const none = await requisicionService.list(T, 'u', { vista: 'por-recibir' }, {}, {});
    assert.equal(none.data.length, 0);
  });
});
