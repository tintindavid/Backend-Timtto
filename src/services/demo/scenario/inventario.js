import { InventarioRepuesto } from '../../../models/inventarioRepuesto.model.js';
import { InventarioMovimiento } from '../../../models/inventarioMovimiento.model.js';
import { Repuestos } from '../../../models/repuestos.model.js';

// [name, kind, reference, initial stock, minimum, unit price]
const CATALOGUE = [
  ['Batería recargable 12 V', 'repuesto', 'BAT-12', 6, 2, 180000],
  ['Sensor de SpO2 adulto', 'accesorio', 'SPO2-A', 8, 3, 95000],
  ['Cable ECG de 5 derivaciones', 'accesorio', 'ECG-5', 4, 2, 120000],
  ['Fusible 2 A', 'repuesto', 'FUS-2A', 30, 10, 1500],
  ['Brazalete NIBP adulto', 'accesorio', 'NIBP-A', 1, 3, 45000],
];

/** Stock catalogue with its movements, plus spare parts installed and requested in reports. */
export function buildInventario(ctx) {
  const { tenantId, id, admin } = ctx;
  const items = CATALOGUE.map(([nombre, tipo, referencia, stock, stockMinimo, precio], i) => ({
    _id: id(`inventario:${i}`), tenantId, nombre, tipo, referencia, stockActual: stock, stockMinimo, precio, unidad: 'unidad',
  }));
  const movements = items.map((item, i) => ({
    _id: id(`movimiento:inicial:${i}`),
    tenantId,
    itemId: item._id,
    itemNombre: item.nombre,
    tipo: 'entrada',
    cantidad: item.stockActual,
    stockAnterior: 0,
    stockResultante: item.stockActual,
    motivo: 'Inventario inicial',
    referenciaTipo: 'manual',
    usuarioId: String(admin._id),
    createdAt: ctx.daysAgo(170),
  }));

  const spare = ({ key, inventoryIndex, source, status, report, ot, days }) => {
    const item = items[inventoryIndex];
    return {
      _id: id(`repuesto:${key}`),
      tenantId,
      ClienteId: source.ClienteId,
      EquipoId: source.Equipo,
      OrdenId: ot._id,
      ReporteSolicitudId: report._id,
      InventarioItemId: item._id,
      nombre: item.nombre,
      Cantidad: '1',
      PrecioRepuesto: item.precio,
      EstadoSolicitud: status,
      FechaSolicitud: ctx.daysAgo(days),
      ResponsableSolicitud: admin._id,
      Prioridad: 'Media',
      observacion: 'Repuesto de ejemplo.',
      ...(status === 'Instalado' ? {
        ReporteInstalacionId: report._id,
        ResponsableInstalacion: admin._id,
        FechaInstalacion: ctx.daysAgo(days - 1),
        CantidadInstalacion: 1,
      } : {}),
      createdAt: ctx.daysAgo(days),
    };
  };

  const closed = ctx.refs.ot_cerrada;
  const corrective = ctx.refs.ot_correctiva;
  // Spare part requests hang from work orders: an organization that does not execute services has none.
  const repuestos = !closed ? [] : [
    spare({ key: 'instalado', inventoryIndex: 1, source: closed.reports[0], report: closed.reports[0], ot: closed.ot, status: 'Instalado', days: 115 }),
    spare({ key: 'solicitado', inventoryIndex: 0, source: corrective.reports[0], report: corrective.reports[0], ot: corrective.ot, status: 'Solicitado', days: 50 }),
  ];

  // Stock discount of the installed part.
  const used = items[1];
  movements.push({
    _id: id('movimiento:salida:instalado'),
    tenantId,
    itemId: used._id,
    itemNombre: used.nombre,
    tipo: 'salida',
    cantidad: 1,
    stockAnterior: used.stockActual,
    stockResultante: used.stockActual - 1,
    ...(closed
      ? { motivo: `Instalado en ${closed.ot.Consecutivo}`, referenciaTipo: 'OT', referenciaId: String(closed.ot._id) }
      : { motivo: 'Entregado para un mantenimiento externo', referenciaTipo: 'manual' }),
    usuarioId: String(admin._id),
    createdAt: ctx.daysAgo(114),
  });
  used.stockActual -= 1;

  return [
    { Model: InventarioRepuesto, docs: items },
    { Model: InventarioMovimiento, docs: movements },
    { Model: Repuestos, docs: repuestos },
  ];
}
