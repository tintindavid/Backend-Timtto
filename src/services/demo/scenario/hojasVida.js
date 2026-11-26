import { HVEquipo } from '../../../models/hvequipo.model.js';
import { buildTolerances } from './verificacion.js';

/** Equipment records ("hojas de vida") of the first two pieces of equipment. */
export function buildHojasVida(ctx) {
  const { tenantId, id, admin } = ctx;
  const { cliente, proveedor } = ctx.refs;
  const docs = ctx.refs.equipos.slice(0, 2).map(({ doc: equipo, item, servicio, sede }, i) => {
    equipo.TieneHV = true;
    return {
      _id: id(`hv:${i}`),
      tenantId,
      EquipoId: equipo._id,
      clienteId: cliente._id,
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
      NombreCliente: cliente.Razonsocial,
      Servicio: servicio.nombre,
      Fabricante: equipo.Marca,
      NombreProveedor: proveedor.Razonsocial,
      CiudadProveedor: proveedor.Ciudad,
      EmailProveedor: proveedor.Email,
      TelefonoProveedor: proveedor.TelContacto,
      AnoFabricacion: ctx.now.getUTCFullYear() - 3,
      FechaAdquisicin: ctx.daysAgo(900),
      FechaInstalacion: ctx.daysAgo(880),
      FechaInicioGarantia: ctx.daysAgo(880),
      FechaFinGarantia: ctx.daysAhead(215),
      ClasificacinRiesgo: equipo.Riesgo,
      RegistroINVIMA: equipo.Invima,
      FuenteAlimentacion: 'Red eléctrica y batería',
      Voltaje: '110-220 V',
      PeriodicidadMantenimiento: '4',
      RequiereCalibracion: true,
      PeriodicidadCalibracion: '12',
      UsoEquipo: 'Monitoreo y soporte vital',
      Descripcion: 'Hoja de vida de ejemplo.',
      EstadoHV: 'Guardada',
      FechaCreacion: ctx.daysAgo(150),
      userIdCreacion: admin._id,
      verificationTolerances: buildTolerances(i, (n) => id(`hv:${i}:tolerancia:${n}`)),
      Accesorios: [{ _id: id(`hv:${i}:accesorio`), nombre: 'Cable de poder', cantidad: 1, estado: 'Bueno' }],
    };
  });
  return [{ Model: HVEquipo, docs }];
}
