import { Customer } from '../../../models/customer.model.js';
import { Sedes } from '../../../models/sedes.model.js';
import { Servicios } from '../../../models/servicios.model.js';

/** One sample client with two branches and three services, plus one provider. */
export function buildTerceros(ctx) {
  const { tenantId, id } = ctx;
  const cliente = {
    _id: id('customer:cliente'),
    tenantId,
    kind: 'customer',
    Razonsocial: 'Clínica Ejemplo San Rafael',
    Nit: 900000001,
    Ciudad: 'Bogotá',
    Departamento: 'Cundinamarca',
    Direccion: 'Calle 100 # 10-20',
    Email: 'contacto@clinica-ejemplo.example.com',
    TelContacto: '6010000001',
    UserContacto: 'Laura Gómez',
  };
  const proveedor = {
    _id: id('customer:proveedor'),
    tenantId,
    kind: 'provider',
    Razonsocial: 'Metrología Ejemplo S.A.S.',
    Nit: 900000002,
    Ciudad: 'Medellín',
    Departamento: 'Antioquia',
    Email: 'servicio@metrologia-ejemplo.example.com',
    TelContacto: '6040000002',
    UserContacto: 'Carlos Pérez',
  };
  const sede = (key, nombreSede, direccion) => ({
    _id: id(`sede:${key}`),
    tenantId,
    Cliente: cliente._id,
    nombreSede,
    contact: cliente.UserContacto,
    departamento: cliente.Departamento,
    ciudad: cliente.Ciudad,
    direccion,
    telefono: cliente.TelContacto,
    email: cliente.Email,
  });
  const sedes = [sede('principal', 'Principal', cliente.Direccion), sede('norte', 'Sede Norte', 'Carrera 15 # 140-30')];
  const servicio = (key, nombre, sedeDoc) => ({
    doc: { _id: id(`servicio:${key}`), tenantId, Cliente: cliente._id, nombre, observacion: 'Servicio de ejemplo' },
    sede: sedeDoc,
  });
  const servicios = [
    servicio('uci', 'Cuidados intensivos', sedes[0]),
    servicio('urgencias', 'Urgencias', sedes[0]),
    servicio('consulta', 'Consulta externa', sedes[1]),
  ];

  Object.assign(ctx.refs, { cliente, proveedor, sedes, servicios });
  return [
    { Model: Customer, docs: [cliente, proveedor] },
    { Model: Sedes, docs: sedes },
    { Model: Servicios, docs: servicios.map((s) => s.doc) },
  ];
}
