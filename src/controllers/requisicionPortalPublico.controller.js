import { requisicionPortalPublicoService as portal } from '../services/requisicionPortalPublico.service.js';
import { successResponse } from '../utils/apiResponse.util.js';

/**
 * Binding only for the PUBLIC supplier portal. There is no user and no tenant on these requests: everything comes from
 * the token (resolved by `resolvePortalToken`, which runs AFTER the rate limiters and BEFORE any file is buffered).
 */

/** Resolves the token into `req.portal` (generic 404 / 403 TOKEN_EXPIRADO otherwise). Never logs the token. */
export async function resolvePortalToken(req, _res, next) {
  try {
    req.portal = await portal.resolve(req.params.token, { ip: req.ip });
    next();
  } catch (err) { next(err); }
}

/** Refuses a quotation before multer buffers the file when the tender is closed / late / the supplier cannot quote. */
export function precheckPortalCotizacion(req, _res, next) {
  try {
    portal.assertPuedeCotizar(req.portal);
    next();
  } catch (err) { next(err); }
}

export class RequisicionPortalPublicoController {
  async get(req, res, next) {
    try {
      res.json(successResponse(portal.view(req.portal), 'OK'));
    } catch (err) { next(err); }
  }

  async responderInvitacion(req, res, next) {
    try {
      const data = await portal.responderInvitacion(req.portal, req.body.aceptar);
      res.json(successResponse(data, req.body.aceptar ? 'Invitación aceptada' : 'Invitación rechazada'));
    } catch (err) { next(err); }
  }

  async enviarCotizacion(req, res, next) {
    try {
      const data = await portal.enviarCotizacion(req.portal, req.body, req.file || null);
      res.json(successResponse(data, 'Cotización recibida'));
    } catch (err) { next(err); }
  }
}

export const requisicionPortalPublicoController = new RequisicionPortalPublicoController();
