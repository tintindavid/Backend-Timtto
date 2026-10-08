'use strict';
import Joi from 'joi';
import { MAX_BULK_SIZE } from '../constants/equipmentQr.constants.js';

const objectId = Joi.string().hex().length(24);

const equipoFilterSchema = Joi.object({
  ClienteId: objectId.optional(),
  SedeId: objectId.optional(),
  Servicio: objectId.optional(),
  EstadoOperativo: Joi.string().optional(),
  search: Joi.string().allow('').optional(),
}).unknown(false);

/** POST /api/v1/equipment-qrs */
export const createEquipmentQrDto = Joi.object({
  equipoId: objectId.required(),
}).unknown(false);

/** POST /api/v1/equipment-qrs/bulk-generate */
export const bulkGenerateEquipmentQrDto = Joi.object({
  filter: equipoFilterSchema.optional().default({}),
  limit: Joi.number().integer().min(1).max(MAX_BULK_SIZE).optional(),
}).unknown(false);

/** GET /api/v1/equipment-qrs */
export const queryEquipmentQrsDto = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  ClienteId: objectId.optional(),
  SedeId: objectId.optional(),
  Servicio: objectId.optional(),
  EstadoOperativo: Joi.string().optional(),
  search: Joi.string().allow('').optional(),
}).unknown(false);

/** GET /api/v1/equipment-qrs/export-pdf */
export const exportPdfBulkQueryDto = Joi.object({
  ids: Joi.string().optional(),
  filter: Joi.string().optional(),
}).unknown(false);
