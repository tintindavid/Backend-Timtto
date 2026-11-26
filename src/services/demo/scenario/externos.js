import { CadenaActividad } from '../../../models/cadenaActividad.model.js';
import { EquipoActividadExterna } from '../../../models/equipoActividadExterna.model.js';
import { Report } from '../../../models/report.model.js';
import { MESES_ARRAY } from '../../../utils/meses.util.js';
import { formatConsecutivo } from '../../../utils/sequence.util.js';

/** Scheduled external activities (one up to date, one overdue) and one maintenance done by a third party. */
export function buildExternos(ctx) {
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

  const { doc: equipo, item, servicio, sede } = ctx.refs.equipos[11];
  const done = ctx.daysAgo(20);
  const consecutivo = formatConsecutivo('R', ctx.next('REPORT'), 6);
  const report = {
    _id: id('report:externo'),
    tenantId,
    consecutivo,
    estado: 'Cerrado',
    origen: 'externo',
    Equipo: equipo._id,
    ClienteId: cliente._id,
    tipoMtto: 'Preventivo',
    FechaCreacion: done,
    fechaFinalizdo: done,
    fechaProcesado: done,
    estadoOperativo: 'Operativo',
    observacion: 'Mantenimiento realizado por un tercero.',
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
      consecutivoDocumento: 'EXT-DEMO-001',
      registradoPor: admin._id,
    },
    createdAt: done,
  };
  equipo.mesesMttoRealizados.push({ fecha: done, mes: MESES_ARRAY[done.getUTCMonth() + 1], consecutivo });
  equipo.UltimoMtto = done;
  equipo.UltimoConsecutivoMtto = consecutivo;

  return [
    { Model: CadenaActividad, docs: chains },
    { Model: EquipoActividadExterna, docs: activities },
    { Model: Report, docs: [report] },
  ];
}
