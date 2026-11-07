/**
 * Requisiciones E3 (tendering, quotations, winner, direct purchase) against a REAL MongoDB (node:test).
 * SKIPPED unless MONGO_INTEGRATION_URI is set. Creates and DROPS its own database `req_e3_<random>`.
 *
 *   mongod --dbpath <new empty dir> --port 27651 --bind_ip 127.0.0.1
 *   MONGO_INTEGRATION_URI=mongodb://127.0.0.1:27651 node --test tests/integration/requisicion.e3.mongo.integration.test.js
 *
 * NEVER point it at a shared / remote / production database. E-mail, Firebase and notifications are stubbed.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { Requisicion } from '../../src/models/requisicion.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { requisicionLicitacionService as lic } from '../../src/services/requisicionLicitacion.service.js';
import { requisicionLicitacionCotizacionService as cot } from '../../src/services/requisicionLicitacionCotizacion.service.js';
import { requisicionGanadorService as gan } from '../../src/services/requisicionGanador.service.js';
import { requisicionService } from '../../src/services/requisicion.service.js';
import { requisicionRecepcionService } from '../../src/services/requisicionRecepcion.service.js';
import { flushRequisicionNotifications } from '../../src/services/requisicionNotify.service.js';
import { notificationService } from '../../src/services/notification.service.js';
import {
  CAPS, expectApi, futureDate, mkProvider, mkWorld, openTender, outbox, rawReq, sid, stubOutbound, tokenFromEmail,
} from '../helpers/requisicionE3World.js';
import { actorOf, mkRoleUser, ocBody, stubOutbound4 } from '../helpers/requisicionE4World.js';
import { requisicionOrdenCompraService as ocService } from '../../src/services/requisicionOrdenCompra.service.js';
import { requisicionOrdenCompraEnvioService as ocEnvio } from '../../src/services/requisicionOrdenCompraEnvio.service.js';
import { hashToken } from '../../src/utils/requisicionToken.util.js';

const URI = process.env.MONGO_INTEGRATION_URI;
const rnd = () => Math.random().toString(36).slice(2, 8);
const quote = (w, paId, data = { observacion: 'Oferta telefonica', valorTotal: 1000, moneda: 'COP' }, file = null) =>
  cot.registrarCotizacion(w.tenantId, w.reqId, paId, w.actor, data, file, CAPS);

describe('Requisiciones E3 on real MongoDB', { skip: !URI && 'MONGO_INTEGRATION_URI not set' }, () => {
  const dbName = `req_e3_${rnd()}`;
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
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  describe('assign suppliers', () => {
    it('assigns a catalogue provider (Pendiente, no token in the response), rejects duplicates, non-providers and other tenants', async () => {
      stubOutbound();
      const w = await mkWorld();
      const c = await mkProvider(w.tenantId);
      const out = await lic.asignarProveedor(w.tenantId, w.reqId, w.actor, { proveedorId: sid(c._id) }, CAPS);
      const p = out.licitacion.proveedores[0];
      assert.equal(p.estadoEnvio, 'Pendiente');
      assert.equal(p.correoEnvio, c.Email.toLowerCase());
      assert.equal(p.tokenHint.length, 4);
      assert.ok(!JSON.stringify(out).includes('tokenHash'));
      const raw = await rawReq(w.reqId);
      assert.equal(raw.licitacion.proveedores[0].tokenHash.length, 64);
      assert.ok(raw.timeline.some((e) => e.tipo === 'PROVEEDOR_ASIGNADO'));

      await expectApi(lic.asignarProveedor(w.tenantId, w.reqId, w.actor, { proveedorId: sid(c._id) }, CAPS), 409, 'PROVEEDOR_DUPLICADO');
      const customer = await Customer.create({ tenantId: w.tenantId, kind: 'customer', Razonsocial: 'C', Ciudad: 'x', Departamento: 'y', Nit: 1, Email: 'c@c.co' });
      await expectApi(lic.asignarProveedor(w.tenantId, w.reqId, w.actor, { proveedorId: sid(customer._id) }, CAPS), 400, 'PROVEEDOR_INVALIDO');
      const foreign = await mkProvider(`other-${rnd()}`);
      await expectApi(lic.asignarProveedor(w.tenantId, w.reqId, w.actor, { proveedorId: sid(foreign._id) }, CAPS), 400, 'PROVEEDOR_INVALIDO');
      await expectApi(lic.asignarProveedor(`other-${rnd()}`, w.reqId, w.actor, { proveedorId: sid(c._id) }, CAPS), 404, 'REQUISICION_NOT_FOUND');
    });

    it('wrong state is 409 TRANSICION_INVALIDA; the module off is 403; the 26th provider is refused', async () => {
      stubOutbound();
      const draft = await mkWorld({ estado: 'Borrador' });
      const c = await mkProvider(draft.tenantId);
      await expectApi(lic.asignarProveedor(draft.tenantId, draft.reqId, draft.actor, { proveedorId: sid(c._id) }, CAPS), 409, 'TRANSICION_INVALIDA');
      await expectApi(lic.asignarProveedor(draft.tenantId, draft.reqId, draft.actor, { proveedorId: sid(c._id) }, { usesRequisiciones: false }), 403, 'CAPABILITY_DISABLED');
      const w = await mkWorld();
      for (let i = 0; i < 25; i += 1) await lic.asignarProveedor(w.tenantId, w.reqId, w.actor, { proveedorId: sid((await mkProvider(w.tenantId))._id) }, CAPS);
      await expectApi(lic.asignarProveedor(w.tenantId, w.reqId, w.actor, { proveedorId: sid((await mkProvider(w.tenantId))._id) }, CAPS), 400, 'LIMITE_PROVEEDORES');
    });

    it('removes a provider before opening (entry gone, event kept)', async () => {
      stubOutbound();
      const w = await mkWorld();
      const c = await mkProvider(w.tenantId);
      const a = await lic.asignarProveedor(w.tenantId, w.reqId, w.actor, { proveedorId: sid(c._id) }, CAPS);
      const out = await lic.quitarProveedor(w.tenantId, w.reqId, a.licitacion.proveedores[0]._id, w.actor, CAPS);
      assert.equal(out.licitacion.proveedores.length, 0);
      assert.ok((await rawReq(w.reqId)).timeline.some((e) => e.tipo === 'PROVEEDOR_QUITADO'));
    });
  });

  describe('open the tender', () => {
    it('needs 2 active providers, a future deadline within 90 days', async () => {
      stubOutbound();
      const w = await mkWorld();
      await lic.asignarProveedor(w.tenantId, w.reqId, w.actor, { proveedorId: sid((await mkProvider(w.tenantId))._id) }, CAPS);
      await expectApi(lic.abrir(w.tenantId, w.reqId, w.actor, { fechaLimiteCotizacion: futureDate().toISOString() }, CAPS), 400, 'PROVEEDORES_INSUFICIENTES');
      await lic.asignarProveedor(w.tenantId, w.reqId, w.actor, { proveedorId: sid((await mkProvider(w.tenantId))._id) }, CAPS);
      await expectApi(lic.abrir(w.tenantId, w.reqId, w.actor, { fechaLimiteCotizacion: new Date(Date.now() - 1000).toISOString() }, CAPS), 400, 'FECHA_LIMITE_INVALIDA');
      await expectApi(lic.abrir(w.tenantId, w.reqId, w.actor, { fechaLimiteCotizacion: futureDate(91).toISOString() }, CAPS), 400, 'FECHA_LIMITE_INVALIDA');
      assert.equal(outbox.rfq.length, 0);
      assert.equal((await rawReq(w.reqId)).estado, 'Aprobada');
    });

    it('moves to En_Licitacion, sends one individual e-mail with its own link, stores only hashes', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs, opened } = await openTender(w, 3);
      assert.equal(opened.estado, 'En_Licitacion');
      assert.equal(opened.envios.enviados.length, 3);
      assert.deepEqual(opened.envios.fallidos, []);
      assert.equal(outbox.rfq.length, 3);
      const links = outbox.rfq.map((m) => m.portalUrl);
      assert.equal(new Set(links).size, 3);
      for (const m of outbox.rfq) {
        assert.match(m.portalUrl, /\/public\/requisicion\/[A-Za-z0-9_-]{43}$/);
        assert.ok(m.items.every((i) => i.precioEstimado === undefined && i.precio === undefined), 'no prices in the e-mail');
      }
      assert.ok(opened.licitacion.proveedores.every((p) => p.estadoEnvio === 'Enviado'));
      const raw = await rawReq(w.reqId);
      const tokens = provs.map((p) => tokenFromEmail(p.c.Email.toLowerCase()));
      for (const t of tokens) {
        assert.ok(raw.licitacion.proveedores.some((p) => p.tokenHash === hashToken(t)));
        assert.ok(!JSON.stringify(raw).includes(t), 'the clear token is never stored');
      }
      assert.deepEqual(raw.timeline.map((e) => e.tipo).filter((t) => ['LICITACION_INICIADA', 'INVITACIONES_ENVIADAS'].includes(t)), ['LICITACION_INICIADA', 'INVITACIONES_ENVIADAS']);
      assert.ok(!JSON.stringify(raw.timeline).includes(tokens[0]));
    });

    it('a failing e-mail leaves that provider Pendiente and does not block the others', async () => {
      stubOutbound();
      const w = await mkWorld();
      const a = await mkProvider(w.tenantId);
      const b = await mkProvider(w.tenantId);
      const c = await mkProvider(w.tenantId);
      for (const x of [a, b, c]) await lic.asignarProveedor(w.tenantId, w.reqId, w.actor, { proveedorId: sid(x._id) }, CAPS);
      outbox.failEmailTo.add(b.Email.toLowerCase());
      const out = await lic.abrir(w.tenantId, w.reqId, w.actor, { fechaLimiteCotizacion: futureDate().toISOString() }, CAPS);
      assert.equal(out.estado, 'En_Licitacion');
      assert.equal(out.envios.enviados.length, 2);
      assert.equal(out.envios.fallidos.length, 1);
      assert.equal(out.envios.fallidos[0].motivo, 'ENVIO_FALLIDO');
      const byName = Object.fromEntries(out.licitacion.proveedores.map((p) => [p.nombre, p.estadoEnvio]));
      assert.equal(byName[b.Razonsocial], 'Pendiente');
      assert.equal(byName[a.Razonsocial], 'Enviado');
    });

    it('resend rotates the token (the old one stops working) and can change the e-mail', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 2);
      const before = tokenFromEmail(provs[0].c.Email.toLowerCase());
      const out = await lic.reenviar(w.tenantId, w.reqId, provs[0].paId, w.actor, { correoEnvio: 'nuevo@prov.co' }, CAPS);
      assert.deepEqual(out.envios.enviados, [provs[0].paId]);
      const after = tokenFromEmail('nuevo@prov.co');
      assert.notEqual(before, after);
      const raw = await rawReq(w.reqId);
      const hashes = raw.licitacion.proveedores.map((p) => p.tokenHash);
      assert.ok(!hashes.includes(hashToken(before)));
      assert.ok(hashes.includes(hashToken(after)));
      assert.equal(raw.licitacion.proveedores.find((p) => String(p._id) === provs[0].paId).correoEnvio, 'nuevo@prov.co');
      await expectApi(lic.reenviar(w.tenantId, w.reqId, provs[0].paId, w.actor, { correoEnvio: 'no-es-correo' }, CAPS), 400, 'CORREO_INVALIDO');
    });
  });

  describe('quotations, closing and comparison', () => {
    it('internal quotation: needs content, leaves the provider Aceptado with origin interno', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 2);
      await expectApi(quote(w, provs[0].paId, {}), 400, 'COTIZACION_VACIA');
      await expectApi(quote(w, provs[0].paId, { linkPropuesta: 'http://insegura.co/x' }), 400, 'LINK_INVALIDO');
      const out = await quote(w, provs[0].paId);
      const p = out.licitacion.proveedores.find((x) => x._id === provs[0].paId);
      assert.equal(p.estadoEnvio, 'Aceptado');
      assert.equal(p.cotizacion.origen, 'interno');
      assert.equal(p.cotizacion.registradaPor, w.actor.userId);
      assert.ok((await rawReq(w.reqId)).timeline.some((e) => e.tipo === 'COTIZACION_RECIBIDA'));
      assert.ok(outbox.notify.some((n) => n.event === 'requisicion.quote.received'));
    });

    it('a PDF quotation is uploaded and stored; a failed write cleans the upload', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 2);
      const file = { buffer: Buffer.from('%PDF-1.4 x'), originalname: 'oferta.pdf', mimetype: 'application/pdf' };
      const out = await quote(w, provs[0].paId, { valorTotal: 50 }, file);
      assert.match(out.licitacion.proveedores.find((x) => x._id === provs[0].paId).cotizacion.archivo.url, /^https:\/\/files\.test\//);
      // second submission: the last prevails, history keeps both
      await quote(w, provs[0].paId, { observacion: 'corregida', valorTotal: 40 });
      const raw = await rawReq(w.reqId);
      assert.equal(raw.licitacion.proveedores.find((p) => String(p._id) === provs[0].paId).cotizacion.valorTotal, 40);
      assert.equal(raw.timeline.filter((e) => e.tipo === 'COTIZACION_RECIBIDA').length, 2);
      await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(w.reqId) }, { $set: { estado: 'Cancelada' } });
      await expectApi(quote(w, provs[0].paId, { observacion: 'x' }, file), 409, 'TRANSICION_INVALIDA');
    });

    it('manual close needs one quotation, expires the others, and the comparison highlights the cheapest only when comparable', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 3);
      await expectApi(cot.cerrar(w.tenantId, w.reqId, w.actor, CAPS), 409, 'SIN_COTIZACIONES');
      await quote(w, provs[0].paId, { observacion: 'a', valorTotal: 900, moneda: 'COP' });
      await quote(w, provs[1].paId, { observacion: 'b', valorTotal: 700, moneda: 'COP' });
      const cmp = await cot.comparativo(w.tenantId, w.reqId);
      assert.equal(cmp.hayComparables, true);
      assert.deepEqual(cmp.proveedores.filter((p) => p.masEconomica).map((p) => p.paId), [provs[1].paId]);
      assert.equal(cmp.proveedores.find((p) => p.paId === provs[2].paId).valorTotal, null);

      const closed = await cot.cerrar(w.tenantId, w.reqId, w.actor, CAPS);
      assert.equal(closed.estado, 'Cotizacion_Recibida');
      const raw = await rawReq(w.reqId);
      const unanswered = raw.licitacion.proveedores.find((p) => String(p._id) === provs[2].paId);
      assert.ok(unanswered.tokenVence.getTime() <= Date.now() + 1000, 'the link of who did not answer expires');
      assert.ok(raw.timeline.some((e) => e.tipo === 'COTIZACIONES_CERRADAS'));
      await expectApi(cot.cerrar(w.tenantId, w.reqId, w.actor, CAPS), 409, 'TRANSICION_INVALIDA');
    });

    it('the comparison highlights nothing with a missing value or different currencies', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 3);
      await quote(w, provs[0].paId, { observacion: 'a', valorTotal: 900, moneda: 'COP' });
      await quote(w, provs[1].paId, { observacion: 'sin valor' });
      let cmp = await cot.comparativo(w.tenantId, w.reqId);
      assert.equal(cmp.hayComparables, false);
      assert.ok(cmp.proveedores.every((p) => p.masEconomica === false));
      await quote(w, provs[1].paId, { observacion: 'usd', valorTotal: 7, moneda: 'USD' });
      cmp = await cot.comparativo(w.tenantId, w.reqId);
      assert.equal(cmp.hayComparables, false, 'different currencies');
      assert.ok(cmp.proveedores.every((p) => p.masEconomica === false));
    });

    it('closes automatically when every active provider answered', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 2);
      await quote(w, provs[0].paId);
      assert.equal((await rawReq(w.reqId)).estado, 'En_Licitacion');
      const out = await quote(w, provs[1].paId);
      assert.equal(out.estado, 'Cotizacion_Recibida');
      assert.equal((await rawReq(w.reqId)).timeline.find((e) => e.tipo === 'COTIZACIONES_CERRADAS').datos.automatico, true);
    });
  });

  describe('winner selection', () => {
    async function readyToAward(n = 3) {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, n);
      for (const p of provs.slice(0, 2)) await quote(w, p.paId, { observacion: 'x', valorTotal: 100 + provs.indexOf(p), moneda: 'COP' });
      await cot.cerrar(w.tenantId, w.reqId, w.actor, CAPS);
      return { w, provs };
    }

    it('one atomic write: winner Ganador, the others Descartado with expired links, Adjudicada, one event each', async () => {
      const { w, provs } = await readyToAward();
      await expectApi(gan.seleccionarGanador(w.tenantId, w.reqId, provs[2].paId, w.actor, CAPS), 400, 'PROVEEDOR_SIN_COTIZACION');
      const out = await gan.seleccionarGanador(w.tenantId, w.reqId, provs[0].paId, w.actor, CAPS);
      assert.equal(out.estado, 'Adjudicada');
      assert.equal(out.licitacion.ganadorId, provs[0].paId);
      const st = Object.fromEntries(out.licitacion.proveedores.map((p) => [p._id, p.estadoEnvio]));
      assert.deepEqual(st, { [provs[0].paId]: 'Ganador', [provs[1].paId]: 'Descartado', [provs[2].paId]: 'Descartado' });
      const raw = await rawReq(w.reqId);
      assert.equal(raw.timeline.filter((e) => e.tipo === 'PROVEEDOR_SELECCIONADO').length, 1);
      assert.equal(raw.timeline.filter((e) => e.tipo === 'PROVEEDOR_DESCARTADO').length, 2);
      assert.equal(outbox.award.length, 1);
      assert.equal(outbox.award[0].to, provs[0].c.Email.toLowerCase());
      await expectApi(gan.seleccionarGanador(w.tenantId, w.reqId, provs[1].paId, w.actor, CAPS), 409, 'GANADOR_YA_SELECCIONADO');
    });

    it('concurrent selection: exactly one succeeds, the rest get 409 GANADOR_YA_SELECCIONADO', async () => {
      const { w, provs } = await readyToAward();
      const attempts = await Promise.allSettled([0, 1, 0, 1, 0, 1].map((i) => gan.seleccionarGanador(w.tenantId, w.reqId, provs[i].paId, w.actor, CAPS)));
      const ok = attempts.filter((a) => a.status === 'fulfilled');
      const ko = attempts.filter((a) => a.status === 'rejected');
      assert.equal(ok.length, 1, JSON.stringify(ko.map((k) => k.reason?.code)));
      assert.ok(ko.every((k) => k.reason.statusCode === 409 && k.reason.code === 'GANADOR_YA_SELECCIONADO'), JSON.stringify(ko.map((k) => k.reason?.code)));
      const raw = await rawReq(w.reqId);
      assert.equal(raw.timeline.filter((e) => e.tipo === 'PROVEEDOR_SELECCIONADO').length, 1);
      assert.equal(raw.licitacion.proveedores.filter((p) => p.estadoEnvio === 'Ganador').length, 1);
    });

    it('cannot select before the quotations are closed, nor with another tenant', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 2);
      await expectApi(gan.seleccionarGanador(w.tenantId, w.reqId, provs[0].paId, w.actor, CAPS), 409, 'TRANSICION_INVALIDA');
      await expectApi(gan.seleccionarGanador(`o-${rnd()}`, w.reqId, provs[0].paId, w.actor, CAPS), 404, 'REQUISICION_NOT_FOUND');
    });
  });

  describe('direct purchase', () => {
    it('creator is refused (403), short justification 400, a valid one awards without quotation', async () => {
      stubOutbound();
      const w = await mkWorld();
      const c = await mkProvider(w.tenantId);
      const body = { proveedorId: sid(c._id), justificacion: 'Unico proveedor homologado por el fabricante del equipo' };
      await expectApi(gan.compraDirecta(w.tenantId, w.reqId, w.creatorActor, body, CAPS), 403, 'SEPARACION_FUNCIONES');
      await expectApi(gan.compraDirecta(w.tenantId, w.reqId, w.actor, { ...body, justificacion: 'corta' }, CAPS), 400, 'JUSTIFICACION_CORTA');
      const out = await gan.compraDirecta(w.tenantId, w.reqId, w.actor, body, CAPS);
      assert.equal(out.estado, 'Adjudicada');
      assert.equal(out.licitacion.proveedores.length, 1);
      assert.equal(out.licitacion.proveedores[0].estadoEnvio, 'Ganador');
      assert.equal(out.licitacion.ganadorId, out.licitacion.proveedores[0]._id);
      assert.equal(out.licitacion.compraDirecta.justificacion, body.justificacion);
      assert.ok((await rawReq(w.reqId)).timeline.some((e) => e.tipo === 'COMPRA_DIRECTA_JUSTIFICADA'));
      await expectApi(gan.compraDirecta(w.tenantId, w.reqId, w.actor, body, CAPS), 409, 'TRANSICION_INVALIDA');
    });
  });

  describe('integration with E1/E2', () => {
    it('cancelling expires every link and keeps the quotations', async () => {
      stubOutbound();
      const w = await mkWorld();
      const { provs } = await openTender(w, 2);
      await quote(w, provs[0].paId);
      await requisicionService.cancelar(w.tenantId, w.reqId, w.creatorActor, { motivo: 'ya no se necesita' });
      const raw = await rawReq(w.reqId);
      assert.equal(raw.estado, 'Cancelada');
      assert.ok(raw.licitacion.proveedores.every((p) => p.tokenVence.getTime() <= Date.now() + 1000));
      assert.ok(raw.licitacion.proveedores.some((p) => p.cotizacion));
    });

    it('reception: 409 LICITACION_ABIERTA while tendering, OC_REQUERIDA once awarded, allowed once the OC is sent, E2 path untouched', async () => {
      stubOutbound4();
      const w = await mkWorld();
      const raw0 = await rawReq(w.reqId);
      const lineaId = String(raw0.lineas[0].lineaId);
      const recibir = (id) => requisicionRecepcionService.registrar(w.tenantId, id, { userId: w.actor.userId, name: 'x' }, { items: [{ lineaId, cantidadRecibida: 1 }] }, [], CAPS);
      const { provs } = await openTender(w, 2);
      await expectApi(recibir(w.reqId), 409, 'LICITACION_ABIERTA');
      for (const p of provs) await quote(w, p.paId);
      await expectApi(recibir(w.reqId), 409, 'LICITACION_ABIERTA');
      await gan.seleccionarGanador(w.tenantId, w.reqId, provs[0].paId, w.actor, CAPS);
      // E4: the awarded goods are received only after the purchase order was issued, approved and sent
      await expectApi(recibir(w.reqId), 409, 'OC_REQUERIDA');
      const approver = actorOf(await mkRoleUser(w.tenantId));
      await ocService.emitir(w.tenantId, w.reqId, w.actor, await ocBody(w), CAPS);
      await expectApi(recibir(w.reqId), 409, 'OC_REQUERIDA');
      await ocService.aprobar(w.tenantId, w.reqId, approver, {}, CAPS);
      await ocEnvio.enviar(w.tenantId, w.reqId, w.actor, CAPS);
      const out = await recibir(w.reqId);
      assert.equal(out.estado, 'En_Recepcion');
      // path without tender (E2 behaviour)
      const w2 = await mkWorld();
      const l2 = String((await rawReq(w2.reqId)).lineas[0].lineaId);
      const out2 = await requisicionRecepcionService.registrar(w2.tenantId, w2.reqId, { userId: w2.actor.userId, name: 'x' }, { items: [{ lineaId: l2, cantidadRecibida: 1 }] }, [], CAPS);
      assert.equal(out2.estado, 'En_Recepcion');
    });

    it('the model refuses to write the tendering block outside the services', async () => {
      stubOutbound();
      const w = await mkWorld();
      await expectApi(Requisicion.updateOne({ _id: w.reqId, tenantId: w.tenantId }, { $set: { licitacion: { ganadorId: new mongoose.Types.ObjectId() } } }), 409, 'LICITACION_INMUTABLE');
      await expectApi(Requisicion.updateOne({ _id: w.reqId, tenantId: w.tenantId }, { $set: { 'licitacion.ganadorId': new mongoose.Types.ObjectId() } }), 409, 'LICITACION_INMUTABLE');
      const doc = await Requisicion.findOne({ _id: w.reqId, tenantId: w.tenantId });
      doc.licitacion = { ganadorId: new mongoose.Types.ObjectId() };
      await expectApi(doc.save(), 409, 'LICITACION_INMUTABLE');
    });
  });
});
