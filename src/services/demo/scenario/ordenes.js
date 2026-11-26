import { OT } from '../../../models/ot.model.js';
import { Report } from '../../../models/report.model.js';
import { SheetWork } from '../../../models/sheetwork.model.js';
import { MESES_ARRAY } from '../../../utils/meses.util.js';
import { formatConsecutivo } from '../../../utils/sequence.util.js';
import { REPORT_RESOLVED_STATES } from '../../../constants/report.constants.js';
import { DEMO_SIGNATURE } from '../../../fixtures/demo/firma.js';
import { buildVerification, isFeatured } from './verificacion.js';

// Equipment 0 and 1 (monitor and pump, both with equipment record) take part in every order.
const closed = (key, daysAgo, equipos = [0, 1]) => (
  { key, tipo: 'Preventivo', estado: 'Cerrado', prioridad: 'Media', daysAgo, equipos, done: equipos.length }
);

/**
 * Work orders of the sample account, oldest first so consecutives follow the dates: the closed preventive history (signed
 * worksheets), a corrective one, one in progress and one pending. `equipos` are indexes of ctx.refs.equipos; `done` how
 * many reports are processed.
 */
const PLAN = [
  closed('historica-1', 540),
  closed('historica-2', 450),
  closed('historica-3', 360),
  closed('historica-4', 270),
  closed('historica-5', 190),
  closed('cerrada', 120, [0, 1, 2, 4, 5]),
  { key: 'correctiva', tipo: 'Correctivo', estado: 'En Progreso', prioridad: 'Urgente', daysAgo: 70, equipos: [3, 0, 1, 7], done: 3 },
  { key: 'progreso', tipo: 'Preventivo', estado: 'En Progreso', prioridad: 'Alta', daysAgo: 35, equipos: [0, 1, 6, 8, 9, 10], done: 3 },
  { key: 'pendiente', tipo: 'Preventivo', estado: 'Pendiente', prioridad: 'Media', daysAgo: 3, equipos: [0, 1, 12, 13, 14], done: 0 },
];

