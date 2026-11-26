import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { EquipmentQr } from '../../../models/equipmentQr.model.js';
import { ServiceQr } from '../../../models/serviceQr.model.js';
import { Ticket } from '../../../models/ticket.model.js';
import { QR_TOKEN_LENGTH } from '../../../constants/serviceQr.constants.js';
import { TICKET_CONSECUTIVO_PREFIX, TICKET_CONSECUTIVO_PAD, TICKET_COUNTER_KEY } from '../../../constants/ticket.constants.js';

/**
 * Equipment QRs, one service QR and tickets in several states. QR tokens give public access, so they are random (never
 * derived from the tenant); the service QR password is random too and is rotated from the interface.
 */
export function buildQrTickets(ctx) {
  const { tenantId, id, admin } = ctx;
  const { cliente } = ctx.refs;
  const equipmentQrs = ctx.refs.equipos.slice(0, 4).map(({ doc }, i) => ({
    _id: id(`qr-equipo:${i}`), tenantId, equipoId: doc._id, qrToken: nanoid(QR_TOKEN_LENGTH), active: true, createdBy: admin._id,
  }));

  const first = ctx.refs.equipos[0];
  const serviceQr = {
    _id: id('qr-servicio'),
    tenantId,
    ClienteId: cliente._id,
    sedeId: first.sede._id,
    servicioId: first.servicio._id,
    qrToken: nanoid(QR_TOKEN_LENGTH),
    passwordHash: bcrypt.hashSync(nanoid(24), 10),
    active: true,
    createdBy: admin._id,
  };

  const year = ctx.now.getUTCFullYear();
  const tickets = [
    { key: 'pendiente', equipo: 3, status: 'pendiente', urgency: 'critico', days: 2, observation: 'El equipo no enciende.' },
    { key: 'proceso', equipo: 7, status: 'en_proceso', urgency: 'urgente', days: 6, observation: 'Alarma constante en la pantalla.' },
    { key: 'cerrado', equipo: 1, status: 'cerrado', urgency: 'normal', days: 40, observation: 'Cable deteriorado.' },
  ].map((spec) => {
    const { doc: equipo, item, servicio, sede } = ctx.refs.equipos[spec.equipo];
    const created = ctx.daysAgo(spec.days);
    const seq = ctx.next(TICKET_COUNTER_KEY(year));
    return {
      _id: id(`ticket:${spec.key}`),
      tenantId,
      consecutivo: `${TICKET_CONSECUTIVO_PREFIX}-${year}-${String(seq).padStart(TICKET_CONSECUTIVO_PAD, '0')}`,
      ClienteId: cliente._id,
      sedeId: sede._id,
      servicioId: servicio._id,
      equipoId: equipo._id,
      equipoSnapshot: {
        nombre: item.Nombre,
        marca: equipo.Marca,
        modelo: equipo.Modelo,
        serie: equipo.Serie,
        inventario: equipo.Inventario,
        ubicacion: equipo.Ubicacion,
        servicio: servicio.nombre,
        sede: sede.nombreSede,
      },
      status: spec.status,
      urgency: spec.urgency,
      batchId: `BTC-${spec.key}-demo`,
      source: 'admin',
      requestedBy: { name: 'Enfermería (ejemplo)', position: 'Jefe de turno' },
      observation: spec.observation,
      createdBy: admin._id,
      ...(spec.status !== 'pendiente' ? {
        assignedTo: admin._id,
        assignedAt: ctx.daysAgo(spec.days - 1),
        firstResponseAt: ctx.daysAgo(spec.days - 1),
        responseTimeMinutes: 1440,
      } : {}),
      ...(spec.status === 'cerrado' ? {
        closedAt: ctx.daysAgo(spec.days - 3),
        closedBy: admin._id,
        closingReason: 'manual',
        closingObservation: 'Cable reemplazado.',
        resolutionTimeMinutes: 4320,
      } : {}),
      createdAt: created,
    };
  });

  return [
    { Model: EquipmentQr, docs: equipmentQrs },
    { Model: ServiceQr, docs: [serviceQr] },
    { Model: Ticket, docs: tickets },
  ];
}
