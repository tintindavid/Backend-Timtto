'use strict';
import { Router } from 'express';
import { ticketController } from '../controllers/ticket.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
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

// Stats (must be before /:id)
router.get('/stats', ticketController.stats);

// Atomic OT creation from N tickets (must be before /:id)
router.post(
  '/work-order',
  validate(createWorkOrderFromTicketsDto, 'body'),
  ticketController.createWorkOrder
);

// Batch
router.get('/batch/:batchId', ticketController.getByBatch);

// Collection
router.get('/', validate(queryTicketsDto, 'query'), ticketController.list);
router.post('/', validate(createTicketAdminDto, 'body'), ticketController.create);

// Single resource
router.get('/:id', ticketController.getById);
router.patch('/:id/assign', validate(assignTicketDto, 'body'), ticketController.assign);
router.post('/:id/note', validate(addNoteDto, 'body'), ticketController.addNote);
router.patch('/:id/cancel', validate(cancelTicketDto, 'body'), ticketController.cancel);

export default router;