export function buildOrdenes(ctx) {
  if (!ctx.capabilities.executesServices) return [];
  const { tenantId, id, admin } = ctx;
  const { cliente } = ctx.refs;
  const ots = [];
  const reports = [];
  const sheets = [];
  const visits = new Map(); // verifications already recorded per featured piece of equipment

  for (const plan of PLAN) {
    const otId = id(`ot:${plan.key}`);
    const created = ctx.daysAgo(plan.daysAgo);
    const executed = ctx.daysAgo(Math.max(1, plan.daysAgo - 5));
    const otSeq = ctx.next('OT');
    const otReports = plan.equipos.map((equipoIndex, i) => {
      const { doc: equipo, item, servicio, sede } = ctx.refs.equipos[equipoIndex];
      const done = i < plan.done;
      const consecutivo = formatConsecutivo('R', ctx.next('REPORT'), 6);
      // In the corrective order only the equipment that failed has a fault; the featured ones are checked.
      const corrective = plan.tipo === 'Correctivo' && !isFeatured(equipoIndex);
      let verification = null;
      if (done && !corrective) {
        const visit = visits.get(equipoIndex) ?? 0;
        verification = isFeatured(equipoIndex)
          ? buildVerification(equipoIndex, visit, (n) => id(`report:${plan.key}:${i}:verificacion:${n}`))
          : [{ _id: id(`report:${plan.key}:${i}:verificacion`), magnitud: 'Temperatura', unidad: '°C', valorReferencia: 37, valorMedido: 36.8, patron: 'Patrón de ejemplo' }];
        visits.set(equipoIndex, visit + 1);
      }
      const report = {
        _id: id(`report:${plan.key}:${i}`),
        tenantId,
        consecutivo,
        estado: done ? 'Procesado' : 'Pendiente', // signing the worksheet closes them (below)
        FechaCreacion: created,
        Equipo: equipo._id,
        ClienteId: cliente._id,
        orden: otId,
        tipoMtto: plan.tipo,
        duracion: 45,
        ResponsableMtto: admin._id,
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
        actividadesRealizadas: done ? ctx.refs.activitiesOfItem(item.key).map((a, n) => ({
          _id: id(`report:${plan.key}:${i}:actividad:${n}`),
          actividadProtocoloId: String(a._id),
          descripcion: a.Nombre,
          realizado: true,
          fecha: executed,
          esExtra: false,
        })) : [],
        ...(corrective ? { fallaReportada: 'El equipo no enciende de forma estable.' } : {}),
        ...(done ? {
          EstadoOperativo: equipo.EstadoOperativo,
          estadoOperativo: equipo.EstadoOperativo,
          fechaFinalizdo: executed,
          fechaProcesado: executed,
          procesadoPor: { userId: admin._id, snapshotName: admin.fullName, fechaProceso: executed },
          observacion: corrective ? 'Se requiere reemplazo de la batería.' : 'Mantenimiento preventivo realizado según protocolo.',
          ...(corrective ? {
            CausaEncontrada: 'Batería agotada.',
            diagnostico: 'La batería no retiene carga.',
            accionTomada: 'Diagnóstico y solicitud de repuesto.',
          } : { verificationParam: verification }),
        } : {}),
        createdAt: created,
      };
      if (done) {
        equipo.mesesMttoRealizados.push({ fecha: executed, mes: MESES_ARRAY[executed.getUTCMonth() + 1], consecutivo });
        if (!equipo.UltimoMtto || equipo.UltimoMtto < executed) {
          equipo.UltimoMtto = executed;
          equipo.UltimoConsecutivoMtto = consecutivo;
        }
      }
      return report;
    });

    if (plan.estado === 'Cerrado') {
      const sheet = {
        _id: id(`sheet:${plan.key}`),
        tenantId,
        clienteId: cliente._id,
        otId,
        numeroHoja: formatConsecutivo('H', ctx.next('SHEET'), 4),
        estado: 'Firmada',
        source: 'field',
        pdfStatus: 'ready',
        personaRecibe: cliente.UserContacto,
        cargoRecibe: 'Coordinadora biomédica',
        firmaFile: DEMO_SIGNATURE,
        firmaResponsableFile: DEMO_SIGNATURE,
        responsable: admin._id,
        fullNameResponsable: admin.fullName,
        cargoResponsable: 'Ingeniería biomédica',
        firmadoPor: { userId: admin._id, snapshotName: admin.fullName, firmadoAt: executed },
        reports: otReports.map((r) => r._id),
        observaciones: 'Hoja de trabajo de ejemplo.',
        createdAt: executed,
      };
      // Same outcome as the real signature: the reports of a signed worksheet are closed.
      for (const r of otReports) Object.assign(r, { estado: 'Cerrado', hojaDeTrabajo: sheet._id, inHt: true });
      sheets.push(sheet);
    }

    ots.push({
      _id: otId,
      tenantId,
      Consecutivo: formatConsecutivo('OT', otSeq, 6),
      Norden: `N${String(otSeq).padStart(6, '0')}`,
      ClienteId: cliente._id,
      EstadoOt: plan.estado,
      FechaCreacion: created,
      TipoServicio: plan.tipo,
      OtPrioridad: plan.prioridad,
      // Same rule as the services: only resolved reports (Cerrado, Cancelado) count.
      Avance: Math.round((otReports.filter((r) => REPORT_RESOLVED_STATES.includes(r.estado)).length / otReports.length) * 100),
      programaciones: [{
        _id: id(`ot:${plan.key}:programacion`),
        fechaInicio: created,
        fechaFin: ctx.daysAgo(plan.daysAgo - 10),
        responsables: [{ userId: admin._id, snapshotName: admin.fullName }],
        isActive: true,
        createdBy: admin._id,
        createdByName: admin.fullName,
        createdAt: created,
      }],
      reportes: otReports.map((r) => r._id),
      createdAt: created,
    });
    reports.push(...otReports);
    ctx.refs[`ot_${plan.key}`] = { ot: ots.at(-1), reports: otReports };
  }

  return [
    { Model: Report, docs: reports },
    { Model: OT, docs: ots },
    { Model: SheetWork, docs: sheets },
  ];
}
