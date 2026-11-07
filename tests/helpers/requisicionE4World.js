/**
 * Shared fixtures of the E4 (purchase order, deliverables, reminders) integration tests against a REAL MongoDB.
 * Builds on the E3 world: an isolated tenant per call, an AWARDED requisition (direct purchase, so the winner needs no
 * tender), approver users with the `requisiciones:approve` role, optional approval rules, and every outbound dependency
 * (e-mail, Firebase, PDF microservice, notifications) stubbed through the services' `deps` seams.
 */
import mongoose from 'mongoose';
import '../../src/models/area.model.js';
import '../../src/models/tipoRequisicion.model.js';
import { Role } from '../../src/models/role.model.js';
import { ReglaAprobacion } from '../../src/models/reglaAprobacion.model.js';
import { Requisicion } from '../../src/models/requisicion.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { requisicionGanadorService } from '../../src/services/requisicionGanador.service.js';
import { requisicionLicitacionCotizacionService } from '../../src/services/requisicionLicitacionCotizacion.service.js';
import { requisicionOrdenCompraService } from '../../src/services/requisicionOrdenCompra.service.js';
import { requisicionOrdenCompraEnvioService } from '../../src/services/requisicionOrdenCompraEnvio.service.js';
import { requisicionOrdenCompraPdfService } from '../../src/services/requisicionOrdenCompraPdf.service.js';
import { requisicionEntregablesService } from '../../src/services/requisicionEntregables.service.js';
import { requisicionPortalPublicoService } from '../../src/services/requisicionPortalPublico.service.js';
import { requisicionRecepcionService } from '../../src/services/requisicionRecepcion.service.js';
import { PERMISSIONS } from '../../src/constants/permissions.js';
import { CAPS, mkProvider, mkUser, mkWorld, openTender, rawReq, rnd, sid, stubOutbound, tokenFromEmail } from './requisicionE3World.js';

export { CAPS, rawReq, rnd, sid, expectApi } from './requisicionE3World.js';

export const out4 = { oc: [], notify: [], pdf: [], uploads: [], deleted: [], failOcEmail: false, pdfFails: false };

export const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n'), Buffer.alloc(64, 0x20)]);

export function stubOutbound4() {
  stubOutbound();
  out4.oc.length = 0; out4.notify.length = 0; out4.pdf.length = 0; out4.uploads.length = 0; out4.deleted.length = 0;
  out4.failOcEmail = false; out4.pdfFails = false;
  const notify = (tenantId, event, req, ctx) => { out4.notify.push({ tenantId, event, ctx, req }); return Promise.resolve(); };
  requisicionOrdenCompraService.deps.notify = notify;
  requisicionOrdenCompraEnvioService.deps.notify = notify;
  requisicionEntregablesService.deps.notify = notify;
  requisicionPortalPublicoService.deps.notify = notify;
  requisicionOrdenCompraEnvioService.deps.envio = { NOTIFICATIONS_ENABLED: true, NODE_ENV: 'test', PUBLIC_APP_URL: 'https://app.test' };
  requisicionOrdenCompraEnvioService.deps.email = {
    sendRequisicionOrdenCompraEmail: async (args) => {
      out4.oc.push(args);
      if (out4.failOcEmail) throw new Error('smtp down');
      return { sent: true };
    },
  };
  const storage = {
    uploadRequisicionEntregable: async (buf, name, mime) => {
      const r = { nombre: name, url: `https://files.test/${rnd()}-${name}`, tipo: mime, tamano: buf.length, storagePath: `e/${rnd()}` };
      out4.uploads.push(r);
      return r;
    },
    deleteByPath: async (p) => { out4.deleted.push(p); },
  };
  requisicionEntregablesService.deps.storage = storage;
  requisicionEntregablesService.deps.recepcion = requisicionRecepcionService;
  requisicionPortalPublicoService.deps.entregables = requisicionEntregablesService;
  requisicionPortalPublicoService.deps.pdf = requisicionOrdenCompraPdfService;
  requisicionOrdenCompraPdfService.deps.client = {
    generatePDF: async (html) => {
      out4.pdf.push(html);
      if (out4.pdfFails) throw new Error('pdf down');
      return PDF_BYTES;
    },
  };
}

export const actorOf = (user, extra = {}) => ({ userId: sid(user._id), name: user.fullName, canApprovePo: true, canIssuePo: true, ...extra });

export async function mkRoleUser(tenantId, permissions = [PERMISSIONS.REQUISICIONES_APPROVE]) {
  const role = await Role.create({ tenantId, name: `r-${rnd()}`, permissions });
  return mkUser(tenantId, { roleId: role._id });
}

