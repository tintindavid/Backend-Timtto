import mongoose from 'mongoose';
import { PresupuestoArea } from '../models/presupuestoArea.model.js';
import { Area } from '../models/area.model.js';
import { Requisicion } from '../models/requisicion.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { requireTenant } from '../utils/tenant.util.js';
import { roundMoney } from '../utils/money.util.js';
import { periodoToRange } from '../utils/requisicionPeriod.util.js';
import {
  DEFAULT_ALERT_THRESHOLD,
  PRESUPUESTO_ESTADOS_COMPROMETIDO,
  PRESUPUESTO_ESTADOS_CONSUMIDO,
} from '../constants/requisicion.constants.js';
import { getTenantCurrency } from '../utils/tenantCurrency.util.js';

/**
 * Sum of `montoEstimado` of the area's requisitions in `estados` whose `dateField` falls in [from, to).
 * Aggregations bypass the model's find hook, so tenantId and isDeleted are added by hand (never trust the caller).
 */
async function sumByState(tenantId, areaId, estados, dateField, range) {
  const [row] = await Requisicion.aggregate([
    {
      $match: {
        tenantId,
        isDeleted: false,
        areaId: new mongoose.Types.ObjectId(String(areaId)),
        estado: { $in: estados },
        [dateField]: { $gte: range.from, $lt: range.to },
      },
    },
    { $group: { _id: null, total: { $sum: '$montoEstimado' } } },
  ]);
  return roundMoney(row ? row.total : 0);
}

export class PresupuestoService {
  /**
   * Informative budget summary of an area for a period; nothing is stored, nothing blocks.
   *  - consumido: approved requisitions of the period (by `aprobadaAt`);
   *  - comprometido: submitted or in approval (by `enviadaAt`);
   *  - disponible = monto - consumido - comprometido (may be negative);
   *  - porcentaje = (consumido + comprometido) / monto * 100;
   *  - alerta: porcentaje >= umbralAlerta; sobrepasado: consumido > monto.
   * Windows are expressed in America/Bogota. Without a configured budget the amounts are still returned with
   * `configurado: false` (monto, disponible and porcentaje null).
   */
  async getResumen(tenantId, { areaId, periodo }) {
    requireTenant(tenantId);
    const range = periodoToRange(periodo);
    if (!range) throw new ApiError(400, 'periodo debe ser YYYY o YYYY-MM', 'PERIODO_INVALIDO', { periodo });

    const area = await Area.exists({ _id: areaId, tenantId });
    if (!area) throw new ApiError(404, 'Área no encontrada', 'AREA_NOT_FOUND', { areaId });

    const presupuesto = await PresupuestoArea.findOne({ tenantId, areaId, periodo }).lean();
    const [consumido, comprometido] = await Promise.all([
      sumByState(tenantId, areaId, PRESUPUESTO_ESTADOS_CONSUMIDO, 'aprobadaAt', range),
      sumByState(tenantId, areaId, PRESUPUESTO_ESTADOS_COMPROMETIDO, 'enviadaAt', range),
    ]);

    const moneda = presupuesto ? presupuesto.moneda : await getTenantCurrency(tenantId);
    if (!presupuesto) {
      return {
        areaId: String(areaId), periodo, configurado: false, moneda,
        monto: null, consumido, comprometido, disponible: null, porcentaje: null,
        umbralAlerta: DEFAULT_ALERT_THRESHOLD, alerta: false, sobrepasado: false,
      };
    }
    const monto = roundMoney(presupuesto.monto);
    const umbralAlerta = presupuesto.umbralAlerta ?? DEFAULT_ALERT_THRESHOLD;
    const porcentaje = monto > 0 ? roundMoney(((consumido + comprometido) / monto) * 100) : (consumido + comprometido > 0 ? 100 : 0);
    return {
      areaId: String(areaId), periodo, configurado: true, moneda,
      monto, consumido, comprometido,
      disponible: roundMoney(monto - consumido - comprometido),
      porcentaje, umbralAlerta,
      alerta: porcentaje >= umbralAlerta,
      sobrepasado: consumido > monto,
    };
  }
}

export const presupuestoService = new PresupuestoService();
