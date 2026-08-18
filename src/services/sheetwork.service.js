import { SheetWork } from '../models/sheetwork.model.js';
import { Report } from '../models/report.model.js';
import { OT } from '../models/ot.model.js';
import { Customer } from '../models/customer.model.js';
import { User } from '../models/user.model.js';
import { Tenant } from '../models/tenant.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { getNextSequence, formatConsecutivo } from '../utils/sequence.util.js';
import { nameShort } from '../utils/nameShort.util.js';
import { triggerTicketCascadeOnClose } from '../utils/ticketCascade.util.js';
import { validateSignaturePng } from '../utils/validateSignaturePng.util.js';
import { pushCorreoUsado } from '../utils/customerCorreosUsados.util.js';
import { sheetWorkSignTokenService } from './sheetWorkSignToken.service.js';
import { sheetWorkDownloadTokenService } from './sheetWorkDownloadToken.service.js';
import { firebaseStorageService } from './external/firebase.service.js';
import SheetWorkPDFService from './sheetworkPDF.service.js';
import { emailService } from './external/email.service.js';
import { env } from '../config/env.js';
import { notificationService } from './notification.service.js';
import { buildSheetSignedPayload } from './notifications/sheetSignedPayload.util.js';
import { assertUserCanWork } from '../utils/otResponsibility.util.js';
export class SheetWorkService {

  async create(data, tenantId, user) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;

      // Responsibility guard (ot-responsables-programacion-trazable, design
      // D3/D7) — creating a sheet is "trabajar" on the OT's reports.
      const guardOtId = data.otId || data.ot || data.orden || data.ordenId;
      if (guardOtId) {
        const parentOt = await OT.findOne(applyTenantFilter({ _id: guardOtId }, t)).lean();
        if (parentOt) assertUserCanWork(user, parentOt);
      }

      // Map frontend field names to model fields
      if (data.recibidoPor && !data.personaRecibe) data.personaRecibe = data.recibidoPor;
      if (data.cargoRecibido && !data.cargoRecibe) data.cargoRecibe = data.cargoRecibido;
      if (data.firmaRecepcion && !data.firmaFile) data.firmaFile = data.firmaRecepcion;
      if (data.fullNameResponsable && !data.fullNameResponsable) data.fullNameResponsable = data.fullNameResponsable;
      if (data.cargoResponsable && !data.cargoResponsable) data.cargoResponsable = data.cargoResponsable;
      if (data.firmaResponsableFile && !data.firmaResponsableFile) data.firmaResponsableFile = data.firmaResponsableFile;

      // Auto-generate numeroHoja if not provided
      if (!data.numeroHoja) {
        try {
          // If OT provided, build numeroHoja as <OT.Consecutivo>-<n>
          const otId = data.otId || data.ot || data.orden || data.ordenId || data.otId;
          if (otId) {
            try {
              const ot = await OT.findOne(applyTenantFilter({ _id: otId }, t)).select('Consecutivo').lean();
              if (ot && ot.Consecutivo) {
                const sheetCount = await SheetWork.countDocuments(applyTenantFilter({ otId: otId, isDeleted: false }, t));
                const nextNumber = sheetCount + 1;
                data.numeroHoja = `${ot.Consecutivo}-${nextNumber}`;
              } else {
                // fallback to global sequence
                const nextSeq = await getNextSequence(t, 'SHEET');
                data.numeroHoja = formatConsecutivo('H', nextSeq, 4);
              }
            } catch (innerErr) {
              logger.debug && logger.debug('Error generating numeroHoja from OT, fallback to sequence', { err: String(innerErr) });
              const nextSeq = await getNextSequence(t, 'SHEET');
              data.numeroHoja = formatConsecutivo('H', nextSeq, 4);
            }
          } else {
            const nextSeq = await getNextSequence(t, 'SHEET');
            data.numeroHoja = formatConsecutivo('H', nextSeq, 4);
          }
        } catch (seqErr) {
          logger.debug && logger.debug('Could not generate numeroHoja sequence', { err: String(seqErr) });
        }
      }

      // si firmaFile existe entonces el estado de la hoja de trabajo es "Firmada", de lo contrario "Borrador"
      if (data.firmaFile) {
        data.estado = 'Firmada';
      } else {
        data.estado = 'Borrador';
      }