/** Lines payload with one price per active line of the requisition (the E3 world has 2 lines: 3 x ?, 10 x ?). */
export async function pricesFor(reqId, [p1 = 120000, p2 = 5000] = []) {
  const raw = await rawReq(reqId);
  const prices = [p1, p2];
  return raw.lineas.map((l, i) => ({ lineaId: sid(l.lineaId), precioUnitario: prices[i] }));
}

export const tomorrow = () => new Date(Date.now() + 86400000).toISOString();

/** Issuer / approvers (and the optional approval rules) on top of an awarded world. */
async function addActors(w, reglas) {
  w.issuer = w.buyer;
  w.issuerActor = w.actor;
  w.approver = await mkRoleUser(w.tenantId);
  w.approver2 = await mkRoleUser(w.tenantId);
  w.approver3 = await mkRoleUser(w.tenantId);
  w.approverActor = actorOf(w.approver);
  w.approver2Actor = actorOf(w.approver2);
  w.approver3Actor = actorOf(w.approver3);
  if (reglas) {
    const mk = (orden, montoDesde, user) => ReglaAprobacion.create({ tenantId: w.tenantId, orden, nombre: `Nivel ${orden}`, montoDesde, aprobadorTipo: 'usuarios', usuariosIds: [user._id] });
    w.reglas = [await mk(1, 0, w.approver), await mk(2, 1000000, w.approver2), await mk(3, 5000000, w.approver3)];
  }
}

/**
 * An AWARDED requisition (estimated 410.000). `issuer` = the buyer of the E3 world; `approver`, `approver2`, `approver3` hold
 * `requisiciones:approve`. With `reglas` the approval rules (usuarios) are created: level 1 from 0, level 2 from 1.000.000,
 * level 3 from 5.000.000.
 */
export async function mkAdjudicada({ reglas = false, estimado = null } = {}) {
  stubOutbound4();
  const w = await mkWorld();
  if (estimado !== null) await Requisicion.collection.updateOne({ _id: new mongoose.Types.ObjectId(w.reqId) }, { $set: { montoEstimado: estimado } });
  const prov = await mkProvider(w.tenantId);
  await requisicionGanadorService.compraDirecta(w.tenantId, w.reqId, w.actor, { proveedorId: sid(prov._id), justificacion: 'Compra directa justificada por urgencia clinica' }, CAPS);
  w.provider = prov;
  await addActors(w, reglas);
  w.tenant = await Tenant.findOne({ tenantId: w.tenantId });
  return w;
}

export const ocBody = async (w, over = {}) => ({
  lineas: await pricesFor(w.reqId, over.precios),
  condiciones: 'Pago a 30 dias',
  fechaEntrega: tomorrow(),
  requiereEntregables: false,
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'precios')),
});

export const emitir = async (w, over = {}) => requisicionOrdenCompraService.emitir(w.tenantId, w.reqId, w.issuerActor, await ocBody(w, over), CAPS);

/** Issues, approves (simple) and sends the OC; returns the portal token of the winner. */
export async function llevarAOcEnviada(w, over = {}) {
  await emitir(w, over);
  await requisicionOrdenCompraService.aprobar(w.tenantId, w.reqId, w.approverActor, {}, CAPS);
  await requisicionOrdenCompraEnvioService.enviar(w.tenantId, w.reqId, w.issuerActor, CAPS);
  const mail = out4.oc[out4.oc.length - 1];
  return { token: mail.portalUrl.split('/public/requisicion/')[1], mail };
}

/** An awarded requisition that went through a REAL tender with two quoting suppliers; `w.provs[0]` is the winner. */
export async function mkLicitada() {
  stubOutbound4();
  const w = await mkWorld();
  const { provs } = await openTender(w, 2);
  for (const p of provs) {
    await requisicionLicitacionCotizacionService.registrarCotizacion(w.tenantId, w.reqId, p.paId, w.actor, { observacion: 'Oferta', valorTotal: 1000, moneda: 'COP' }, null, CAPS);
  }
  await requisicionGanadorService.seleccionarGanador(w.tenantId, w.reqId, provs[0].paId, w.actor, CAPS);
  w.provs = provs.map((p) => ({ ...p, token: tokenFromEmail(p.c.Email.toLowerCase()) }));
  await addActors(w, false);
  return w;
}

export const pdfFile = (name = 'remision.pdf') => ({ buffer: PDF_BYTES, originalname: name, mimetype: 'application/pdf' });
