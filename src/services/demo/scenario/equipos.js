import { EquipoItem } from '../../../models/equipoitem.model.js';
import { MESES_ARRAY } from '../../../utils/meses.util.js';
import { itemsConProtocolo } from '../demoCatalog.js';

const TOTAL = 15;
const BRANDS = [['Mindray', 'BeneVision N12'], ['Philips', 'IntelliVue MX450'], ['GE', 'Carescape B450'], ['Dräger', 'Vista 300'], ['Welch Allyn', 'Connex 6000']];
const RISKS = ['I', 'IIA', 'IIB', 'III'];
const FEATURED_ITEMS = [/MONITOR MULTIPAR/i, /BOMBA DE INFUSI/i];
// Positions that are not operative, so the dashboard and filters have something to show.
const STATES = { 3: 'Fuera de Servicio', 7: 'En Reparacion', 11: 'Espera de Repuestos' };

/** Fifteen pieces of equipment spread over the services, with a maintenance schedule around the current month. */
export function buildEquipos(ctx) {
  const { tenantId, id, admin, now, catalog } = ctx;
  const { cliente, servicios } = ctx.refs;
  const usable = itemsConProtocolo(catalog);
  // The first two are the featured ones (in every work order, with parameter verification): a monitor and a pump.
  const featured = FEATURED_ITEMS.map((pattern) => usable.find((i) => pattern.test(i.Nombre)));
  const others = usable.filter((i) => !featured.includes(i));
  const pool = others.length ? others : usable;
  // Spread the rest of the picks over the whole catalogue for variety.
  const step = Math.max(1, Math.floor(pool.length / TOTAL));
  const month = now.getUTCMonth(); // 0-11
  const monthName = (offset) => MESES_ARRAY[((month + offset + 24) % 12) + 1];

  const equipos = Array.from({ length: TOTAL }, (_, i) => {
    const item = featured[i] ?? pool[(i * step) % pool.length];
    const { doc: servicio, sede } = servicios[i % servicios.length];
    const [Marca, Modelo] = BRANDS[i % BRANDS.length];
    const estado = STATES[i] ?? 'Operativo';
    // Two visits a year already done in the window, one this month and the next one.
    const mesesMtto = i % 2 === 0
      ? [monthName(-4), monthName(0), monthName(4)]
      : [monthName(-2), monthName(1), monthName(5)];
    const doc = {
      _id: id(`equipo:${i}`),
      tenantId,
      ClienteId: cliente._id,
      ItemId: id(`item:${item.key}`),
      SedeId: sede._id,
      Servicio: servicio._id,
      Estado: 'Activo',
      EstadoOperativo: estado,
      estadoOperativoHistory: [{
        _id: id(`equipo:${i}:estado`),
        from: null,
        to: estado,
        changedBy: admin._id,
        changedByName: admin.fullName,
        source: 'manual',
        at: ctx.daysAgo(180),
      }],
      Marca,
      Modelo,
      Serie: `DEMO-SN-${String(i + 1).padStart(4, '0')}`,
      Inventario: `INV-${String(i + 1).padStart(4, '0')}`,
      Ubicacion: `Cubículo ${(i % 5) + 1}`,
      Riesgo: RISKS[i % RISKS.length],
      Invima: `2020DM-${String(1000 + i)}`,
      mesesMtto,
      mesesMttoRealizados: [],
      ProximoMtto: mesesMtto[1],
    };
    return { doc, item, servicio, sede };
  });

  ctx.refs.equipos = equipos;
  return [{ Model: EquipoItem, docs: equipos.map((e) => e.doc) }];
}
