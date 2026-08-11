'use strict';
import { publicSheetSignService } from '../services/publicSheetSign.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

export class PublicSheetSignController {
  async get(req, res, next) {
    try {
      res.set('Cache-Control', 'no-store, private');
      const data = await publicSheetSignService.getForToken(req.params.token);
      res.status(200).json(successResponse(data, 'Estado de la solicitud de firma'));
    } catch (err) { next(err); }
  }

  async sign(req, res, next) {
    try {
      res.set('Cache-Control', 'no-store, private');
      const data = await publicSheetSignService.signWithToken(req.params.token, req.body, {
        ip: req.ip || null,
        userAgent: req.get('user-agent') || null,
      });
      res.status(200).json(successResponse(data, 'Hoja firmada exitosamente'));
    } catch (err) { next(err); }
  }
}

export const publicSheetSignController = new PublicSheetSignController();
