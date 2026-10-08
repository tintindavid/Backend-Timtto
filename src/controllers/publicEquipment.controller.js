'use strict';
import { publicEquipmentService } from '../services/publicEquipment.service.js';
import { successResponse } from '../utils/apiResponse.util.js';
import { logger } from '../config/logger.config.js';
import { PUBLIC_CACHE_SECONDS, PUBLIC_SWR_SECONDS } from '../constants/equipmentQr.constants.js';

/**
 * publicEquipmentController — GET /api/public/equipo/:qrToken.
 *
 * Observability (spec Requirement "Observability on public hits"): logs
 * `qrTokenPrefix` (first 6 chars ONLY — the full token is NEVER logged),
 * `equipoId`, `tenantId`, `status`, `ip`, `userAgent`, `durationMs` on every
 * hit, success or failure.
 */
export class PublicEquipmentController {
  async getHistory(req, res, next) {
    const start = Date.now();
    const { qrToken } = req.params;
    const qrTokenPrefix = typeof qrToken === 'string' ? qrToken.slice(0, 6) : '';
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || null;

    try {
      const { dto, _internal } = await publicEquipmentService.getHistory(qrToken);

      res.set('Cache-Control', `public, max-age=${PUBLIC_CACHE_SECONDS}, stale-while-revalidate=${PUBLIC_SWR_SECONDS}`);

      logger.info('Public equipment QR hit', {
        qrTokenPrefix,
        equipoId: _internal.equipoId,
        tenantId: _internal.tenantId,
        status: 200,
        ip,
        userAgent,
        durationMs: Date.now() - start,
      });

      res.json(successResponse(dto, 'Historial de equipo'));
    } catch (err) {
      logger.info('Public equipment QR hit', {
        qrTokenPrefix,
        equipoId: null,
        tenantId: null,
        status: err.statusCode || 500,
        ip,
        userAgent,
        durationMs: Date.now() - start,
      });
      next(err);
    }
  }
}

export const publicEquipmentController = new PublicEquipmentController();
