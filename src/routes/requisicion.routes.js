import { Router } from 'express';
import { requisicionController } from '../controllers/requisicion.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { redactLicitacionQuotes } from '../middlewares/redactLicitacionQuotes.middleware.js';
import { authorize, authorizeAny } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  createRequisicionDto,
  updateRequisicionDto,
  queryRequisicionDto,
  enviarRequisicionDto,
  cancelarRequisicionDto,
  cambiarEstadoRequisicionDto,
  aprobarRequisicionDto,
  rechazarRequisicionDto,
  reasignarAprobadoresDto,
  registrarRecepcionDto,
  confirmarEntregaDto,
  cerrarLineaDto,
  recepcionParamsDto,
  lineaParamsDto,
} from '../dtos/requisicion.dto.js';
import { uploadRequisicionEvidencias, uploadCotizacionArchivo, handleMulterError } from '../middlewares/upload.middleware.js';
import { requisicionLicitacionController } from '../controllers/requisicionLicitacion.controller.js';
import {
  proveedorParamsDto,
  asignarProveedorDto,
  abrirLicitacionDto,
  ampliarFechaLimiteDto,
  reenviarInvitacionDto,
  cotizacionDto,
  compraDirectaDto,
  emptyBodyDto,
} from '../dtos/requisicionLicitacion.dto.js';
import { objectIdParamDto } from '../dtos/objectIdParam.dto.js';

const router = Router();
router.use(authenticate);
// E3: quotations are commercial information; hidden from users without manage-suppliers / select-winner / not the creator.
router.use(redactLicitacionQuotes);

// Gated by the usesRequisiciones capability (CAPABILITY_ROUTE_MAP '/api/v1/requisiciones', blockReads).
router.get('/', authorize(PERMISSIONS.REQUISICIONES_READ), validate(queryRequisicionDto, 'query'), requisicionController.list);
router.post('/', authorize(PERMISSIONS.REQUISICIONES_CREATE), validate(createRequisicionDto, 'body'), requisicionController.create);

router.get('/:id', authorize(PERMISSIONS.REQUISICIONES_READ), validate(objectIdParamDto, 'params'), requisicionController.getById);
router.patch('/:id', authorize(PERMISSIONS.REQUISICIONES_UPDATE), validate(objectIdParamDto, 'params'), validate(updateRequisicionDto, 'body'), requisicionController.update);
router.delete('/:id', authorize(PERMISSIONS.REQUISICIONES_DELETE), validate(objectIdParamDto, 'params'), requisicionController.delete);

router.post('/:id/enviar', authorize(PERMISSIONS.REQUISICIONES_SEND), validate(objectIdParamDto, 'params'), validate(enviarRequisicionDto, 'body'), requisicionController.enviar);
router.post('/:id/cancelar', authorize(PERMISSIONS.REQUISICIONES_CANCEL), validate(objectIdParamDto, 'params'), validate(cancelarRequisicionDto, 'body'), requisicionController.cancelar);
// Back to Borrador: retire (En_Aprobacion) or reopen (Rechazada); done by the creator who edits/sends.
router.patch('/:id/estado', authorizeAny(PERMISSIONS.REQUISICIONES_UPDATE, PERMISSIONS.REQUISICIONES_SEND), validate(objectIdParamDto, 'params'), validate(cambiarEstadoRequisicionDto, 'body'), requisicionController.cambiarEstado);

router.post('/:id/aprobacion/aprobar', authorize(PERMISSIONS.REQUISICIONES_APPROVE), validate(objectIdParamDto, 'params'), validate(aprobarRequisicionDto, 'body'), requisicionController.aprobar);
router.post('/:id/aprobacion/rechazar', authorize(PERMISSIONS.REQUISICIONES_APPROVE), validate(objectIdParamDto, 'params'), validate(rechazarRequisicionDto, 'body'), requisicionController.rechazar);
// Supervisor override: replace the approvers of a pending level (requires requisiciones:manage-all).
router.post('/:id/aprobacion/reasignar', authorize(PERMISSIONS.REQUISICIONES_MANAGE_ALL), validate(objectIdParamDto, 'params'), validate(reasignarAprobadoresDto, 'body'), requisicionController.reasignar);

// E2 reception. Register / close a line: requisiciones:receive or manage-all. Confirm: NO role permission (the
// service lets only the responsible of each solicitud, or manage-all, confirm; the capability gate still applies).
router.post('/:id/recepciones', authorizeAny(PERMISSIONS.REQUISICIONES_RECEIVE, PERMISSIONS.REQUISICIONES_MANAGE_ALL), validate(objectIdParamDto, 'params'), uploadRequisicionEvidencias, handleMulterError, validate(registrarRecepcionDto, 'body'), requisicionController.registrarRecepcion);
router.post('/:id/recepciones/:recepcionId/confirmar', validate(recepcionParamsDto, 'params'), validate(confirmarEntregaDto, 'body'), requisicionController.confirmarEntrega);
router.post('/:id/lineas/:lineaId/cerrar', authorizeAny(PERMISSIONS.REQUISICIONES_RECEIVE, PERMISSIONS.REQUISICIONES_MANAGE_ALL), validate(lineaParamsDto, 'params'), validate(cerrarLineaDto, 'body'), requisicionController.cerrarLinea);

// E3 tendering (requisiciones-e3-compras-portal). manage-suppliers: assign / send / resend / quote / close.
// select-winner: choose the winner and direct purchase. The comparison is readable by both.
const idParams = validate(objectIdParamDto, 'params');
const paParams = validate(proveedorParamsDto, 'params');
const buyer = authorize(PERMISSIONS.REQUISICIONES_MANAGE_SUPPLIERS);
const winner = authorize(PERMISSIONS.REQUISICIONES_SELECT_WINNER);
const L = requisicionLicitacionController;

router.post('/:id/proveedores', buyer, idParams, validate(asignarProveedorDto, 'body'), L.asignarProveedor);
router.delete('/:id/proveedores/:paId', buyer, paParams, L.quitarProveedor);
router.post('/:id/licitacion/abrir', buyer, idParams, validate(abrirLicitacionDto, 'body'), L.abrir);
router.patch('/:id/licitacion/fecha-limite', buyer, idParams, validate(ampliarFechaLimiteDto, 'body'), L.ampliarFechaLimite);
router.post('/:id/proveedores/:paId/reenviar', buyer, paParams, validate(reenviarInvitacionDto, 'body'), L.reenviar);
router.post('/:id/proveedores/:paId/cotizacion', buyer, paParams, uploadCotizacionArchivo, handleMulterError, validate(cotizacionDto, 'body'), L.registrarCotizacion);
router.post('/:id/licitacion/cerrar', buyer, idParams, validate(emptyBodyDto, 'body'), L.cerrar);
router.get('/:id/licitacion/comparativo', authorizeAny(PERMISSIONS.REQUISICIONES_MANAGE_SUPPLIERS, PERMISSIONS.REQUISICIONES_SELECT_WINNER), idParams, L.comparativo);
router.patch('/:id/proveedores/:paId/seleccionar-ganador', winner, paParams, validate(emptyBodyDto, 'body'), L.seleccionarGanador);
router.post('/:id/compra-directa', winner, idParams, validate(compraDirectaDto, 'body'), L.compraDirecta);

export default router;
