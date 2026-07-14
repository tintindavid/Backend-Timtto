'use strict';

import { historyService } from '../services/history.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class HistoryController {
  async listByResource(req, res, next) {
    try {
      const { resourceType, resourceId, page, limit } = req.query;
      const result = await historyService.listByResource(
        resourceType,
        resourceId,
        req.tenantId,
        { page, limit },
      );
      res.json(successResponse(result.data, 'Historial recuperado', 200, result.pagination));
    } catch (err) {
      next(err);
    }
  }
}

export const historyController = new HistoryController();
