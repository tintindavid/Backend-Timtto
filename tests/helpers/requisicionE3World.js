/**
 * Shared fixtures of the E3 (tendering + supplier portal) integration tests against a REAL MongoDB.
 * Creates an isolated tenant per call: tenant doc (module on), users, third-party providers and an APPROVED requisition,
 * and stubs every outbound dependency (e-mail, Firebase, notifications) through the services' `deps` seams.
 */
import mongoose from 'mongoose';
import { Requisicion } from '../../src/models/requisicion.model.js';
import { Customer } from '../../src/models/customer.model.js';
import { Tenant } from '../../src/models/tenant.model.js';
import { User } from '../../src/models/user.model.js';
import { requisicionLicitacionService } from '../../src/services/requisicionLicitacion.service.js';
import { requisicionLicitacionCotizacionService } from '../../src/services/requisicionLicitacionCotizacion.service.js';
import { requisicionGanadorService } from '../../src/services/requisicionGanador.service.js';
import { requisicionPortalPublicoService } from '../../src/services/requisicionPortalPublico.service.js';

export const rnd = () => Math.random().toString(36).slice(2, 8);
export const oid = () => new mongoose.Types.ObjectId();
export const sid = (v) => String(v?._id ?? v);
export const CAPS = { usesRequisiciones: true };
export const futureDate = (days = 5) => new Date(Date.now() + days * 86400000);

/** Outbound spies, reset by `stubOutbound()`. */
export const outbox = { rfq: [], award: [], notify: [], uploads: [], deleted: [], failEmailTo: new Set() };

export function stubOutbound() {
  outbox.rfq.length = 0; outbox.award.length = 0; outbox.notify.length = 0; outbox.uploads.length = 0; outbox.deleted.length = 0;
  outbox.failEmailTo.clear();
  requisicionLicitacionService.deps.envio = { NOTIFICATIONS_ENABLED: true, NODE_ENV: 'test', PUBLIC_APP_URL: 'https://app.test' };
  requisicionLicitacionService.deps.email = {
    sendRequisicionRfqInvitationEmail: async (args) => {
      outbox.rfq.push(args);
      if (outbox.failEmailTo.has(args.to)) throw new Error('smtp down');
      return { sent: true };
    },
  };
  const notify = (tenantId, event, req, ctx) => { outbox.notify.push({ tenantId, event, ctx }); return Promise.resolve(); };
  requisicionLicitacionService.deps.notify = notify;
  requisicionLicitacionCotizacionService.deps.notify = notify;
  requisicionGanadorService.deps.notify = notify;
  requisicionPortalPublicoService.deps.notify = notify;
  requisicionGanadorService.deps.email = { sendRequisicionAwardEmail: async (args) => { outbox.award.push(args); return { sent: true }; } };
  const storage = {
    uploadRequisicionCotizacion: async (buf, name, mime) => {
      const r = { nombre: name, url: `https://files.test/${rnd()}-${name}`, tipo: mime, tamano: buf.length, storagePath: `p/${rnd()}` };
      outbox.uploads.push(r);
      return r;
    },
    deleteByPath: async (p) => { outbox.deleted.push(p); },
  };
  requisicionLicitacionCotizacionService.deps.storage = storage;
  requisicionPortalPublicoService.deps.storage = storage;
}

let seq = 0;
export async function mkUser(tenantId, extra = {}) {
  seq += 1;
  return User.create({ tenantId, email: `u${seq}-${rnd()}@t.co`, password: 'x'.repeat(10), firstName: `N${seq}`, lastName: `A${seq}`, fullName: `N${seq} A${seq}`, ...extra });
}

export async function mkProvider(tenantId, over = {}) {
  seq += 1;
  return Customer.create({
    tenantId, kind: 'provider', Razonsocial: `Proveedor ${seq}`, Ciudad: 'Bogota', Departamento: 'Cundinamarca', Nit: 900000000 + seq, Email: `prov${seq}-${rnd()}@prov.co`, ...over,
  });
}

/** Tenant with the module on + creator + buyer + an APPROVED requisition of 2 lines. */
export async function mkWorld({ estado = 'Aprobada' } = {}) {
  const tenantId = `t-${rnd()}`;
  await Tenant.create({ tenantId, name: `Clinica <b>${rnd()}</b>`, status: 'active', capabilities: { usesRequisiciones: true } });
  const creator = await mkUser(tenantId);
  const buyer = await mkUser(tenantId);
  const doc = await Requisicion.create({
    tenantId,
    consecutivo: `REQ-2026-${rnd()}`,
    titulo: 'Compra de sensores',
    justificacion: 'Se requiere para el servicio',
    tipoRequisicionId: oid(),
    areaId: oid(),
    creadaPor: creator._id,
    solicitanteId: creator._id,
    estado,
    lineas: [
      { descripcion: 'Sensor SpO2 <script>x</script>', unidad: 'und', cantidadSolicitada: 3, precioEstimado: 120000 },
      { descripcion: 'Cable', unidad: 'm', cantidadSolicitada: 10, precioEstimado: 5000, especificaciones: 'Blindado' },
    ],
  });
  return { tenantId, creator, buyer, reqId: sid(doc._id), actor: { userId: sid(buyer._id), name: 'Comprador' }, creatorActor: { userId: sid(creator._id), name: 'Creador' } };
}

export const rawReq = (id) => Requisicion.collection.findOne({ _id: new mongoose.Types.ObjectId(sid(id)) });

/** Token embedded in the portal link of the e-mail sent to `to`. */
export function tokenFromEmail(to) {
  const mail = [...outbox.rfq].reverse().find((m) => m.to === to);
  if (!mail) return null;
  return mail.portalUrl.split('/public/requisicion/')[1];
}

export async function expectApi(promise, statusCode, code) {
  let err;
  try { await promise; } catch (e) { err = e; }
  if (!err) throw new Error(`expected rejection ${statusCode} ${code || ''}`);
  if (err.statusCode !== statusCode || (code && err.code !== code)) throw new Error(`expected ${statusCode} ${code}, got ${err.statusCode} ${err.code}: ${err.message}`);
  return err;
}

/** Assigns n providers and opens the tender; returns the providers and their entry ids. */
export async function openTender(w, n = 3) {
  const provs = [];
  for (let i = 0; i < n; i += 1) {
    const c = await mkProvider(w.tenantId);
    const out = await requisicionLicitacionService.asignarProveedor(w.tenantId, w.reqId, w.actor, { proveedorId: sid(c._id) }, CAPS);
    provs.push({ c, paId: sid(out.licitacion.proveedores.find((p) => p.proveedorId === sid(c._id))._id) });
  }
  const opened = await requisicionLicitacionService.abrir(w.tenantId, w.reqId, w.actor, { fechaLimiteCotizacion: futureDate().toISOString() }, CAPS);
  return { provs, opened };
}
