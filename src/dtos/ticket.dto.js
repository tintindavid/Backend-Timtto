'use strict';
import Joi from 'joi';
import {
  TICKET_STATUS_VALUES,
  TICKET_URGENCY_VALUES,
  TICKET_SOURCE_VALUES,
  REQUESTED_BY_NAME_REGEX,
  REQUESTED_BY_POSITION_MIN,
  REQUESTED_BY_POSITION_MAX,
  TICKET_BATCH_MAX_EQUIPMENTS,
  TICKET_OBSERVATION_MAX_LENGTH,
} from '../constants/ticket.constants.js';

const objectId = Joi.string().hex().length(24);

const equipoEntryDto = Joi.object({
  equipoId: objectId.required().label('equipoId'),
  observation: Joi.string().allow('').max(TICKET_OBSERVATION_MAX_LENGTH).optional().label('observation'),
});

/**
 * Admin: POST /api/tickets
 * The panel session user supplies the requester data implicitly (server uses
 * req.user.fullName / req.user.role). The body therefore does NOT carry
 * requestedBy — that prevents spoofing.
 */
export const createTicketAdminDto = Joi.object({
  ClienteId: objectId.required(),
  sedeId: objectId.required(),
  servicioId: objectId.required(),
  equipos: Joi.array().items(equipoEntryDto).min(1).max(TICKET_BATCH_MAX_EQUIPMENTS).required(),
  generalObservation: Joi.string().allow('').max(TICKET_OBSERVATION_MAX_LENGTH).optional(),
  urgency: Joi.string().valid(...TICKET_URGENCY_VALUES).required(),
});

/**
 * Public requestedBy validator — used both standalone and embedded in the
 * public ticket creation DTO. Length and regex enforced per spec.
 */
export const requestedByDto = Joi.object({
  name: Joi.string().pattern(REQUESTED_BY_NAME_REGEX).required().messages({
    'string.pattern.base':
      'name must be 3..80 letters (Spanish alphabet only, spaces allowed)',
  }),
  position: Joi.string().min(REQUESTED_BY_POSITION_MIN).max(REQUESTED_BY_POSITION_MAX).required(),
});

/**
 * Public: POST /public/tickets
 * No ClienteId / sedeId / servicioId in body — these come from the sessionToken.
 */
export const createTicketPublicDto = Joi.object({
  equipos: Joi.array().items(equipoEntryDto).min(1).max(TICKET_BATCH_MAX_EQUIPMENTS).required(),
  generalObservation: Joi.string().allow('').max(TICKET_OBSERVATION_MAX_LENGTH).optional(),
  urgency: Joi.string().valid(...TICKET_URGENCY_VALUES).required(),
  requestedBy: requestedByDto.required(),
});

/** PATCH /api/tickets/:id/assign */
export const assignTicketDto = Joi.object({
  responsableId: objectId.required(),
});

/** POST /api/tickets/:id/note */
export const addNoteDto = Joi.object({
  note: Joi.string().min(1).max(1000).required(),
});

/** PATCH /api/tickets/:id/cancel */
export const cancelTicketDto = Joi.object({
  closingObservation: Joi.string().allow('').max(TICKET_OBSERVATION_MAX_LENGTH).optional(),
});

/** POST /api/tickets/work-order */
export const createWorkOrderFromTicketsDto = Joi.object({
  ticketIds: Joi.array().items(objectId).min(1).max(TICKET_BATCH_MAX_EQUIPMENTS).required(),
  responsableId: objectId.required(),
});

/** GET /api/tickets — query filters */
export const queryTicketsDto = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(200).optional(),
  sortBy: Joi.string().optional(),
  order: Joi.string().valid('asc', 'desc').optional(),
  search: Joi.string().allow('').optional(),
  status: Joi.alternatives(
    Joi.string().valid(...TICKET_STATUS_VALUES),
    Joi.array().items(Joi.string().valid(...TICKET_STATUS_VALUES))
  ).optional(),
  ClienteId: objectId.optional(),
  servicioId: objectId.optional(),
  sedeId: objectId.optional(),
  equipoId: objectId.optional(),
  urgency: Joi.string().valid(...TICKET_URGENCY_VALUES).optional(),
  assignedTo: objectId.optional(),
  batchId: Joi.string().optional(),
  source: Joi.string().valid(...TICKET_SOURCE_VALUES).optional(),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().optional(),
}).unknown(false);
