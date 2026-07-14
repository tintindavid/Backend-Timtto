'use strict';
import { Router } from 'express';
import { ticketController } from '../controllers/ticket.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import {
  createTicketAdminDto,
  assignTicketDto,
  addNoteDto,
  cancelTicketDto,
  createWorkOrderFromTicketsDto,
  queryTicketsDto,
} from '../dtos/ticket.dto.js';

const router = Router();
router.use(authenticate);

router.get('/stats', authorize(PERMISSIONS.TICKETS_READ), ticketController.stats);

router.post(
  '/work-order',
  authorize(PERMISSIONS.OTS_CREATE),
  validate(createWorkOrderFromTicketsDto, 'body'),
  ticketController.createWorkOrder,
);

router.get('/batch/:batchId', authorize(PERMISSIONS.TICKETS_READ), ticketController.getByBatch);

router.get('/', authorize(PERMISSIONS.TICKETS_READ), validate(queryTicketsDto, 'query'), ticketController.list);
router.post('/', authorize(PERMISSIONS.TICKETS_CREATE), validate(createTicketAdminDto, 'body'), ticketController.create);

router.get('/:id', authorize(PERMISSIONS.TICKETS_READ), ticketController.getById);
router.patch('/:id/assign', authorize(PERMISSIONS.TICKETS_UPDATE), validate(assignTicketDto, 'body'), ticketController.assign);
router.post('/:id/note', authorize(PERMISSIONS.TICKETS_REPLY), validate(addNoteDto, 'body'), ticketController.addNote);
router.patch('/:id/cancel', authorize(PERMISSIONS.TICKETS_CLOSE), validate(cancelTicketDto, 'body'), ticketController.cancel);

export default router;
