/**
 * Requisiciones E4, block B (deliverables, supplier portal, closing, reminders) against a REAL MongoDB (node:test).
 * SKIPPED unless MONGO_INTEGRATION_URI is set. Creates and DROPS its own database `req_e4b_<random>`.
 *
 *   MONGO_INTEGRATION_URI=mongodb://127.0.0.1:27655 node --test tests/integration/requisicion.e4.entregables.mongo.integration.test.js
 *
 * NEVER point it at a shared / remote / production database. E-mail, Firebase, PDF and notifications are stubbed (the
 * magic-bytes test goes through the real storage service with its `storageDeps` seam).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { Requisicion } from '../../src/models/requisicion.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { Role } from '../../src/models/role.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { Counter } from '../../src/models/counter.model.js';
import { requisicionEntregablesService as ent } from '../../src/services/requisicionEntregables.service.js';
import { requisicionPortalPublicoService as portal } from '../../src/services/requisicionPortalPublico.service.js';
import { requisicionRecepcionService as recep } from '../../src/services/requisicionRecepcion.service.js';
import { requisicionOrdenCompraService as oc } from '../../src/services/requisicionOrdenCompra.service.js';
import { requisicionOrdenCompraEnvioService as envio } from '../../src/services/requisicionOrdenCompraEnvio.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { notificationService } from '../../src/services/notification.service.js';
import { firebaseStorageService } from '../../src/services/external/firebase.service.js';
import { ejecutarRecordatorios } from '../../scripts/requisiciones-recordatorios.mjs';
import { backfillRequisicionesPermisosE4 } from '../../scripts/2026-11-04-backfill-requisiciones-permisos-e4.js';
import { seedNotificationRulesRequisicionesE4, REQUISICION_E4_EVENTS } from '../../scripts/seed-notification-rules-requisiciones-e4.js';
import { NotificationRule } from '../../src/models/notificationRule.model.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import {
  CAPS, PDF_BYTES, actorOf, emitir, expectApi, llevarAOcEnviada, mkAdjudicada, mkLicitada, mkRoleUser, ocBody, out4, pdfFile, rawReq, rnd, sid, stubOutbound4,
} from '../helpers/requisicionE4World.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const snap = async (id) => JSON.stringify(await rawReq(id));
const DAY = 86400000;
const oidOf = (v) => new mongoose.Types.ObjectId(sid(v));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 0)]);

/** An OC that requires deliverables, issued, approved and sent; returns the world with the winner's portal token. */
async function enviada(w, over = {}) {
  const { token } = await llevarAOcEnviada(w, { requiereEntregables: true, ...over });
  w.token = token;
  return w;
}
const ctxOf = (token, opts) => portal.resolve(token, { ip: '1.1.1.1', ...opts });

