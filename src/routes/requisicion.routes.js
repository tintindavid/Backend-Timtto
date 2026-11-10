import { Router } from 'express';
import { requisicionController } from '../controllers/requisicion.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { redactLicitacionQuotes } from '../middlewares/redactLicitacionQuotes.middleware.js';
import { authorize, authorizeAny, authorizeWhen } from '../middlewares/rbac.middleware.js';
import { authorizeReadOrParticipation, authorizeListOrMiHistorial } from '../middlewares/requisicionReadAccess.middleware.js';
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
import { uploadRequisicionEvidencias, uploadCotizacionArchivo, uploadEntregablesArchivos, handleMulterError } from '../middlewares/upload.middleware.js';
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
import { requisicionOrdenCompraController } from '../controllers/requisicionOrdenCompra.controller.js';
import {
  emitirOrdenCompraDto,
  editarOrdenCompraDto,
  aprobarOrdenCompraDto,
  rechazarOrdenCompraDto,
  reenviarOrdenCompraDto,
  devolverEntregablesDto,
  subirEntregablesDto,
} from '../dtos/requisicionOrdenCompra.dto.js';
import { objectIdParamDto } from '../dtos/objectIdParam.dto.js';
import { requisicionReportesUserLimiter } from '../middlewares/rateLimiter.middleware.js';
import { requisicionReporteController } from '../controllers/requisicionReporte.controller.js';
import { queryTableroDto, queryMetricasDto, queryExportListadoDto, queryComparativoExportDto } from '../dtos/requisicionReporte.dto.js';

const router = Router();
router.use(authenticate);
// E3: quotations are commercial information; hidden from users without manage-suppliers / select-winner / not the creator.
router.use(redactLicitacionQuotes);

// Gated by the usesRequisiciones capability (CAPABILITY_ROUTE_MAP '/api/v1/requisiciones', blockReads).
// Mi historial / detail: also open to who participated (the service answers 404 for the rest); a plain list still needs read.
router.get('/', authorizeListOrMiHistorial, authorizeWhen((req) => req.query?.alcance === 'tenant', PERMISSIONS.REQUISICIONES_REPORTS), validate(queryRequisicionDto, 'query'), requisicionController.list);
router.post('/', authorize(PERMISSIONS.REQUISICIONES_CREATE), validate(createRequisicionDto, 'body'), requisicionController.create);

// E5 reporting (requisiciones-e5-reporteria). These literal paths MUST be declared before every `/:id` route. The dashboard is
// self-scoped (any module user); the tenant section of it, the metrics and the list export need `requisiciones:reports`.
router.get('/tablero', requisicionReportesUserLimiter, validate(queryTableroDto, 'query'), requisicionReporteController.tablero);
router.get('/metricas', authorize(PERMISSIONS.REQUISICIONES_REPORTS), requisicionReportesUserLimiter, validate(queryMetricasDto, 'query'), requisicionReporteController.metricas);
router.get('/export/xlsx', authorize(PERMISSIONS.REQUISICIONES_REPORTS), requisicionReportesUserLimiter, validate(queryExportListadoDto, 'query'), requisicionReporteController.exportListado);

router.get('/:id', authorizeReadOrParticipation(), validate(objectIdParamDto, 'params'), requisicionController.getById);
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

// E4 purchase order and deliverables (requisiciones-e4-oc-recepcion). issue-po: issue / edit / send / resend. approve-po: approve
// / reject (the issuer is refused by the service: SEPARACION_DE_FUNCIONES). manage-deliverables: attach on behalf of the
// supplier, mark received, review, accept, return. The PDF is open to who can read the requisition (the service decides prices).
const issuePo = authorize(PERMISSIONS.REQUISICIONES_ISSUE_PO);
// approve-po OR approve at route level; the service enforces approve-po for the simple path and level eligibility for re-approval.
const decidePo = authorizeAny(PERMISSIONS.REQUISICIONES_APPROVE_PO, PERMISSIONS.REQUISICIONES_APPROVE);
const deliverables = authorize(PERMISSIONS.REQUISICIONES_MANAGE_DELIVERABLES);
const O = requisicionOrdenCompraController;

router.post('/:id/orden-compra', issuePo, idParams, validate(emitirOrdenCompraDto, 'body'), O.emitir);
router.patch('/:id/orden-compra', authorizeAny(PERMISSIONS.REQUISICIONES_ISSUE_PO, PERMISSIONS.REQUISICIONES_MANAGE_ALL), idParams, validate(editarOrdenCompraDto, 'body'), O.editar);
router.post('/:id/orden-compra/aprobar', decidePo, idParams, validate(aprobarOrdenCompraDto, 'body'), O.aprobar);
router.post('/:id/orden-compra/rechazar', decidePo, idParams, validate(rechazarOrdenCompraDto, 'body'), O.rechazar);
router.post('/:id/orden-compra/enviar', issuePo, idParams, validate(emptyBodyDto, 'body'), O.enviar);
router.post('/:id/orden-compra/reenviar', issuePo, idParams, validate(reenviarOrdenCompraDto, 'body'), O.reenviar);
router.get('/:id/orden-compra/pdf', authorizeReadOrParticipation(), idParams, O.pdf);

// E5 exports of one requisition (requisiciones-e5-reporteria): open to who can read it (the service answers 404 otherwise and redacts prices
// like the detail); the comparison needs the purchasing permissions. The list export is declared above, before the `/:id` routes.
const R = requisicionReporteController;
router.get('/:id/export/pdf', authorizeReadOrParticipation(), requisicionReportesUserLimiter, idParams, R.exportPdf);
router.get('/:id/export/xlsx', authorizeReadOrParticipation(), requisicionReportesUserLimiter, idParams, R.exportXlsx);
router.get('/:id/licitacion/comparativo/export', authorizeAny(PERMISSIONS.REQUISICIONES_MANAGE_SUPPLIERS, PERMISSIONS.REQUISICIONES_SELECT_WINNER), requisicionReportesUserLimiter, idParams, validate(queryComparativoExportDto, 'query'), R.exportComparativo);

router.post('/:id/entregables', deliverables, idParams, uploadEntregablesArchivos, handleMulterError, validate(subirEntregablesDto, 'body'), O.subirEntregables);
router.patch('/:id/entregables/marcar-recibidos', deliverables, idParams, validate(emptyBodyDto, 'body'), O.marcarRecibidos);
router.post('/:id/entregables/revisar', deliverables, idParams, validate(emptyBodyDto, 'body'), O.revisarEntregables);
router.post('/:id/entregables/aceptar', deliverables, idParams, validate(emptyBodyDto, 'body'), O.aceptarEntregables);
router.post('/:id/entregables/devolver', deliverables, idParams, validate(devolverEntregablesDto, 'body'), O.devolverEntregables);

export default router;
