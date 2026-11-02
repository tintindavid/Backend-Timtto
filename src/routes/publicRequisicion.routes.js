import { Router } from 'express';
import { requisicionPortalPublicoController as C, resolvePortalToken, precheckPortalCotizacion } from '../controllers/requisicionPortalPublico.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { uploadCotizacionArchivo, handleMulterError } from '../middlewares/upload.middleware.js';
import { requisicionPortalIpLimiter, requisicionPortalTokenLimiter } from '../middlewares/rateLimiter.middleware.js';
import { portalRespuestaDto, portalRespuestaInvitacionDto } from '../dtos/requisicionLicitacion.dto.js';

const router = Router({ mergeParams: true });

/**
 * Public supplier portal of the requisitions (E3). Mounted at /api/v1/public/requisiciones/:token OUTSIDE the
 * authenticated domain routers: there is no JWT, no tenant header and no capability map entry (the portal service
 * itself requires an active tenant with the Requisiciones module and answers a generic 404 otherwise).
 *
 * Order matters: (1) the limiters (per IP, then per IP + token) run BEFORE any database access, so unknown tokens
 * consume them; (2) the token is resolved (generic 404 / 403 TOKEN_EXPIRADO) BEFORE a file is buffered; (3) the body is
 * validated with a strict allowlist (an extra field such as `estadoEnvio` is a 400).
 */
router.use(requisicionPortalIpLimiter, requisicionPortalTokenLimiter);

router.get('/', resolvePortalToken, C.get);
router.patch('/respuesta-invitacion', resolvePortalToken, validate(portalRespuestaInvitacionDto, 'body'), C.responderInvitacion);
router.patch('/respuesta', resolvePortalToken, precheckPortalCotizacion, uploadCotizacionArchivo, handleMulterError, validate(portalRespuestaDto, 'body'), C.enviarCotizacion);

export default router;
