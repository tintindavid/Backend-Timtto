import { CadenaActividad } from '../models/cadenaActividad.model.js';
import { EquipoItem } from '../models/equipoitem.model.js';
import { Customer } from '../models/customer.model.js';
import { EquipoActividadExterna } from '../models/equipoActividadExterna.model.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { calcularMesesRecurrentes, calcularVencimiento, MESES_ABREV } from '../utils/cronogramaMeses.util.js';

export const DEFAULT_LIMIT = 2000;
export const MAX_LIMIT = 5000;

const idOf = (value) => String(value?._id ?? value);

/**
 * Tenant-wide read of the scheduled external activities (vigente chains with a due date)
 * for the unified schedule. Three queries per call (chains, equipment, clients), never one
 * per row. Chains of soft-deleted equipment are dropped.
 *
 * @param {string} tenantId
 * @param {{ clienteId?: string, mes?: string, tipo?: string, anio?: number, limit?: number }} [filters]
 * @param {Date} [now]
 * @returns {Promise<{ data: object[], truncated: boolean }>}
 */
export async function listarActividadesExternas(tenantId, filters = {}, now = new Date()) {
  requireTenant(tenantId);
  const { clienteId, mes, tipo } = filters;
  const anioPedido = Number(filters.anio);
  const anio = Number.isInteger(anioPedido) && anioPedido > 0 ? anioPedido : now.getUTCFullYear();
  const limit = Math.min(Math.max(Number(filters.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const query = applyTenantFilter({
    estado: 'vigente',
    fechaProxima: { $ne: null },
    ...(clienteId ? { clienteId } : {}),
    ...(tipo ? { tipo } : {}),
  }, tenantId);

  const chains = await CadenaActividad.find(query)
    .sort({ fechaProxima: 1 })
    .limit(limit + 1)
    .populate('actividadVigenteId', 'proveedor proveedorId')
    .lean();

  // `mes` is applied on the computed recurrence, so the cap can truncate before it; the flag
  // still tells the UI that the tenant has more chains than were examined.
  const truncated = chains.length > limit;
  const examined = truncated ? chains.slice(0, limit) : chains;

  const equipoIds = [...new Set(examined.map((c) => idOf(c.equipoId)))];
  const clienteIds = [...new Set(examined.map((c) => idOf(c.clienteId)))];

  // The activities of the examined chains give both the months executed during `anio` and the date the chain
  // started (its earliest activity), so nothing is projected before the chain existed. One query, few rows.
  const cadenaIds = examined.map((c) => c._id);

  const [equipos, clientes, actividades] = await Promise.all([
    EquipoItem.find(applyTenantFilter({ _id: { $in: equipoIds }, isDeleted: false }, tenantId))
      .select('ItemId Marca Modelo Serie Inventario Ubicacion')
      .populate('ItemId', 'Nombre')
      .lean(),
    Customer.find(applyTenantFilter({ _id: { $in: clienteIds } }, tenantId))
      .select('Razonsocial')
      .lean(),
    EquipoActividadExterna.find(applyTenantFilter({ cadenaId: { $in: cadenaIds } }, tenantId))
      .select('cadenaId fecha')
      .lean(),
  ]);
  const equipoById = new Map(equipos.map((e) => [idOf(e), e]));
  const clienteById = new Map(clientes.map((c) => [idOf(c), c]));

  // cadenaId -> executed months of the year (the earliest activity of each month) and first activity date
  const realizadasPorCadena = new Map();
  const inicioPorCadena = new Map();
  for (const act of actividades) {
    const fecha = new Date(act.fecha);
    const key = idOf(act.cadenaId);
    const inicio = inicioPorCadena.get(key);
    if (!inicio || fecha < inicio) inicioPorCadena.set(key, fecha);
    if (fecha.getUTCFullYear() !== anio) continue;
    const mesAbrev = MESES_ABREV[fecha.getUTCMonth()];
    const porMes = realizadasPorCadena.get(key) ?? new Map();
    const previa = porMes.get(mesAbrev);
    if (!previa || fecha < previa) porMes.set(mesAbrev, fecha);
    realizadasPorCadena.set(key, porMes);
  }

  const data = [];
  for (const chain of examined) {
    const equipo = equipoById.get(idOf(chain.equipoId));
    if (!equipo) continue;

    const meses = calcularMesesRecurrentes(chain.fechaProxima, chain.frecuenciaMeses, {
      anio,
      desde: inicioPorCadena.get(String(chain._id)) ?? null,
    });
    if (mes && !meses.includes(mes)) continue;

    const { vencida, diasParaVencer } = calcularVencimiento(chain.fechaProxima, now);
    const vigente = chain.actividadVigenteId && typeof chain.actividadVigenteId === 'object'
      ? chain.actividadVigenteId : null;
    const cliente = clienteById.get(idOf(chain.clienteId));
    const realizadas = MESES_ABREV
      .filter((m) => realizadasPorCadena.get(String(chain._id))?.has(m))
      .map((m) => ({ mes: m, fecha: realizadasPorCadena.get(String(chain._id)).get(m) }));

    data.push({
      cadenaId: String(chain._id),
      equipoId: idOf(chain.equipoId),
      clienteId: idOf(chain.clienteId),
      tipo: chain.tipo,
      tipoCustom: chain.tipoCustom ?? null,
      frecuenciaMeses: chain.frecuenciaMeses ?? null,
      fechaProxima: chain.fechaProxima,
      meses,
      realizadas,
      vencida,
      diasParaVencer,
      proveedor: vigente?.proveedor ?? null,
      proveedorId: vigente?.proveedorId ? String(vigente.proveedorId) : null,
      equipo: {
        nombre: equipo.ItemId?.Nombre ?? null,
        marca: equipo.Marca ?? null,
        modelo: equipo.Modelo ?? null,
        serie: equipo.Serie ?? null,
        inventario: equipo.Inventario ?? null,
        ubicacion: equipo.Ubicacion ?? null,
      },
      cliente: cliente ? { razonsocial: cliente.Razonsocial } : null,
    });
  }

  return { data, truncated };
}