      // Trazabilidad del firmante técnico (report-processor-and-signer-
      // traceability). En este endpoint el HT nace ya firmada (tab "Firma
      // en Sitio" del modal Crear HT): el frontend pasa `responsable`
      // (userId), `fullNameResponsable` y `firmaResponsableFile` del user
      // seleccionado como firmante. Congelamos snapshot para trazabilidad.
      if (data.firmaFile && data.responsable && !data.firmadoPor) {
        try {
          const firmanteUser = await User.findOne({ _id: data.responsable, tenantId: t, isDeleted: false })
            .select('firstName lastName email')
            .lean();
          if (firmanteUser) {
            data.firmadoPor = {
              userId: firmanteUser._id,
              snapshotName: nameShort(firmanteUser) || (data.fullNameResponsable || 'Usuario'),
              firmadoAt: new Date(),
            };
          }
        } catch (err) {
          logger.warn('sheetwork.create: firmadoPor lookup failed (non-fatal)', { err: String(err) });
        }
      }

      const entity = await SheetWork.create(data);

      // despues de crear la hoja de trabajo, marcar los reportes listados como cerrados y vincular hojaDeTrabajo
      const updatedReports = [];
      if (Array.isArray(data.reports) && data.reports.length) {
        const fechaFin = data.fechaCreacion ? new Date(data.fechaCreacion) : new Date();
        for (const rId of data.reports) {
          try {
            const updated = await Report.findOneAndUpdate(
              applyTenantFilter({ _id: rId }, t),
              { $set: { 
                estado: 'Cerrado', 
                fechaFinalizdo: fechaFin, 
                hojaDeTrabajo: entity._id 
              } },
              { new: true }
            );
            if (updated) updatedReports.push(updated);
          } catch (e) {
            logger.warn('No se pudo actualizar report ' + rId + ': ' + e.message);
          }
        }
      }

      // Attach updated report ids to sheetWork.reports if any
      if (updatedReports.length) {
        entity.reports = updatedReports.map((r) => r._id);
        await entity.save();
      } else if (Array.isArray(data.reports) && data.reports.length) {
        // if client provided reports array, attach those ids
        entity.reports = data.reports;
        await entity.save();
      }

      // Update OT progress/state if otId provided
      try {
        const otId = data.otId || data.ot || entity.otId;
        if (otId) {
          const total = await Report.countDocuments(applyTenantFilter({ orden: otId, isDeleted: false }, t));
          const closed = await Report.countDocuments(applyTenantFilter({ orden: otId, isDeleted: false, estado: 'Cerrado' }, t));
          const avance = total > 0 ? Math.round((closed / total) * 100) : 0;
          let nuevoEstado = 'Pendiente';
          if (closed === total && total > 0) nuevoEstado = 'Cerrado';
          else if (closed > 0) nuevoEstado = 'En Progreso';
          await OT.findOneAndUpdate(applyTenantFilter({ _id: otId }, t), { $set: { Avance: avance, EstadoOt: nuevoEstado } });
        }
      } catch (e) {
        logger.warn('No se pudo actualizar OT tras crear hoja de trabajo: ' + e.message);
      }

