/**
 * Requisiciones E3 round 2 (review fixes) against a REAL MongoDB: instrucciones instead of the internal justification,
 * deadline extension, bounded quotation history + upload cleanup, hard expiry of the winner link, send-first resend,
 * fail-fast sending and deterministic concurrency. SKIPPED unless MONGO_INTEGRATION_URI is set (own database, dropped).
 *
 *   MONGO_INTEGRATION_URI=mongodb://127.0.0.1:27652 node --test tests/integration/requisicion.e3.round2.mongo.integration.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import '../../src/models/area.model.js';
import '../../src/models/tipoRequisicion.model.js';
import { Requisicion } from '../../src/models/requisicion.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { requisicionLicitacionService as lic } from '../../src/services/requisicionLicitacion.service.js';
import { requisicionLicitacionCotizacionService as cot } from '../../src/services/requisicionLicitacionCotizacion.service.js';
import { requisicionGanadorService as gan } from '../../src/services/requisicionGanador.service.js';
import { requisicionPortalPublicoService as portal } from '../../src/services/requisicionPortalPublico.service.js';
import { notificationService } from '../../src/services/notification.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import {
  CAPS, expectApi, futureDate, mkProvider, mkWorld, openTender, outbox, rawReq, rnd, sid, stubOutbound, tokenFromEmail,
} from '../helpers/requisicionE3World.js';
import { hashToken } from '../../src/utils/requisicionToken.util.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const oidOf = (v) => new mongoose.Types.ObjectId(sid(v));
const quote = (w, paId, data = { observacion: 'x' }, file = null) => cot.registrarCotizacion(w.tenantId, w.reqId, paId, w.actor, data, file, CAPS);
const pdf = (name = 'o.pdf') => ({ buffer: Buffer.from('%PDF-1.4 x'), originalname: name, mimetype: 'application/pdf' });
const entry = async (w, paId) => (await rawReq(w.reqId)).licitacion.proveedores.find((p) => String(p._id) === paId);
const portalGet = async (token) => { const ctx = await portal.resolve(token, { ip: '1.1.1.1' }); return portal.view(ctx); };

describe('Requisiciones E3 round 2 on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_e3r2_${rnd()}`;
  let savedEmit;
  before(async () => {
    await mongoose.connect(URI, { dbName });
    savedEmit = notificationService.emit;
    notificationService.emit = async () => ({ dispatched: 0 });
    for (const m of [Requisicion, Customer, Tenant, User]) { await m.init(); await m.syncIndexes(); }
    stubOutbound();
  });
  after(async () => {
    notificationService.emit = savedEmit;
    await flushRequisicionNotifications();
    if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  });

  describe('F1: instrucciones, never the internal justification', () => {
    it('the public JSON never carries the justification; instrucciones travel to the portal, the internal response and the e-mail', async () => {
      stubOutbound();
      const w = await mkWorld();
      await Requisicion.collection.updateOne({ _id: oidOf(w.reqId) }, { $set: { justificacion: 'SECRETO presupuesto agotado, el proveedor X es caro' } });
      for (let i = 0; i < 2; i += 1) await lic.asignarProveedor(w.tenantId, w.reqId, w.actor, { proveedorId: sid((await mkProvider(w.tenantId))._id) }, CAPS);
      const out = await lic.abrir(w.tenantId, w.reqId, w.actor, { fechaLimiteCotizacion: futureDate().toISOString(), instrucciones: '  Entrega en sede norte <b>antes del viernes</b>  ' }, CAPS);
      assert.equal(out.licitacion.instrucciones, 'Entrega en sede norte <b>antes del viernes</b>');
      assert.ok(outbox.rfq.every((m) => m.instrucciones === 'Entrega en sede norte <b>antes del viernes</b>'));
      const token = tokenFromEmail(outbox.rfq[0].to);
      const view = await portalGet(token);
      assert.deepEqual(Object.keys(view).sort(), ['cerrada', 'consecutivo', 'cotizacion', 'estadoEnvio', 'fechaLimiteCotizacion', 'instrucciones', 'items', 'tenantNombre', 'titulo']);
      assert.equal(view.instrucciones, 'Entrega en sede norte <b>antes del viernes</b>');
      assert.ok(!JSON.stringify(view).includes('SECRETO'));
      assert.ok(!JSON.stringify(view).includes('descripcion":"Se requiere'));
    });

    it('without instrucciones the portal returns null; more than 500 chars is refused by the DTO', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 2);
      assert.equal((await portalGet(tokenFromEmail(provs[0].c.Email.toLowerCase()))).instrucciones, null);
      const { abrirLicitacionDto } = await import('../../src/dtos/requisicionLicitacion.dto.js');
      assert.ok(abrirLicitacionDto.validate({ fechaLimiteCotizacion: futureDate().toISOString(), instrucciones: 'x'.repeat(501) }).error);
      assert.ok(abrirLicitacionDto.validate({ fechaLimiteCotizacion: futureDate().toISOString(), justificacion: 'x' }).error);
    });
  });

  describe('F4: extend the deadline', () => {
    it('extends an open tender: links follow the new date, discarded links stay closed, event recorded, resend works again', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 3);
      await lic.quitarProveedor(w.tenantId, w.reqId, provs[2].paId, w.actor, CAPS);
      const past = new Date(Date.now() - 60000);
      await Requisicion.collection.updateOne({ _id: oidOf(w.reqId) }, { $set: { 'licitacion.fechaLimiteCotizacion': past, 'licitacion.proveedores.$[a].tokenVence': past } }, { arrayFilters: [{ 'a.estadoEnvio': 'Enviado' }] });
      await expectApi(lic.reenviar(w.tenantId, w.reqId, provs[0].paId, w.actor, {}, CAPS), 409, 'FECHA_LIMITE_VENCIDA');
      const nueva = futureDate(10);
      const out = await lic.ampliarFechaLimite(w.tenantId, w.reqId, w.actor, { fechaLimiteCotizacion: nueva.toISOString() }, CAPS);
      assert.equal(new Date(out.licitacion.fechaLimiteCotizacion).getTime(), nueva.getTime());
      const raw = await rawReq(w.reqId);
      assert.equal(raw.timeline.filter((e) => e.tipo === 'FECHA_LIMITE_AMPLIADA').length, 1);
      assert.equal((await entry(w, provs[0].paId)).tokenVence.getTime(), nueva.getTime());
      assert.ok((await entry(w, provs[2].paId)).tokenVence.getTime() <= Date.now() + 1000, 'a discarded supplier stays closed');
      const view = await portalGet(tokenFromEmail(provs[0].c.Email.toLowerCase()));
      assert.equal(view.cerrada, false);
      assert.equal((await lic.reenviar(w.tenantId, w.reqId, provs[0].paId, w.actor, {}, CAPS)).envios.enviados.length, 1);
      await quote(w, provs[0].paId);
    });

    it('validates: future, <= 90 days, later than the current one, open tender only, module on', async () => {
      stubOutbound();
      const w = await mkWorld();
      await expectApi(lic.ampliarFechaLimite(w.tenantId, w.reqId, w.actor, { fechaLimiteCotizacion: futureDate(9).toISOString() }, CAPS), 409, 'TRANSICION_INVALIDA');
      await openTender(w, 2);
      for (const bad of [new Date(Date.now() - 1000), futureDate(91), futureDate(2)]) {
        await expectApi(lic.ampliarFechaLimite(w.tenantId, w.reqId, w.actor, { fechaLimiteCotizacion: bad.toISOString() }, CAPS), 400, 'FECHA_LIMITE_INVALIDA');
      }
      await expectApi(lic.ampliarFechaLimite(w.tenantId, w.reqId, w.actor, { fechaLimiteCotizacion: futureDate(9).toISOString() }, { usesRequisiciones: false }), 403, 'CAPABILITY_DISABLED');
      await expectApi(lic.ampliarFechaLimite(`o-${rnd()}`, w.reqId, w.actor, { fechaLimiteCotizacion: futureDate(9).toISOString() }, CAPS), 404, 'REQUISICION_NOT_FOUND');
    });
  });

  describe('F3: bounded quotation history and upload cleanup', () => {
    it('a resubmission keeps the previous offer in versiones (internal only); the portal view never has it', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 3);
      await quote(w, provs[0].paId, { observacion: 'primera', valorTotal: 10, moneda: 'COP' }, pdf('uno.pdf'));
      const out = await quote(w, provs[0].paId, { observacion: 'segunda', valorTotal: 9, moneda: 'COP' });
      const c = out.licitacion.proveedores.find((p) => p._id === provs[0].paId).cotizacion;
      assert.equal(c.observacion, 'segunda');
      assert.equal(c.versiones.length, 1);
      assert.equal(c.versiones[0].observacion, 'primera');
      assert.equal(c.versiones[0].valorTotal, 10);
      assert.match(c.versiones[0].archivo.url, /^https:\/\/files\.test\//);
      assert.deepEqual(Object.keys(c.versiones[0]).sort(), ['archivo', 'fechaRespuesta', 'linkPropuesta', 'moneda', 'observacion', 'origen', 'valorTotal']);
      assert.ok(!JSON.stringify(out).includes('storagePath'));
      const view = await portalGet(tokenFromEmail(provs[0].c.Email.toLowerCase()));
      assert.ok(!('versiones' in view.cotizacion) && !JSON.stringify(view).includes('primera'));
    });

    it('keeps at most 10 versions and deletes the Firebase file of the one that falls off', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 3);
      for (let i = 0; i < 12; i += 1) await quote(w, provs[0].paId, { observacion: `v${i}` }, pdf(`f${i}.pdf`));
      const e = await entry(w, provs[0].paId);
      assert.equal(e.cotizacion.versiones.length, 10);
      assert.equal(e.cotizacion.observacion, 'v11');
      assert.equal(e.cotizacion.versiones[0].observacion, 'v1');
      assert.equal(outbox.deleted.length, 1, 'only the dropped version file is deleted');
      assert.equal(outbox.deleted[0], outbox.uploads[0].storagePath);
    });

    it('a DB failure AFTER the upload removes the new file (internal registration and portal)', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 2);
      const real = Requisicion.appendEvent;
      Requisicion.appendEvent = async () => { throw new Error('db down after upload'); };
      try {
        await assert.rejects(quote(w, provs[0].paId, { observacion: 'x' }, pdf()));
        assert.equal(outbox.uploads.length, 1);
        assert.deepEqual(outbox.deleted, [outbox.uploads[0].storagePath]);
        const ctx = await portal.resolve(tokenFromEmail(provs[1].c.Email.toLowerCase()), { ip: '1.1.1.1' });
        await assert.rejects(portal.enviarCotizacion(ctx, { observacion: 'y' }, pdf('p.pdf')));
        assert.equal(outbox.uploads.length, 2);
        assert.deepEqual(outbox.deleted, outbox.uploads.map((u) => u.storagePath));
      } finally {
        Requisicion.appendEvent = real;
      }
      assert.ok(!(await entry(w, provs[0].paId)).cotizacion);
    });

    it('a lost conditional write (concurrent resubmission) cleans the file instead of overwriting history', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 3);
      await quote(w, provs[0].paId, { observacion: 'base' });
      const real = Requisicion.appendEvent;
      let first = true;
      Requisicion.appendEvent = async (...args) => {
        if (first) { first = false; await real.call(Requisicion, ...args.slice(0, 1).map((f) => f), ...args.slice(1)); }
        return real.apply(Requisicion, args);
      };
      try {
        await expectApi(quote(w, provs[0].paId, { observacion: 'dos' }, pdf()), 409, 'CONFLICTO_CONCURRENTE');
      } finally {
        Requisicion.appendEvent = real;
      }
      assert.equal(outbox.deleted.length, 1);
      assert.equal((await entry(w, provs[0].paId)).cotizacion.observacion, 'dos', 'the first write landed, the second was refused');
    });
  });

  describe('F6: hard expiry of links after the award', () => {
    it('the winner link lasts ~30 days and then answers TOKEN_EXPIRADO; quoted suppliers keep a read-only page after the close', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 3);
      await quote(w, provs[0].paId); await quote(w, provs[1].paId);
      await cot.cerrar(w.tenantId, w.reqId, w.actor, CAPS);
      const q = await entry(w, provs[1].paId);
      assert.ok(Math.abs(q.tokenVence.getTime() - (Date.now() + 30 * 86400000)) < 60000);
      await gan.seleccionarGanador(w.tenantId, w.reqId, provs[0].paId, w.actor, CAPS);
      const win = await entry(w, provs[0].paId);
      assert.ok(Math.abs(win.tokenVence.getTime() - (Date.now() + 30 * 86400000)) < 60000);
      const token = tokenFromEmail(provs[0].c.Email.toLowerCase());
      const view = await portalGet(token);
      assert.equal(view.cerrada, true);
      assert.equal(view.estadoEnvio, 'Ganador');
      await Requisicion.collection.updateOne({ _id: oidOf(w.reqId) }, { $set: { 'licitacion.proveedores.$[a].tokenVence': new Date(Date.now() - 1000) } }, { arrayFilters: [{ 'a._id': oidOf(provs[0].paId) }] });
      const err = await portal.resolve(token, { ip: '1.1.1.1' }).catch((e) => e);
      assert.equal(err.statusCode, 403);
      assert.equal(err.code, 'TOKEN_EXPIRADO');
    });
  });

  describe('F7/F8: resend sends first; sending fails fast', () => {
    it('a failed e-mail keeps the old link working and the stored hash; a successful one rotates and the old link is a generic 404', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 2);
      const email = provs[0].c.Email.toLowerCase();
      const old = tokenFromEmail(email);
      outbox.failEmailTo.add(email);
      const failed = await lic.reenviar(w.tenantId, w.reqId, provs[0].paId, w.actor, {}, CAPS);
      assert.equal(failed.envios.enviados.length, 0);
      assert.equal(failed.envios.fallidos[0].motivo, 'ENVIO_FALLIDO');
      assert.equal((await entry(w, provs[0].paId)).tokenHash, hashToken(old));
      assert.equal((await portalGet(old)).estadoEnvio, 'Enviado', 'the previous link still works');
      outbox.failEmailTo.clear();
      await lic.reenviar(w.tenantId, w.reqId, provs[0].paId, w.actor, { correoEnvio: 'otro@prov.co' }, CAPS);
      const fresh = tokenFromEmail('otro@prov.co');
      assert.notEqual(fresh, old);
      const gone = await portal.resolve(old, { ip: '1.1.1.1' }).catch((e) => e);
      assert.equal(gone.statusCode, 404);
      assert.equal(gone.code, 'NOT_FOUND');
      assert.equal((await portalGet(fresh)).estadoEnvio, 'Enviado');
    });

    it('refuses with 409 NOTIFICACIONES_DESACTIVADAS / PUBLIC_APP_URL_NO_CONFIGURADA before changing anything', async () => {
      stubOutbound();
      const w = await mkWorld();
      for (let i = 0; i < 2; i += 1) await lic.asignarProveedor(w.tenantId, w.reqId, w.actor, { proveedorId: sid((await mkProvider(w.tenantId))._id) }, CAPS);
      const open = () => lic.abrir(w.tenantId, w.reqId, w.actor, { fechaLimiteCotizacion: futureDate().toISOString() }, CAPS);
      lic.deps.envio = { NOTIFICATIONS_ENABLED: false, NODE_ENV: 'test', PUBLIC_APP_URL: 'https://app.test' };
      await expectApi(open(), 409, 'NOTIFICACIONES_DESACTIVADAS');
      for (const url of ['', 'http://localhost:5173', 'http://127.0.0.1:5173']) {
        lic.deps.envio = { NOTIFICATIONS_ENABLED: true, NODE_ENV: 'production', PUBLIC_APP_URL: url };
        await expectApi(open(), 409, 'PUBLIC_APP_URL_NO_CONFIGURADA');
      }
      assert.equal((await rawReq(w.reqId)).estado, 'Aprobada');
      assert.equal(outbox.rfq.length, 0);
      lic.deps.envio = { NOTIFICATIONS_ENABLED: true, NODE_ENV: 'production', PUBLIC_APP_URL: 'https://app.timtto.com' };
      const out = await open();
      assert.equal(out.estado, 'En_Licitacion');
      lic.deps.envio = { NOTIFICATIONS_ENABLED: false, NODE_ENV: 'test', PUBLIC_APP_URL: 'https://app.test' };
      await expectApi(lic.reenviar(w.tenantId, w.reqId, out.licitacion.proveedores[0]._id, w.actor, {}, CAPS), 409, 'NOTIFICACIONES_DESACTIVADAS');
      stubOutbound();
    });
  });

  describe('F5/F11: concurrency and data hygiene', () => {
    it('abrir x3 concurrently: one opens, the others are refused, exactly one round of e-mails', async () => {
      stubOutbound();
      const w = await mkWorld();
      for (let i = 0; i < 3; i += 1) await lic.asignarProveedor(w.tenantId, w.reqId, w.actor, { proveedorId: sid((await mkProvider(w.tenantId))._id) }, CAPS);
      const fecha = futureDate().toISOString();
      const res = await Promise.allSettled([1, 2, 3].map(() => lic.abrir(w.tenantId, w.reqId, w.actor, { fechaLimiteCotizacion: fecha }, CAPS)));
      assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
      assert.ok(res.filter((r) => r.status === 'rejected').every((r) => r.reason.statusCode === 409));
      assert.equal(outbox.rfq.length, 3);
    });

    it('abrir vs compra directa: exactly one wins and the state is coherent', async () => {
      stubOutbound();
      const w = await mkWorld();
      for (let i = 0; i < 2; i += 1) await lic.asignarProveedor(w.tenantId, w.reqId, w.actor, { proveedorId: sid((await mkProvider(w.tenantId))._id) }, CAPS);
      const c = await mkProvider(w.tenantId);
      const res = await Promise.allSettled([
        lic.abrir(w.tenantId, w.reqId, w.actor, { fechaLimiteCotizacion: futureDate().toISOString() }, CAPS),
        gan.compraDirecta(w.tenantId, w.reqId, w.actor, { proveedorId: sid(c._id), justificacion: 'Unico proveedor homologado por el fabricante' }, CAPS),
      ]);
      assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1, JSON.stringify(res.map((r) => r.reason?.code)));
      assert.ok(['En_Licitacion', 'Adjudicada'].includes((await rawReq(w.reqId)).estado));
    });

    it('quote vs close: the quotation either lands before the close or is refused; never lost silently', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 3);
      await quote(w, provs[0].paId);
      const res = await Promise.allSettled([cot.cerrar(w.tenantId, w.reqId, w.actor, CAPS), quote(w, provs[1].paId)]);
      const raw = await rawReq(w.reqId);
      const stored = Boolean((await entry(w, provs[1].paId)).cotizacion);
      assert.equal(raw.estado, 'Cotizacion_Recibida');
      assert.equal(stored, res[1].status === 'fulfilled', 'stored iff the call succeeded');
    });

    it('a provider deleted from the catalogue after assignment is not invited', async () => {
      stubOutbound();
      const w = await mkWorld();
      const cs = [];
      for (let i = 0; i < 3; i += 1) { const c = await mkProvider(w.tenantId); cs.push(c); await lic.asignarProveedor(w.tenantId, w.reqId, w.actor, { proveedorId: sid(c._id) }, CAPS); }
      await Customer.collection.updateOne({ _id: cs[0]._id }, { $set: { isDeleted: true } });
      const out = await lic.abrir(w.tenantId, w.reqId, w.actor, { fechaLimiteCotizacion: futureDate().toISOString() }, CAPS);
      assert.equal(out.envios.enviados.length, 2);
      assert.ok(!outbox.rfq.some((m) => m.to === cs[0].Email.toLowerCase()));
    });

    it('the currency must be a 3-letter code', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 2);
      await expectApi(quote(w, provs[0].paId, { observacion: 'x', moneda: 'GARBAGE' }), 400, 'MONEDA_INVALIDA');
      await quote(w, provs[0].paId, { observacion: 'x', moneda: 'usd' });
    });
  });
});
