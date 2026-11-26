import { CadenaActividad } from '../../../models/cadenaActividad.model.js';
import { EquipoActividadExterna } from '../../../models/equipoActividadExterna.model.js';
import { Report } from '../../../models/report.model.js';
import { MESES_ARRAY } from '../../../utils/meses.util.js';
import { formatConsecutivo } from '../../../utils/sequence.util.js';
import { buildVerification, isFeatured } from './verificacion.js';

/** Past visits, oldest first: eight to each featured piece of equipment, plus a few to others. */
function thirdPartyHistory() {
  const featured = [540, 450, 360, 270, 190, 120, 70, 35].flatMap((daysAgo) => [0, 1].map((equipo) => (
    { key: `externo:${daysAgo}:${equipo}`, equipo, daysAgo }
  )));
  const others = [
    { key: 'externo:otro:2', equipo: 2, daysAgo: 120 },
    { key: 'externo:otro:4', equipo: 4, daysAgo: 118 },
    { key: 'externo:otro:5', equipo: 5, daysAgo: 115 },
    { key: 'externo:correctivo:3', equipo: 3, daysAgo: 68, tipo: 'Correctivo' },
  ];
  return [...featured, ...others].sort((a, b) => b.daysAgo - a.daysAgo);
}

/** Scheduled external activities (one up to date, one overdue) and one maintenance done by a third party. */
export function buildExternos(ctx) {
  if (!ctx.capabilities.registersExternal) return [];
  const { tenantId, id, admin } = ctx;
  const { cliente, proveedor } = ctx.refs;
  const chains = [];
  const activities = [];

  [
    { key: 'vigente', equipo: 0, tipo: 'calibracion', doneDaysAgo: 90, nextInDays: 275, months: 12 },
    { key: 'vencida', equipo: 4, tipo: 'verificacion', doneDaysAgo: 200, nextInDays: -17, months: 6 },
  ].forEach((spec, i) => {
    const equipo = ctx.refs.equipos[spec.equipo].doc;
    const chainId = id(`cadena:${spec.key}`);
    const activityId = id(`actividad-externa:${spec.key}`);
    chains.push({
      _id: chainId,
      tenantId,
      clienteId: cliente._id,
      equipoId: equipo._id,
      tipo: spec.tipo,
      frecuenciaMeses: spec.months,
      esUnica: false,
      fechaProxima: ctx.daysAhead(spec.nextInDays),
      estado: 'vigente',
      actividadVigenteId: activityId,
    });
    activities.push({
      _id: activityId,
      tenantId,
      clienteId: cliente._id,
      equipoId: equipo._id,
      cadenaId: chainId,
      tipo: spec.tipo,
      consecutivoExterno: `CERT-DEMO-${i + 1}`,
      fecha: ctx.daysAgo(spec.doneDaysAgo),
      proveedor: proveedor.Razonsocial,
      proveedorId: proveedor._id,
      estadoFinal: 'aprobada',
      observacion: 'Actividad externa de ejemplo.',
      esInicioCadena: true,
      createdByUserId: admin._id,
      createdAt: ctx.daysAgo(spec.doneDaysAgo),
    });
  });

  // An organization that executes no services has its whole maintenance history done by third parties.
  const visits = [
    ...(ctx.capabilities.executesServices ? [] : thirdPartyHistory()),
    { key: 'externo', equipo: 11, daysAgo: 20 },
  ];
  const verifications = new Map();
  const reports = visits.map((visit, n) => {
    const { doc: equipo, item, servicio, sede } = ctx.refs.equipos[visit.equipo];
    const done = ctx.daysAgo(visit.daysAgo);
    const consecutivo = formatConsecutivo('R', ctx.next('REPORT'), 6);
    const tipoMtto = visit.tipo ?? 'Preventivo';
    let verificationParam = [];
    if (isFeatured(visit.equipo)) {
      const count = verifications.get(visit.equipo) ?? 0;
      verificationParam = buildVerification(visit.equipo, count, (row) => id(`report:${visit.key}:verificacion:${row}`));
      verifications.set(visit.equipo, count + 1);
    }
    equipo.mesesMttoRealizados.push({ fecha: done, mes: MESES_ARRAY[done.getUTCMonth() + 1], consecutivo });
    if (!equipo.UltimoMtto || equipo.UltimoMtto < done) {
      equipo.UltimoMtto = done;
      equipo.UltimoConsecutivoMtto = consecutivo;
    }
    return {
      _id: id(`report:${visit.key}`),
      tenantId,
      consecutivo,
      estado: 'Cerrado',
      origen: 'externo',
      Equipo: equipo._id,
      ClienteId: cliente._id,
      tipoMtto,
      FechaCreacion: done,
      fechaFinalizdo: done,
      fechaProcesado: done,
      estadoOperativo: 'Operativo',
      observacion: tipoMtto === 'Correctivo' ? 'Reparación realizada por un tercero.' : 'Mantenimiento realizado por un tercero.',
      verificationParam,
      equipoSnapshot: {
        ItemText: item.Nombre,
        Marca: equipo.Marca,
        Modelo: equipo.Modelo,
        Sede: sede.nombreSede,
        Serie: equipo.Serie,
        Inventario: equipo.Inventario,
        Servicio: servicio.nombre,
        Ubicacion: equipo.Ubicacion,
        MesesMtto: equipo.mesesMtto,
      },
      procesadoPor: { userId: admin._id, snapshotName: admin.fullName, fechaProceso: done },
      externo: {
        proveedor: proveedor.Razonsocial,
        proveedorId: proveedor._id,
        consecutivoDocumento: `EXT-DEMO-${String(n + 1).padStart(3, '0')}`,
        registradoPor: admin._id,
      },
      createdAt: done,
    };
  });

  return [
    { Model: CadenaActividad, docs: chains },
    { Model: EquipoActividadExterna, docs: activities },
    { Model: Report, docs: reports },
  ];
}