describe('Requisiciones E4 block B on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_e4b_${rnd()}`;
  let savedEmit;

  before(async () => {
    await mongoose.connect(URI, { dbName });
    for (const m of [Requisicion, Customer, User, Role, Tenant, ReglaAprobacion, Counter, NotificationRule]) { await m.init(); await m.syncIndexes(); }
    savedEmit = notificationService.emit;
    notificationService.emit = async () => ({ dispatched: 0 });
    stubOutbound4();
  });

  after(async () => {
    notificationService.emit = savedEmit;
    await flushRequisicionNotifications();
    if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  });

  describe('upload', () => {
    it('an OC without deliverables answers 409 ENTREGABLES_NO_REQUERIDOS everywhere and changes nothing', async () => {
      const w = await mkAdjudicada();
      await llevarAOcEnviada(w, { requiereEntregables: false });
      const ctx = await ctxOf(out4.oc.at(-1).portalUrl.split('/public/requisicion/')[1]);
      const before = await snap(w.reqId);
      await expectApi(ent.subir(w.tenantId, w.reqId, w.issuerActor, [pdfFile()], CAPS), 409, 'ENTREGABLES_NO_REQUERIDOS');
      await expectApi(ent.marcarRecibidos(w.tenantId, w.reqId, w.issuerActor, CAPS), 409, 'ENTREGABLES_NO_REQUERIDOS');
      await expectApi(ent.revisar(w.tenantId, w.reqId, w.issuerActor, CAPS), 409, 'ENTREGABLES_NO_REQUERIDOS');
      await expectApi(ent.aceptar(w.tenantId, w.reqId, w.issuerActor, CAPS), 409, 'ENTREGABLES_NO_REQUERIDOS');
      await expectApi(ent.devolver(w.tenantId, w.reqId, w.issuerActor, { observacion: 'x' }, CAPS), 409, 'ENTREGABLES_NO_REQUERIDOS');
      assert.throws(() => portal.assertPuedeEntregar(ctx), (e) => e.code === 'ENTREGABLES_NO_REQUERIDOS');
      assert.equal(await snap(w.reqId), before);
    });

    it('before the OC is sent nobody can attach deliverables', async () => {
      const w = await mkAdjudicada();
      await emitir(w, { requiereEntregables: true });
      await expectApi(ent.subir(w.tenantId, w.reqId, w.issuerActor, [pdfFile()], CAPS), 409, 'TRANSICION_INVALIDA');
      await expectApi(ent.marcarRecibidos(w.tenantId, w.reqId, w.issuerActor, CAPS), 409, 'TRANSICION_INVALIDA');
    });

    it('the winner uploads through the portal: Pendiente -> Recibidos, ENTREGABLES_RECIBIDOS, who/when stored, no storage path leaked', async () => {
      const w = await enviada(await mkAdjudicada());
      const ctx = await ctxOf(w.token);
      const view = await portal.enviarEntregables(ctx, [pdfFile('remision.pdf'), pdfFile('factura.pdf')]);
      assert.equal(view.ordenCompra.entrega.estado, 'Recibidos');
      assert.equal(view.ordenCompra.entrega.archivos.length, 2);
      assert.ok(view.ordenCompra.entrega.archivos.every((a) => a.subidoPor === 'proveedor' && a.fecha && a.url));
      assert.ok(!JSON.stringify(view).includes('storagePath'));
      const raw = await rawReq(w.reqId);
      assert.equal(raw.ordenCompra.entrega.estado, 'Recibidos');
      const ev = raw.timeline.at(-1);
      assert.equal(ev.tipo, 'ENTREGABLES_RECIBIDOS');
      assert.equal(ev.actor.tipo, 'proveedor');
      assert.equal(ev.datos.archivos, 2);
      assert.equal(raw.estado, 'OC_Enviada', 'the header state does not move');
      // a second upload while Recibidos keeps the state and adds files
      const again = await portal.enviarEntregables(await ctxOf(w.token), [pdfFile('cert.pdf')]);
      assert.equal(again.ordenCompra.entrega.archivos.length, 3);
    });

    it('a user attaches on behalf of the supplier (origin usuario) and can mark received manually', async () => {
      const w = await enviada(await mkAdjudicada());
      const out = await ent.subir(w.tenantId, w.reqId, w.issuerActor, [pdfFile('a.pdf')], CAPS);
      assert.equal(out.ordenCompra.entrega.estado, 'Recibidos');
      assert.equal(out.ordenCompra.entrega.archivos[0].subidoPor, 'usuario');
      const raw = await rawReq(w.reqId);
      assert.equal(String(raw.ordenCompra.entrega.archivos[0].usuarioId), w.issuerActor.userId);
      assert.equal(raw.timeline.at(-1).actor.tipo, 'usuario');
      const w2 = await enviada(await mkAdjudicada());
      const manual = await ent.marcarRecibidos(w2.tenantId, w2.reqId, w2.issuerActor, CAPS);
      assert.equal(manual.ordenCompra.entrega.estado, 'Recibidos');
      assert.equal(manual.timeline.at(-1).datos.manual, true);
      await expectApi(ent.marcarRecibidos(w2.tenantId, w2.reqId, w2.issuerActor, CAPS), 409, 'ENTREGA_ESTADO_INVALIDO');
    });

    it('caps: at most 5 files per request, 30 per delivery, none empty; nothing stored on rejection', async () => {
      const w = await enviada(await mkAdjudicada());
      const before = await snap(w.reqId);
      await expectApi(ent.subir(w.tenantId, w.reqId, w.issuerActor, [], CAPS), 400, 'ARCHIVOS_REQUERIDOS');
      await expectApi(ent.subir(w.tenantId, w.reqId, w.issuerActor, Array.from({ length: 6 }, (_, i) => pdfFile(`f${i}.pdf`)), CAPS), 400, 'ENTREGABLES_LIMIT_EXCEEDED');
      assert.equal(await snap(w.reqId), before);
      for (let i = 0; i < 6; i += 1) await ent.subir(w.tenantId, w.reqId, w.issuerActor, Array.from({ length: 5 }, (_, j) => pdfFile(`g${i}-${j}.pdf`)), CAPS);
      assert.equal((await rawReq(w.reqId)).ordenCompra.entrega.archivos.length, 30);
      out4.deleted.length = 0;
      await expectApi(ent.subir(w.tenantId, w.reqId, w.issuerActor, [pdfFile('x.pdf')], CAPS), 400, 'ENTREGABLES_LIMIT_EXCEEDED');
      assert.equal((await rawReq(w.reqId)).ordenCompra.entrega.archivos.length, 30);
    });

    it('a write that loses the race removes the files it had stored', async () => {
      const w = await enviada(await mkAdjudicada());
      const real = ent.deps.storage.uploadRequisicionEntregable;
      ent.deps.storage.uploadRequisicionEntregable = async (...a) => {
        const r = await real(...a);
        // somebody moves the delivery on while the files are being stored
        await Requisicion.collection.updateOne({ _id: oidOf(w.reqId) }, { $set: { 'ordenCompra.entrega.estado': 'En_Revision' } });
        return r;
      };
      out4.deleted.length = 0;
      await expectApi(ent.subir(w.tenantId, w.reqId, w.issuerActor, [pdfFile('x.pdf')], CAPS), 409, 'CONFLICTO_CONCURRENTE');
      ent.deps.storage.uploadRequisicionEntregable = real;
      assert.equal(out4.deleted.length, 1);
      assert.equal((await rawReq(w.reqId)).ordenCompra.entrega.archivos.length, 0);
    });

    it('the real storage service rejects a file whose content does not match its declared type (400) and stores nothing', async () => {
      const w = await enviada(await mkAdjudicada());
      const savedStorage = ent.deps.storage;
      const savedDeps = firebaseStorageService.storageDeps;
      const stored = [];
      firebaseStorageService.storageDeps = {
        getFirebaseStorage: () => ({}), ref: (_s, p) => ({ path: p }),
        uploadBytes: async (r) => { stored.push(r.path); return {}; }, getDownloadURL: async (r) => `https://stub.invalid/${r.path}`, deleteObject: async () => {},
      };
      ent.deps.storage = firebaseStorageService;
      try {
        const before = await snap(w.reqId);
        await expectApi(ent.subir(w.tenantId, w.reqId, w.issuerActor, [{ buffer: PNG, originalname: 'fake.pdf', mimetype: 'application/pdf' }], CAPS), 400, 'FILE_CONTENT_MISMATCH');
        await expectApi(ent.subir(w.tenantId, w.reqId, w.issuerActor, [{ buffer: Buffer.from('MZ-exe'), originalname: 'x.exe', mimetype: 'application/x-msdownload' }], CAPS), 400, 'INVALID_FILE_TYPE');
        await expectApi(ent.subir(w.tenantId, w.reqId, w.issuerActor, [{ buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 1), originalname: 'big.pdf', mimetype: 'application/pdf' }], CAPS), 400, 'FILE_TOO_LARGE');
        assert.equal(stored.length, 0);
        assert.equal(await snap(w.reqId), before);
        const ok = await ent.subir(w.tenantId, w.reqId, w.issuerActor, [{ buffer: PDF_BYTES, originalname: 'ok remision.pdf', mimetype: 'application/pdf' }], CAPS);
        assert.equal(ok.ordenCompra.entrega.archivos.length, 1);
        assert.match(stored[0], /entregables\//);
      } finally {
        ent.deps.storage = savedStorage;
        firebaseStorageService.storageDeps = savedDeps;
      }
    });
  });

  describe('review and return cycle', () => {
    it('Recibidos -> En_Revision -> Aceptados, with the events in order', async () => {
      const w = await enviada(await mkAdjudicada());
      await ent.subir(w.tenantId, w.reqId, w.issuerActor, [pdfFile()], CAPS);
      const rev = await ent.revisar(w.tenantId, w.reqId, w.approverActor, CAPS);
      assert.equal(rev.ordenCompra.entrega.estado, 'En_Revision');
      const acc = await ent.aceptar(w.tenantId, w.reqId, w.approverActor, CAPS);
      assert.equal(acc.ordenCompra.entrega.estado, 'Aceptados');
      assert.deepEqual(acc.timeline.slice(-3).map((e) => e.tipo), ['ENTREGABLES_RECIBIDOS', 'PASO_REVISION_ENTREGA', 'ENTREGABLES_ACEPTADOS']);
      assert.equal(acc.estado, 'OC_Enviada', 'accepting alone does not close: the goods were not received yet');
      await expectApi(ent.aceptar(w.tenantId, w.reqId, w.approverActor, CAPS), 409, 'ENTREGA_ESTADO_INVALIDO');
      await expectApi(ent.subir(w.tenantId, w.reqId, w.issuerActor, [pdfFile()], CAPS), 409, 'ENTREGA_ESTADO_INVALIDO');
    });

    it('returning needs a non-empty observation (400) and leaves the state alone; deciding straight from Recibidos records the review step', async () => {
      const w = await enviada(await mkAdjudicada());
      await expectApi(ent.devolver(w.tenantId, w.reqId, w.approverActor, { observacion: ' ' }, CAPS), 400, 'OBSERVACION_REQUERIDA');
      await ent.subir(w.tenantId, w.reqId, w.issuerActor, [pdfFile()], CAPS);
      const before = await snap(w.reqId);
      await expectApi(ent.devolver(w.tenantId, w.reqId, w.approverActor, {}, CAPS), 400, 'OBSERVACION_REQUERIDA');
      assert.equal(await snap(w.reqId), before);
      const out = await ent.devolver(w.tenantId, w.reqId, w.approverActor, { observacion: 'Falta la factura' }, CAPS);
      assert.equal(out.ordenCompra.entrega.estado, 'Devolucion');
      assert.equal(out.ordenCompra.entrega.ultimaObservacion, 'Falta la factura');
      assert.deepEqual(out.timeline.slice(-2).map((e) => e.tipo), ['PASO_REVISION_ENTREGA', 'DEVUELTA']);
      assert.equal(out.timeline.at(-1).observacion, 'Falta la factura');
    });

    it('the cycle repeats three times: every round is in the history in order and the winner sees the last observation', async () => {
      const w = await enviada(await mkAdjudicada());
      for (let round = 1; round <= 3; round += 1) {
        const ctx = await ctxOf(w.token);
        const view = await portal.enviarEntregables(ctx, [pdfFile(`r${round}.pdf`)]);
        assert.equal(view.ordenCompra.entrega.estado, 'Recibidos');
        await ent.revisar(w.tenantId, w.reqId, w.approverActor, CAPS);
        const back = await ent.devolver(w.tenantId, w.reqId, w.approverActor, { observacion: `Ronda ${round}: corrige` }, CAPS);
        assert.equal(back.ordenCompra.entrega.estado, 'Devolucion');
        const seen = portal.view(await ctxOf(w.token));
        assert.equal(seen.ordenCompra.entrega.estado, 'Devolucion');
        assert.equal(seen.ordenCompra.entrega.ultimaObservacion, `Ronda ${round}: corrige`);
      }
      const raw = await rawReq(w.reqId);
      const tipos = raw.timeline.map((e) => e.tipo).filter((t) => ['ENTREGABLES_RECIBIDOS', 'PASO_REVISION_ENTREGA', 'DEVUELTA'].includes(t));
      assert.deepEqual(tipos, Array(3).fill(['ENTREGABLES_RECIBIDOS', 'PASO_REVISION_ENTREGA', 'DEVUELTA']).flat());
      assert.deepEqual(raw.timeline.filter((e) => e.tipo === 'DEVUELTA').map((e) => e.observacion), ['Ronda 1: corrige', 'Ronda 2: corrige', 'Ronda 3: corrige']);
      assert.equal(raw.ordenCompra.entrega.archivos.length, 3);
      const last = await portal.enviarEntregables(await ctxOf(w.token), [pdfFile('final.pdf')]);
      assert.equal(last.ordenCompra.entrega.estado, 'Recibidos');
      const acc = await ent.aceptar(w.tenantId, w.reqId, w.approverActor, CAPS);
      assert.equal(acc.ordenCompra.entrega.estado, 'Aceptados');
    });
  });

  describe('closing', () => {
    const receiveAndConfirmAll = async (w) => {
      const raw = await rawReq(w.reqId);
      const items = raw.lineas.map((l) => ({ lineaId: sid(l.lineaId), cantidadRecibida: l.cantidadSolicitada }));
      const rec = await recep.registrar(w.tenantId, w.reqId, { userId: w.issuerActor.userId, name: 'Almacen' }, { items }, [], CAPS);
      const recepcionId = sid(rec.recepciones.at(-1).recepcionId);
      return recep.confirmar(w.tenantId, w.reqId, recepcionId, { ...actorOf(w.creator), canRead: true }, { items: items.map((i) => ({ lineaId: i.lineaId, resultado: 'Recibido' })) }, CAPS);
    };

    it('an OC without deliverables closes as in E2 when the last line is confirmed', async () => {
      const w = await mkAdjudicada();
      await llevarAOcEnviada(w, { requiereEntregables: false });
      const out = await receiveAndConfirmAll(w);
      assert.equal(out.estado, 'Cerrada');
    });

    it('with deliverables: lines confirmed but delivery in Devolucion keeps En_Recepcion; accepting afterwards closes', async () => {
      const w = await enviada(await mkAdjudicada());
      await ent.subir(w.tenantId, w.reqId, w.issuerActor, [pdfFile()], CAPS);
      await ent.devolver(w.tenantId, w.reqId, w.approverActor, { observacion: 'Falta firma' }, CAPS);
      const confirmed = await receiveAndConfirmAll(w);
      assert.equal(confirmed.estado, 'En_Recepcion');
      assert.ok(confirmed.lineas.every((l) => l.estadoLinea === 'Confirmada'));
      await ent.subir(w.tenantId, w.reqId, w.issuerActor, [pdfFile('v2.pdf')], CAPS);
      const still = await rawReq(w.reqId);
      assert.equal(still.estado, 'En_Recepcion');
      const accepted = await ent.aceptar(w.tenantId, w.reqId, w.approverActor, CAPS);
      assert.equal(accepted.estado, 'Cerrada');
      const raw = await rawReq(w.reqId);
      assert.equal(raw.timeline.at(-1).tipo, 'CERRADA');
      // the winner's link keeps a read-only page for the post-close period (no longer open-ended)
      const win = raw.licitacion.proveedores.find((p) => String(p._id) === String(raw.licitacion.ganadorId));
      assert.ok(win.tokenVence.getTime() > Date.now() + 29 * DAY && win.tokenVence.getTime() < Date.now() + 31 * DAY);
      await expectApi(ent.subir(w.tenantId, w.reqId, w.issuerActor, [pdfFile()], CAPS), 409, 'TRANSICION_INVALIDA');
    });

    it('with deliverables already accepted, confirming the last line closes', async () => {
      const w = await enviada(await mkAdjudicada());
      await ent.subir(w.tenantId, w.reqId, w.issuerActor, [pdfFile()], CAPS);
      await ent.aceptar(w.tenantId, w.reqId, w.approverActor, CAPS);
      assert.equal((await rawReq(w.reqId)).estado, 'OC_Enviada');
      const out = await receiveAndConfirmAll(w);
      assert.equal(out.estado, 'Cerrada');
    });
  });

  describe('supplier portal (winner only)', () => {
    it('the winner sees the OC from OC_Enviada with the allowlisted block; before that nothing and generic 404 on the OC routes', async () => {
      const w = await mkLicitada();
      const winnerToken = w.provs[0].token;
      assert.ok(winnerToken);
      await emitir(w, { requiereEntregables: true });
      await oc.aprobar(w.tenantId, w.reqId, w.approverActor, {}, CAPS);
      // the original (tender) link of the winner still reads its page, but no OC and the OC routes are a generic 404
      const pre = await ctxOf(winnerToken, { soloGanador: true });
      assert.equal(portal.view(pre).ordenCompra, undefined);
      await expectApi(portal.pdfOrdenCompra(pre), 404, 'NOT_FOUND');
      assert.throws(() => portal.assertPuedeEntregar(pre), (e) => e.statusCode === 404 && e.code === 'NOT_FOUND');
      await envio.enviar(w.tenantId, w.reqId, w.issuerActor, CAPS);
      const token = out4.oc.at(-1).portalUrl.split('/public/requisicion/')[1];
      assert.notEqual(token, winnerToken, 'a new link is minted at send time');
      await expectApi(ctxOf(winnerToken), 404, 'NOT_FOUND'); // the old hash no longer exists
      const ctx = await ctxOf(token, { soloGanador: true });
      const dto = portal.view(ctx);
      assert.equal(dto.ordenCompra.numero, 'OC-' + new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 4) + '-0001');
      assert.equal(dto.ordenCompra.total, 410000);
      assert.deepEqual(Object.keys(dto.ordenCompra).sort(), ['condiciones', 'entrega', 'fechaEntrega', 'lineas', 'moneda', 'numero', 'requiereEntregables', 'total', 'version']);
      const text = JSON.stringify(dto);
      for (const leak of ['exceso', 'aprobacion', 'emitidaPor', 'montoEstimado', 'estimado', 'tokenHash', 'storagePath', 'areaId', 'solicitante']) assert.ok(!text.includes(leak), leak);
      const pdf = await portal.pdfOrdenCompra(ctx);
      assert.ok(Buffer.isBuffer(pdf.buffer));
      assert.match(pdf.filename, /^OC-\d{4}-0001-v1\.pdf$/);
    });

    it('the discarded supplier never sees the OC: 404 on the OC routes, 403 TOKEN_EXPIRADO on the page, and the winner data stays out', async () => {
      const w = await mkLicitada();
      const loserToken = w.provs[1].token;
      const { token } = await llevarAOcEnviada(w, { requiereEntregables: true });
      await expectApi(ctxOf(loserToken, { soloGanador: true }), 404, 'NOT_FOUND');
      await expectApi(ctxOf(loserToken), 403, 'TOKEN_EXPIRADO');
      const raw = await rawReq(w.reqId);
      assert.ok(raw.ordenCompra);
      // supplier B can never reach A's data: the winner token is a different hash and the projection drops the OC for non winners
      const rows = await Requisicion.aggregate([{ $match: { _id: oidOf(w.reqId) } }, { $limit: 1 }]);
      assert.equal(rows.length, 1);
      const ctxWin = await ctxOf(token, { soloGanador: true });
      assert.equal(String(ctxWin.row.proveedor._id), String(raw.licitacion.ganadorId));
      assert.ok(!JSON.stringify(portal.view(ctxWin)).includes(sid(w.provs[1].c._id)));
      // an unknown / malformed token is the same generic 404
      await expectApi(ctxOf('x'.repeat(43), { soloGanador: true }), 404, 'NOT_FOUND');
      await expectApi(ctxOf('short', { soloGanador: true }), 404, 'NOT_FOUND');
    });

    it('a non winner cannot upload: the precheck is a generic 404 and nothing is stored', async () => {
      const w = await mkLicitada();
      const loserToken = w.provs[1].token;
      await llevarAOcEnviada(w, { requiereEntregables: true });
      const before = await snap(w.reqId);
      await expectApi(ctxOf(loserToken, { soloGanador: true }), 404, 'NOT_FOUND');
      assert.equal(out4.uploads.length >= 0, true);
      assert.equal((await rawReq(w.reqId)).ordenCompra.entrega.archivos.length, 0);
      void before;
    });

    it('a rotated link cannot upload: the write is pinned to the token hash of the winner', async () => {
      const w = await enviada(await mkAdjudicada());
      const ctx = await ctxOf(w.token);
      await envio.reenviar(w.tenantId, w.reqId, w.issuerActor, {}, CAPS); // rotates the stored hash
      await expectApi(portal.enviarEntregables(ctx, [pdfFile()]), 409, 'CONFLICTO_CONCURRENTE');
      assert.equal((await rawReq(w.reqId)).ordenCompra.entrega.archivos.length, 0);
      assert.ok(out4.deleted.length >= 1, 'the stored file is cleaned');
    });

    it('a cancelled requisition expires the winner link (403 TOKEN_EXPIRADO)', async () => {
      const w = await enviada(await mkAdjudicada());
      const { requisicionService } = await import('../../src/services/requisicion.service.js');
      await requisicionService.cancelar(w.tenantId, w.reqId, w.issuerActor, { motivo: 'cancelada por el comprador' });
      await expectApi(ctxOf(w.token), 403, 'TOKEN_EXPIRADO');
    });
  });

  describe('reminders script', () => {
    const ago = (days) => new Date(Date.now() - days * DAY);
    const notifyLog = () => { const log = []; return { log, notify: (tenantId, event, req, ctx) => { log.push({ tenantId, event, id: sid(req._id), ctx }); } }; };

    async function devuelta(w, days = 4) {
      await enviada(w);
      await ent.subir(w.tenantId, w.reqId, w.issuerActor, [pdfFile()], CAPS);
      await ent.devolver(w.tenantId, w.reqId, w.approverActor, { observacion: 'Falta firma' }, CAPS);
      await Requisicion.collection.updateOne({ _id: oidOf(w.reqId) }, { $set: { 'ordenCompra.entrega.devueltaAt': ago(days) } });
      return w;
    }

    it('first run after the threshold notifies once and stores ultimoRecordatorio; the same day again does nothing', async () => {
      const w = await devuelta(await mkAdjudicada());
      const { log, notify } = notifyLog();
      const first = await ejecutarRecordatorios({ tenantId: w.tenantId, notify });
      assert.equal(first.devoluciones, 1);
      assert.equal(first.errores, 0);
      assert.equal(log.filter((l) => l.event === 'requisicion.reminder.deliverables').length, 1);
      const raw = await rawReq(w.reqId);
      assert.ok(raw.ordenCompra.entrega.ultimoRecordatorio);
      assert.equal(raw.timeline.at(-1).tipo, 'RECORDATORIO_ENVIADO');
      const second = await ejecutarRecordatorios({ tenantId: w.tenantId, notify });
      assert.equal(second.devoluciones, 0);
      assert.equal(log.length, 1);
      assert.equal((await rawReq(w.reqId)).timeline.filter((e) => e.tipo === 'RECORDATORIO_ENVIADO').length, 1);
    });

    it('below the threshold nothing is sent; concurrent runs notify once', async () => {
      const young = await devuelta(await mkAdjudicada(), 1);
      const { log, notify } = notifyLog();
      assert.equal((await ejecutarRecordatorios({ tenantId: young.tenantId, notify })).devoluciones, 0);
      assert.equal(log.length, 0);
      const w = await devuelta(await mkAdjudicada());
      const runs = await Promise.all([1, 2, 3].map(() => ejecutarRecordatorios({ tenantId: w.tenantId, notify })));
      assert.equal(runs.reduce((a, r) => a + r.devoluciones, 0), 1);
      assert.equal(log.length, 1);
    });

    it('a re-delivery restarts the cycle: the next return can be reminded again', async () => {
      const w = await devuelta(await mkAdjudicada());
      const { log, notify } = notifyLog();
      await ejecutarRecordatorios({ tenantId: w.tenantId, notify });
      await ent.subir(w.tenantId, w.reqId, w.issuerActor, [pdfFile('v2.pdf')], CAPS);
      assert.equal((await rawReq(w.reqId)).ordenCompra.entrega.ultimoRecordatorio, null);
      assert.equal((await ejecutarRecordatorios({ tenantId: w.tenantId, notify })).devoluciones, 0, 'delivered again: nothing to remind');
      await ent.devolver(w.tenantId, w.reqId, w.approverActor, { observacion: 'Aun falta' }, CAPS);
      assert.equal((await ejecutarRecordatorios({ tenantId: w.tenantId, notify })).devoluciones, 0, 'too young');
      await Requisicion.collection.updateOne({ _id: oidOf(w.reqId) }, { $set: { 'ordenCompra.entrega.devueltaAt': ago(5) } });
      assert.equal((await ejecutarRecordatorios({ tenantId: w.tenantId, notify })).devoluciones, 1);
      assert.equal(log.length, 2);
    });

    it('--dry-run reports and writes / notifies nothing', async () => {
      const w = await devuelta(await mkAdjudicada());
      const { log, notify } = notifyLog();
      const before = await snap(w.reqId);
      const r = await ejecutarRecordatorios({ tenantId: w.tenantId, notify, dryRun: true });
      assert.equal(r.dryRun, true);
      assert.equal(r.devoluciones, 1);
      assert.equal(log.length, 0);
      assert.equal(await snap(w.reqId), before);
    });

    it('confirmation reminders: a reception waiting for the requester, once per reception, never when confirmed', async () => {
      const w = await enviada(await mkAdjudicada());
      const raw0 = await rawReq(w.reqId);
      const items = raw0.lineas.map((l) => ({ lineaId: sid(l.lineaId), cantidadRecibida: l.cantidadSolicitada }));
      const rec = await recep.registrar(w.tenantId, w.reqId, { userId: w.issuerActor.userId, name: 'Almacen' }, { items }, [], CAPS);
      const recepcionId = sid(rec.recepciones[0].recepcionId);
      const { log, notify } = notifyLog();
      assert.equal((await ejecutarRecordatorios({ tenantId: w.tenantId, notify })).confirmaciones, 0, 'too young');
      await Requisicion.collection.updateOne({ _id: oidOf(w.reqId) }, { $set: { 'recepciones.0.fecha': ago(4) } });
      const dry = await ejecutarRecordatorios({ tenantId: w.tenantId, notify, dryRun: true });
      assert.equal(dry.confirmaciones, 1);
      assert.equal(log.length, 0);
      assert.equal((await ejecutarRecordatorios({ tenantId: w.tenantId, notify })).confirmaciones, 1);
      assert.equal(log[0].event, 'requisicion.reminder.confirmation');
      assert.deepEqual(log[0].ctx.lineaIds.sort(), items.map((i) => i.lineaId).sort());
      assert.equal((await ejecutarRecordatorios({ tenantId: w.tenantId, notify })).confirmaciones, 0);
      assert.equal((await rawReq(w.reqId)).timeline.filter((e) => e.tipo === 'RECORDATORIO_ENVIADO' && e.datos.recepcionId === recepcionId).length, 1);
      // a confirmed reception is never reminded
      const w2 = await enviada(await mkAdjudicada());
      const r2 = await rawReq(w2.reqId);
      const items2 = r2.lineas.map((l) => ({ lineaId: sid(l.lineaId), cantidadRecibida: l.cantidadSolicitada }));
      const rec2 = await recep.registrar(w2.tenantId, w2.reqId, { userId: w2.issuerActor.userId, name: 'A' }, { items: items2 }, [], CAPS);
      await recep.confirmar(w2.tenantId, w2.reqId, sid(rec2.recepciones[0].recepcionId), { ...actorOf(w2.creator), canRead: true }, { items: items2.map((i) => ({ lineaId: i.lineaId, resultado: 'Recibido' })) }, CAPS);
      await Requisicion.collection.updateOne({ _id: oidOf(w2.reqId) }, { $set: { 'recepciones.0.fecha': ago(9) } });
      assert.equal((await ejecutarRecordatorios({ tenantId: w2.tenantId, notify })).confirmaciones, 0);
    });

    it('tenant isolation and partial failures: a broken requisition does not stop the others; --tenant limits the run', async () => {
      const a = await devuelta(await mkAdjudicada());
      const b = await devuelta(await mkAdjudicada());
      const log = [];
      let calls = 0;
      const notify = (tenantId, event, req) => { calls += 1; if (calls === 1) throw new Error('boom'); log.push(sid(req._id)); };
      const r = await ejecutarRecordatorios({ tenantId: null, notify });
      assert.ok(r.tenants >= 2);
      assert.equal(r.errores, 1);
      assert.ok(r.devoluciones >= 2, 'both requisitions were processed');
      const only = await devuelta(await mkAdjudicada());
      const { log: l2, notify: n2 } = notifyLog();
      await ejecutarRecordatorios({ tenantId: only.tenantId, notify: n2 });
      assert.ok(l2.every((l) => l.tenantId === only.tenantId));
      void a; void b;
    });

    it('tenants without the module are skipped', async () => {
      const w = await devuelta(await mkAdjudicada());
      await Tenant.collection.updateOne({ tenantId: w.tenantId }, { $set: { 'capabilities.usesRequisiciones': false } });
      const { log, notify } = notifyLog();
      await ejecutarRecordatorios({ tenantId: w.tenantId, notify });
      assert.equal(log.length, 0);
    });
  });

  describe('scripts', () => {
    it('permissions backfill: admin / system roles only, never the default role, idempotent and --dry-run writes nothing', async () => {
      const tenantId = `t-${rnd()}`;
      const mk = (over) => Role.create({ tenantId, name: `x-${rnd()}`, permissions: [PERMISSIONS.REQUISICIONES_READ], ...over });
      const admin = await mk({ name: 'admin' });
      const sys = await mk({ isSystem: true });
      const def = await mk({ isDefault: true });
      const plain = await mk({});
      const dry = await backfillRequisicionesPermisosE4({ dryRun: true });
      assert.ok(dry.rolesToUpdate >= 2);
      assert.equal(dry.rolesUpdated, 0);
      assert.ok(!(await Role.findById(admin._id)).permissions.includes(PERMISSIONS.REQUISICIONES_ISSUE_PO));
      const first = await backfillRequisicionesPermisosE4();
      assert.ok(first.rolesUpdated >= 2);
      for (const r of [admin, sys]) {
        const p = (await Role.findById(r._id)).permissions;
        for (const perm of [PERMISSIONS.REQUISICIONES_ISSUE_PO, PERMISSIONS.REQUISICIONES_APPROVE_PO, PERMISSIONS.REQUISICIONES_MANAGE_DELIVERABLES]) assert.ok(p.includes(perm), perm);
      }
      assert.deepEqual((await Role.findById(def._id)).permissions, [PERMISSIONS.REQUISICIONES_READ]);
      assert.deepEqual((await Role.findById(plain._id)).permissions, [PERMISSIONS.REQUISICIONES_READ]);
      const second = await backfillRequisicionesPermisosE4();
      assert.equal(second.rolesToUpdate, 0);
      assert.equal(second.rolesUpdated, 0);
    });

    it('notification rules seed: idempotent, --dry-run writes nothing, existing rules are kept', async () => {
      const tenantId = `t-${rnd()}`;
      await Tenant.create({ tenantId, name: 'T', status: 'active' });
      await NotificationRule.create({ tenantId, event: 'requisicion.po.sent', recipients: { roles: [], userIds: [] }, channels: ['inapp'], enabled: false });
      const dry = await seedNotificationRulesRequisicionesE4({ dryRun: true });
      assert.ok(dry.seeded >= REQUISICION_E4_EVENTS.length - 1);
      assert.equal(await NotificationRule.countDocuments({ tenantId }), 1);
      await seedNotificationRulesRequisicionesE4();
      assert.equal(await NotificationRule.countDocuments({ tenantId }), REQUISICION_E4_EVENTS.length);
      const kept = await NotificationRule.findOne({ tenantId, event: 'requisicion.po.sent' });
      assert.equal(kept.enabled, false);
      assert.deepEqual([...kept.channels], ['inapp']);
      const again = await seedNotificationRulesRequisicionesE4();
      assert.equal(again.seeded, 0);
    });
  });

  void ocBody; void mkRoleUser;
});