      logger.info('SheetWork creado: ' + entity._id);
      return { sheetWork: entity, reports: updatedReports };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error creando sheetWork:', err);
      throw new ApiError(500, 'Error creando SheetWork', 'CREATE_ERROR');
    }
  }

  async list(filters = {}, pagination = {}, tenantId) {
    try {
      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc', search } = pagination;
      const skip = (page - 1) * limit;
      const query = applyTenantFilter({ ...filters, isDeleted: false }, tenantId);
      
      // Búsqueda en campos relevantes de SheetWork
      if (search) {
        const rx = new RegExp(search, 'i');
        query.$or = [
          { numeroHoja: rx },
          { personaRecibe: rx },
          { fullNameResponsable: rx },
          { cargoResponsable: rx },
          { observaciones: rx }
        ];
      }
      
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };

      // hojas de trabajo populadas
      const [data, total] = await Promise.all([
        SheetWork.find(query).sort(sort).skip(skip).limit(limit).lean()
        .populate('reports')
        .populate('clienteId'),
        SheetWork.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando sheetWorks:', err);
      throw new ApiError(500, 'Error listando SheetWorks', 'LIST_ERROR');
    }
  }

  async listByOt(otId, pagination = {}, tenantId) {
    try {
      const { page = 1, limit = 10, sortBy = 'createdAt', order = 'desc', search } = pagination;
      const skip = (page - 1) * limit;
      const query = applyTenantFilter({ otId: otId, isDeleted: false }, tenantId);
      if (search) {
        const rx = new RegExp(search, 'i');
        query.$or = [{ numeroHoja: rx }, { personaRecibe: rx }];
      }
      const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
      const [data, total] = await Promise.all([
        SheetWork.find(query)
        .populate('reports')
        .populate('clienteId')
        .sort(sort).skip(skip).limit(limit).lean(),
        SheetWork.countDocuments(query),
      ]);
      return {
        data,
        pagination: {
          page, limit, total, pages: Math.ceil(total / limit), hasNext: page < Math.ceil(total / limit), hasPrev: page > 1
        }
      };
    } catch (err) {
      logger.error('Error listando sheetWorks por OT:', err);
      throw new ApiError(500, 'Error listando SheetWorks por OT', 'LIST_ERROR');
    }
  }

  async getById(id, tenantId) {
    try {
      const e = await SheetWork.findOne(applyTenantFilter({ _id: id }, tenantId));
      if (!e) throw new ApiError(404, 'SheetWork no encontrado', 'NOT_FOUND', { id });
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error obteniendo sheetWork:', err);
      throw new ApiError(500, 'Error obteniendo SheetWork', 'GET_ERROR');
    }
  }

  async update(id, data, tenantId, user) {
    try {
      // Responsibility guard (design D3/D7) — load the existing sheet
      // (tenant-scoped) to find its parent OT before applying the update.
      const t = tenantId || data?.tenantId;
      const existing = t
        ? await SheetWork.findOne(applyTenantFilter({ _id: id }, t)).lean()
        : await SheetWork.findById(id).lean();
      if (!existing) throw new ApiError(404, 'SheetWork no encontrado', 'NOT_FOUND', { id });
      if (existing.otId) {
        const parentOt = await OT.findOne(applyTenantFilter({ _id: existing.otId }, t || existing.tenantId)).lean();
        if (parentOt) assertUserCanWork(user, parentOt);
      }

      const e = await SheetWork.findOneAndUpdate(
        t ? applyTenantFilter({ _id: id }, t) : { _id: id },
        { $set: data },
        { new: true, runValidators: true },
      );
      if (!e) throw new ApiError(404, 'SheetWork no encontrado', 'NOT_FOUND', { id });
      logger.info('SheetWork actualizado: ' + id);
      return e;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error actualizando sheetWork:', err);
      throw new ApiError(500, 'Error actualizando SheetWork', 'UPDATE_ERROR');
    }
  }

  /**
   * Admin retro-mitigation (design D6, sheet-report-closure spec): closes
   * every `Procesado` report linked to this specific sheet
   * (`hojaDeTrabajo === sheetId`), recomputes the parent OT's
   * `Avance`/`EstadoOt`, and dispatches the ticket-closure cascade. Scoped
   * narrowly to the sheet's own reports — never touches reports of another
   * sheet or reports in a different estado (e.g. `Cancelado`).
   *
   * @param {string} sheetId
   * @param {string} tenantId
   * @returns {Promise<{ modifiedCount: number }>}
   */
  async closeReports(sheetId, tenantId, user) {
    try {
      requireTenant(tenantId);

      const sheet = await SheetWork.findOne(applyTenantFilter({ _id: sheetId, isDeleted: false }, tenantId)).lean();
      if (!sheet) {
        throw new ApiError(404, 'Hoja de trabajo no encontrada', 'SHEET_NOT_FOUND', { id: sheetId });
      }

      // Responsibility guard (design D3/D7) — before mutating any report.
      if (sheet.otId) {
        const parentOt = await OT.findOne(applyTenantFilter({ _id: sheet.otId }, tenantId)).lean();
        if (parentOt) assertUserCanWork(user, parentOt);
      }

      const now = new Date();
      const result = await Report.updateMany(
        applyTenantFilter({ hojaDeTrabajo: sheetId, isDeleted: false, estado: 'Procesado' }, tenantId),
        [
          {
            $set: {
              estado: 'Cerrado',
              fechaFinalizdo: { $ifNull: ['$fechaFinalizdo', now] },
            },
          },
        ]
      );

      // Recompute Avance/EstadoOt for the sheet's OT — same pattern as
      // create() above / clientPortal.service.js#signAndCreateSheets.
      const otId = sheet.otId;
      if (otId) {
        try {
          const total = await Report.countDocuments(applyTenantFilter({ orden: otId, isDeleted: false }, tenantId));
          const closed = await Report.countDocuments(
            applyTenantFilter({ orden: otId, isDeleted: false, estado: 'Cerrado' }, tenantId)
          );
          const avance = total > 0 ? Math.round((closed / total) * 100) : 0;
          let nuevoEstado = 'Pendiente';
          if (closed === total && total > 0) nuevoEstado = 'Cerrado';
          else if (closed > 0) nuevoEstado = 'En Progreso';
          await OT.findOneAndUpdate(applyTenantFilter({ _id: otId }, tenantId), {
            $set: { Avance: avance, EstadoOt: nuevoEstado },
          });
        } catch (otErr) {
          logger.warn('closeReports: OT progress recompute failed (non-fatal)', { sheetId, err: String(otErr) });
        }
      }

      // Ticket cascade for the reports this call actually closed.
      try {
        const closedReports = await Report.find(
          applyTenantFilter({ hojaDeTrabajo: sheetId, isDeleted: false, estado: 'Cerrado' }, tenantId)
        )
          .select('_id')
          .lean();
        await triggerTicketCascadeOnClose(closedReports.map((r) => r._id), tenantId);
      } catch (cascadeErr) {
        logger.warn('closeReports: ticket cascade failed (non-fatal)', { sheetId, err: String(cascadeErr) });
      }

      logger.info('SheetWork closeReports: reports closed', {
        sheetId,
        tenantId,
        modifiedCount: result.modifiedCount,
      });
      return { modifiedCount: result.modifiedCount };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error closing reports for sheetWork:', err);
      throw new ApiError(500, 'Error cerrando reportes de la hoja de trabajo', 'CLOSE_REPORTS_ERROR');
    }
  }

  async delete(id) {
    try {
      const e = await SheetWork.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date() } }, { new: true });
      if (!e) throw new ApiError(404, 'SheetWork no encontrado', 'NOT_FOUND', { id });
      logger.info('SheetWork eliminado (soft): ' + id);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Error eliminando sheetWork:', err);
      throw new ApiError(500, 'Error eliminando SheetWork', 'DELETE_ERROR');
    }
  }

  /**
   * Generates the sheet's numeroHoja using the OT's Consecutivo when
   * available, falling back to the global SHEET sequence. Extracted from
   * create() so remoteSignRequest() can reuse it without going through the
   * full create path (which side-effects reports).
   */
  async _resolveNumeroHoja(otId, tenantId) {
    try {
      if (otId) {
        const ot = await OT.findOne(applyTenantFilter({ _id: otId }, tenantId))
          .select('Consecutivo')
          .lean();
        if (ot && ot.Consecutivo) {
          const sheetCount = await SheetWork.countDocuments(
            applyTenantFilter({ otId, isDeleted: false }, tenantId)
          );
          return `${ot.Consecutivo}-${sheetCount + 1}`;
        }
      }
      const nextSeq = await getNextSequence(tenantId, 'SHEET');
      return formatConsecutivo('H', nextSeq, 4);
    } catch {
      const nextSeq = await getNextSequence(tenantId, 'SHEET');
      return formatConsecutivo('H', nextSeq, 4);
    }
  }

  /**
   * Thin forwarder kept for backward compatibility. Delegates to the shared
   * `pushCorreoUsado` util so both this service and `clientAccessTokenService`
   * run the exact same `$addToSet` + soft-cap logic.
   */
  async _pushCorreoUsado(customerId, tenantId, email) {
    return pushCorreoUsado(customerId, tenantId, email);
  }

  /**
   * Shared closure side-effects for any sheet that transitions to Firmada
   * (in-place fallback + public sign). Marks reports Cerrado, recomputes
   * OT progress, dispatches ticket cascade, kicks off PDF regeneration.
   */
  /**
   * @param {string} [signedVia] - 'in-place' | 'remote-sign'. Shared by
   *   `signInPlace` and `publicSheetSign.service.js#signWithToken` — the
   *   only two callers, each responsible for its own `signedVia`. Omitted
   *   (falsy) means no `sheet.signed` event is dispatched (defensive, in
   *   case a future caller doesn't pass one).
   */
  async _finalizeSignedSheet(sheet, tenantId, signedVia = null) {
    const sheetId = sheet._id;
    const otId = sheet.otId;
    let reportIds = Array.isArray(sheet.reports) ? sheet.reports : [];

    // Defensive fallback: some historic HTs (or edge cases in the remote-sign
    // pending flow) can end up with sheet.reports empty at signing time.
    // If empty, look reports up via their back-reference (`hojaDeTrabajo`)
    // so the closure side-effects still fire.
    if (reportIds.length === 0) {
      const linked = await Report.find(
        applyTenantFilter({ hojaDeTrabajo: sheetId, isDeleted: false }, tenantId)
      ).select('_id').lean();
      if (linked.length > 0) {
        reportIds = linked.map((r) => r._id);
        logger.info('_finalizeSignedSheet: reports resolved via hojaDeTrabajo back-ref', {
          sheetId: String(sheetId),
          count: reportIds.length,
        });
      }
    }

    if (reportIds.length) {
      const signedAt = new Date();
      await Report.updateMany(
        { _id: { $in: reportIds }, tenantId },
        [
          {
            $set: {
              estado: 'Cerrado',
              fechaFinalizdo: { $ifNull: ['$fechaFinalizdo', signedAt] },
              hojaDeTrabajo: sheetId,
            },
          },
        ]
      ).catch((err) =>
        logger.warn('_finalizeSignedSheet: report close failed', { sheetId: String(sheetId), err: String(err) })
      );
    }

    if (otId) {
      try {
        const [total, closed] = await Promise.all([
          Report.countDocuments(applyTenantFilter({ orden: otId, isDeleted: false }, tenantId)),
          Report.countDocuments(applyTenantFilter({ orden: otId, isDeleted: false, estado: 'Cerrado' }, tenantId)),
        ]);
        const avance = total > 0 ? Math.round((closed / total) * 100) : 0;
        let nuevoEstado = 'Pendiente';
        if (closed === total && total > 0) nuevoEstado = 'Cerrado';
        else if (closed > 0) nuevoEstado = 'En Progreso';
        await OT.findOneAndUpdate(applyTenantFilter({ _id: otId }, tenantId), {
          $set: { Avance: avance, EstadoOt: nuevoEstado },
        });
      } catch (err) {
        logger.warn('_finalizeSignedSheet: OT recompute failed', { sheetId: String(sheetId), err: String(err) });
      }
    }

    try {
      await triggerTicketCascadeOnClose(reportIds, tenantId);
    } catch (err) {
      logger.warn('_finalizeSignedSheet: ticket cascade failed', { sheetId: String(sheetId), err: String(err) });
    }

    // `sheet.signed` (notify-on-sheet-signed) — after the signature is
    // durably persisted (callers already saved/updated the sheet before
    // invoking this method). One extra lookup for OT.Consecutivo /
    // Customer.Razonsocial since neither is loaded by the two callers.
    // Swallowed on failure (design D2) — a bus bug must never surface here.
    if (signedVia) {
      try {
        const [otDoc, customerDoc] = await Promise.all([
          otId ? OT.findOne(applyTenantFilter({ _id: otId }, tenantId)).select('Consecutivo').lean() : null,
          sheet.clienteId
            ? Customer.findOne(applyTenantFilter({ _id: sheet.clienteId }, tenantId)).select('Razonsocial').lean()
            : null,
        ]);
        await notificationService.emit(
          tenantId,
          'sheet.signed',
          buildSheetSignedPayload({
            sheetId,
            sheetNumero: sheet.numeroHoja,
            otId,
            otConsecutivo: otDoc?.Consecutivo,
            customerName: customerDoc?.Razonsocial,
            signedVia,
          })
        );
      } catch (emitErr) {
        logger.error('_finalizeSignedSheet: sheet.signed emit failed', {
          sheetId: String(sheetId),
          signedVia,
          err: String(emitErr),
        });
      }
    }

    setImmediate(() => {
      const pdfService = new SheetWorkPDFService();
      pdfService
        .generatePDF(String(sheetId), tenantId)
        .then(async (pdfBuffer) => {
          const { url } = await firebaseStorageService.uploadPdf(
            pdfBuffer,
            `HT-${sheet.numeroHoja || sheetId}.pdf`,
            'sheetwork/pdfs'
          );
          await SheetWork.updateOne(
            { _id: sheetId },
            { $set: { PdfHojaTrabajo: url, PdfGenerado: true, pdfStatus: 'ready' } }
          );
        })
        .catch(async (err) => {
          logger.warn('_finalizeSignedSheet: PDF regen failed', { sheetId: String(sheetId), err: String(err) });
          await SheetWork.updateOne(
            { _id: sheetId },
            { $set: { pdfStatus: 'error', pdfGenerationError: String(err.message || err) } }
          ).catch(() => {});
        });
    });
  }

  /**
   * Creates a sheet in `EnviadaAFirmar`, issues a sign token, records the
   * recipient email on the sheet + customer, and dispatches the request
   * email fire-and-forget.
   */
  async remoteSignRequest({ otId, reportIds, email, message, firmanteUserId }, tenantId, userId) {
    requireTenant(tenantId);
    const normEmail = String(email || '').toLowerCase().trim();

    const ot = await OT.findOne(applyTenantFilter({ _id: otId, isDeleted: false }, tenantId)).lean();
    if (!ot) throw new ApiError(404, 'OT no encontrada', 'OT_NOT_FOUND');
    const clienteId = ot.ClienteId;

    // Firmante técnico — puede ser distinto al user que tramita la firma.
    // Default = user en sesión. Debe pertenecer al tenant y tener fileFirma
    // (se pinta en el PDF preview que ve el cliente y en el PDF firmado).
    const firmanteId = firmanteUserId ? String(firmanteUserId) : String(userId);
    const firmante = firmanteId
      ? await User.findOne({ _id: firmanteId, tenantId, isDeleted: false })
          .select('firstName lastName fullName email role fileFirma')
          .lean()
      : null;
    if (!firmante) {
      throw new ApiError(400, 'Firmante inválido: no pertenece al tenant', 'INVALID_FIRMANTE');
    }
    if (!firmante.fileFirma) {
      throw new ApiError(
        409,
        firmanteUserId
          ? 'El firmante seleccionado no tiene firma cargada en su perfil.'
          : 'Tu perfil no tiene firma cargada. Súbela en tu perfil antes de solicitar firmas remotas.',
        firmanteUserId ? 'FIRMANTE_SIN_FIRMA' : 'USER_HAS_NO_SIGNATURE'
      );
    }

    const validReportIds = Array.isArray(reportIds) ? reportIds : [];

    const numeroHoja = await this._resolveNumeroHoja(otId, tenantId);

    const now = new Date();
    const firmanteFullName = firmante.fullName || [firmante.firstName, firmante.lastName].filter(Boolean).join(' ') || firmante.email;
    const sheet = await SheetWork.create({
      tenantId,
      clienteId,
      otId,
      numeroHoja,
      estado: 'EnviadaAFirmar',
      responsable: firmante._id,
      firmaResponsableFile: firmante.fileFirma,
      fullNameResponsable: firmanteFullName,
      cargoResponsable: firmante.role || '',
      // Snapshot at request time. `firmadoAt` fills in later when the
      // client actually signs (see publicSheetSign.service.signWithToken).
      firmadoPor: {
        userId: firmante._id,
        snapshotName: nameShort(firmante) || 'Usuario',
        firmadoAt: null,
      },
      reports: validReportIds,
      source: 'field',
      pdfStatus: 'pending',
      remoteSignRequest: {
        email: normEmail,
        requestedBy: userId,
        requestedAt: now,
        message: message || null,
        resendCount: 0,
      },
    });

    let tokenDoc;
    try {
      tokenDoc = await sheetWorkSignTokenService.createForSheet({
        tenantId,
        sheetId: sheet._id,
        otId,
        clienteId,
        email: normEmail,
        requestedBy: userId,
        message,
      });
    } catch (err) {
      await SheetWork.deleteOne({ _id: sheet._id }).catch(() => {});
      throw err;
    }

    await SheetWork.updateOne(
      { _id: sheet._id },
      { $set: { 'remoteSignRequest.tokenId': tokenDoc._id } }
    );

    await this._pushCorreoUsado(clienteId, tenantId, normEmail);

    let emailSent = false;
    if (env.NOTIFICATIONS_ENABLED) {
      try {
        const signUrl = `${env.PUBLIC_APP_URL}/firma/${tokenDoc.token}`;
        const result = await emailService.sendSheetSignRequestEmail({
          to: normEmail,
          otConsecutivo: ot.Consecutivo,
          sheetNumero: numeroHoja,
          requesterName: requester.fullName || 'TIMTTO',
          message: message || null,
          signUrl,
          expiresAt: tokenDoc.expiresAt,
        });
        emailSent = Boolean(result?.sent);
      } catch (err) {
        logger.warn('remoteSignRequest: email dispatch failed', {
          sheetId: String(sheet._id),
          err: String(err),
        });
      }
    }

    logger.info('remoteSignRequest: sheet created', {
      sheetId: String(sheet._id),
      tokenId: String(tokenDoc._id),
      tenantId,
      emailSent,
    });

    return {
      sheetId: String(sheet._id),
      tokenId: String(tokenDoc._id),
      expiresAt: tokenDoc.expiresAt,
      emailSent,
      numeroHoja,
    };
  }

  /**
   * Reuses the active token when unexpired, otherwise upserts a new one on
   * the same sheet. Updates email on both sheet and customer, increments
   * resendCount, redispatches the email.
   */
  async resendSignRequest(sheetId, { email, message }, tenantId, userId) {
    requireTenant(tenantId);
    const normEmail = String(email || '').toLowerCase().trim();

    const sheet = await SheetWork.findOne(applyTenantFilter({ _id: sheetId, isDeleted: false }, tenantId));
    if (!sheet) throw new ApiError(404, 'Hoja de trabajo no encontrada', 'SHEET_NOT_FOUND');
    if (sheet.estado === 'Firmada') {
      throw new ApiError(409, 'Esta hoja ya fue firmada', 'SHEET_ALREADY_SIGNED');
    }

    const ot = await OT.findOne(applyTenantFilter({ _id: sheet.otId }, tenantId))
      .select('Consecutivo ClienteId')
      .lean();

    let tokenDoc = null;
    const { SheetWorkSignToken } = await import('../models/sheetWorkSignToken.model.js');
    const existing = await SheetWorkSignToken.findOne({ sheetId: sheet._id });
    const now = new Date();
    const stillValid =
      existing && existing.status === 'active' && existing.expiresAt.getTime() > now.getTime();

    if (stillValid) {
      tokenDoc = existing;
      if (normEmail && existing.email !== normEmail) {
        await sheetWorkSignTokenService.updateEmail(existing._id, normEmail);
        tokenDoc.email = normEmail;
      }
      if (typeof message !== 'undefined') {
        await SheetWorkSignToken.updateOne({ _id: existing._id }, { $set: { message: message || null } });
      }
      await sheetWorkSignTokenService.incrementResendCount(existing._id);
    } else {
      tokenDoc = await sheetWorkSignTokenService.createForSheet({
        tenantId,
        sheetId: sheet._id,
        otId: sheet.otId,
        clienteId: sheet.clienteId || ot?.ClienteId,
        email: normEmail,
        requestedBy: userId,
        message,
      });
    }

    await SheetWork.updateOne(
      { _id: sheet._id },
      {
        $set: {
          'remoteSignRequest.tokenId': tokenDoc._id,
          'remoteSignRequest.email': normEmail,
          'remoteSignRequest.message': message || null,
          estado: 'EnviadaAFirmar',
        },
        $inc: { 'remoteSignRequest.resendCount': 1 },
      }
    );

    await this._pushCorreoUsado(sheet.clienteId || ot?.ClienteId, tenantId, normEmail);

    let emailSent = false;
    if (env.NOTIFICATIONS_ENABLED) {
      try {
        const requester = userId
          ? await User.findById(userId).select('fullName').lean()
          : null;
        const signUrl = `${env.PUBLIC_APP_URL}/firma/${tokenDoc.token}`;
        const result = await emailService.sendSheetSignRequestEmail({
          to: normEmail,
          otConsecutivo: ot?.Consecutivo,
          sheetNumero: sheet.numeroHoja,
          requesterName: requester?.fullName || 'TIMTTO',
          message: message || null,
          signUrl,
          expiresAt: tokenDoc.expiresAt,
        });
        emailSent = Boolean(result?.sent);
      } catch (err) {
        logger.warn('resendSignRequest: email failed', { sheetId: String(sheet._id), err: String(err) });
      }
    }

    return {
      sheetId: String(sheet._id),
      tokenId: String(tokenDoc._id),
      expiresAt: tokenDoc.expiresAt,
      email: normEmail,
      emailSent,
    };
  }

  /**
   * Admin fallback for a sheet already in EnviadaAFirmar — closes it
   * on-site and marks the outstanding remote token as superseded.
   */
  async signInPlace(sheetId, body, tenantId, userId) {
    requireTenant(tenantId);

    const sheet = await SheetWork.findOne(applyTenantFilter({ _id: sheetId, isDeleted: false }, tenantId));
    if (!sheet) throw new ApiError(404, 'Hoja de trabajo no encontrada', 'SHEET_NOT_FOUND');
    if (sheet.estado === 'Firmada') {
      throw new ApiError(409, 'Esta hoja ya fue firmada', 'SHEET_ALREADY_SIGNED');
    }

    // Responsibility guard (design D3/D7) — signing in-place is "trabajar".
    if (sheet.otId) {
      const parentOt = await OT.findOne(applyTenantFilter({ _id: sheet.otId }, tenantId)).lean();
      if (parentOt) assertUserCanWork({ userId }, parentOt);
    }

    // Firmante técnico — puede ser distinto al user que tramita (para
    // trazabilidad cuando varios técnicos trabajan bajo un mismo usuario).
    // Default = user en sesión. Debe pertenecer al tenant y tener fileFirma.
    const firmanteUserId = body?.firmanteUserId ? String(body.firmanteUserId) : String(userId);
    const firmanteUser = await User.findOne({ _id: firmanteUserId, tenantId, isDeleted: false }).lean();
    if (!firmanteUser) {
      throw new ApiError(400, 'Firmante inválido: no pertenece al tenant', 'INVALID_FIRMANTE');
    }
    if (!firmanteUser.fileFirma) {
      throw new ApiError(400, 'El firmante seleccionado no tiene firma registrada en su perfil', 'FIRMANTE_SIN_FIRMA');
    }

    const signature = body?.signature;
    if (!signature?.imagePng) {
      throw new ApiError(400, 'La firma es requerida', 'SIGNATURE_REQUIRED');
    }
    const pngValidation = await validateSignaturePng(signature.imagePng);
    if (!pngValidation.ok) {
      throw new ApiError(
        400,
        'La firma parece estar en blanco. Vuelve a firmar o carga una imagen válida.',
        'INVALID_SIGNATURE_IMAGE'
      );
    }

    const signatureBuffer = Buffer.from(signature.imagePng, 'base64');
    const { url: firmaFileUrl } = await firebaseStorageService.uploadEvidencia(
      signatureBuffer,
      `firma-${sheetId}-inplace.png`,
      'image/png',
      'sheetwork/firmas'
    );

    const signedAt = new Date();
    sheet.firmaFile = firmaFileUrl;
    sheet.personaRecibe = body.personaRecibe || signature.signerName || sheet.personaRecibe;
    sheet.cargoRecibe = body.cargoRecibe || signature.cargo || sheet.cargoRecibe || '';
    if (body.observaciones || signature.observaciones) {
      sheet.observaciones = body.observaciones || signature.observaciones;
    }
    sheet.estado = 'Firmada';
    sheet.pdfStatus = 'pending';
    // Firmante snapshot: nombre + firma vienen del user seleccionado
    // (no del user en sesión), para trazabilidad multi-técnico.
    sheet.responsable = firmanteUser._id;
    sheet.fullNameResponsable = [firmanteUser.firstName, firmanteUser.lastName].filter(Boolean).join(' ') || firmanteUser.email;
    sheet.firmaResponsableFile = firmanteUser.fileFirma;
    sheet.firmadoPor = {
      userId: firmanteUser._id,
      snapshotName: nameShort(firmanteUser) || 'Usuario',
      firmadoAt: signedAt,
    };
    await sheet.save();

    await sheetWorkSignTokenService.markSuperseded(sheet._id, userId);

    await this._finalizeSignedSheet(sheet.toObject(), tenantId, 'in-place');

    logger.info('signInPlace: sheet signed', { sheetId: String(sheet._id), tenantId });
    return { sheetId: String(sheet._id), estado: 'Firmada', pdfStatus: 'pending' };
  }

  /**
   * Issues (or reissues) a one-off download token for a signed HT and sends
   * the download link by email. Sheet must be `Firmada` — 409 otherwise.
   * Counters reset on every reissue.
   */
  async shareSignedSheet(sheetId, { email, allowReports }, tenantId, userId) {
    requireTenant(tenantId);
    const normEmail = String(email || '').toLowerCase().trim();

    const sheet = await SheetWork.findOne(applyTenantFilter({ _id: sheetId, isDeleted: false }, tenantId));
    if (!sheet) throw new ApiError(404, 'Hoja de trabajo no encontrada', 'SHEET_NOT_FOUND');
    if (sheet.estado !== 'Firmada' || !sheet.firmaFile) {
      throw new ApiError(409, 'La hoja aún no está firmada', 'SHEET_NOT_SIGNED');
    }

    const tokenDoc = await sheetWorkDownloadTokenService.createForSheet({
      tenantId,
      sheetId: sheet._id,
      otId: sheet.otId,
      clienteId: sheet.clienteId,
      email: normEmail,
      issuedBy: userId,
      allowReports: Boolean(allowReports),
    });

    const now = new Date();
    await SheetWork.updateOne(
      { _id: sheet._id },
      {
        $set: {
          'shareHistory.lastEmail': normEmail,
          'shareHistory.lastSentAt': now,
          'shareHistory.lastSentBy': userId || null,
        },
        $inc: { 'shareHistory.sendCount': 1 },
      }
    );

    await pushCorreoUsado(sheet.clienteId, tenantId, normEmail);

    let emailSent = false;
    if (env.NOTIFICATIONS_ENABLED) {
      try {
        const [ot, tenant] = await Promise.all([
          OT.findById(sheet.otId).select('Consecutivo').lean(),
          Tenant.findOne({ tenantId }).select('name').lean(),
        ]);
        const baseUrl = (env.PUBLIC_APP_URL || '').replace(/\/+$/, '');
        const downloadUrl = `${baseUrl}/hoja-descarga/${tokenDoc.token}`;
        const result = await emailService.sendSheetShareDownloadEmail({
          to: normEmail,
          sheetNumero: sheet.numeroHoja,
          otConsecutivo: ot?.Consecutivo || null,
          tenantName: tenant?.name || 'TIMTTO',
          downloadUrl,
          expiresAt: tokenDoc.expiresAt,
          downloadsAllowed: tokenDoc.downloadsAllowed,
          allowReports: tokenDoc.allowReports,
          reportDownloadsAllowed: tokenDoc.reportDownloadsAllowed,
        });
        emailSent = Boolean(result?.sent);
      } catch (err) {
        logger.warn('shareSignedSheet: email dispatch failed', {
          sheetId: String(sheet._id),
          err: String(err),
        });
      }
    }

    logger.info('shareSignedSheet: token issued', {
      sheetId: String(sheet._id),
      tokenId: String(tokenDoc._id),
      tenantId,
      allowReports: tokenDoc.allowReports,
      emailSent,
    });

    return {
      sheetId: String(sheet._id),
      token: tokenDoc.token,
      expiresAt: tokenDoc.expiresAt,
      downloadsAllowed: tokenDoc.downloadsAllowed,
      allowReports: tokenDoc.allowReports,
      reportDownloadsAllowed: tokenDoc.reportDownloadsAllowed,
      emailSent,
    };
  }
}

export const sheetWorkService = new SheetWorkService();
