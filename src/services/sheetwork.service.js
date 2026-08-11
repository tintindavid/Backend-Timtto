import { SheetWork } from '../models/sheetwork.model.js';
import { Report } from '../models/report.model.js';
import { OT } from '../models/ot.model.js';
import { Customer } from '../models/customer.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter, requireTenant } from '../utils/tenant.util.js';
import { getNextSequence, formatConsecutivo } from '../utils/sequence.util.js';
import { triggerTicketCascadeOnClose } from '../utils/ticketCascade.util.js';
import { validateSignaturePng } from '../utils/validateSignaturePng.util.js';
import { pushCorreoUsado } from '../utils/customerCorreosUsados.util.js';
import { sheetWorkSignTokenService } from './sheetWorkSignToken.service.js';
import { firebaseStorageService } from './external/firebase.service.js';
import SheetWorkPDFService from './sheetworkPDF.service.js';
import { emailService } from './external/email.service.js';
import { env } from '../config/env.js';
export class SheetWorkService {

  async create(data, tenantId) {
    try {
      const t = tenantId || data.tenantId;
      requireTenant(t);
      data.tenantId = t;

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

  async update(id, data) {
    try {
      const e = await SheetWork.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
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
  async closeReports(sheetId, tenantId) {
    try {
      requireTenant(tenantId);

      const sheet = await SheetWork.findOne(applyTenantFilter({ _id: sheetId, isDeleted: false }, tenantId)).lean();
      if (!sheet) {
        throw new ApiError(404, 'Hoja de trabajo no encontrada', 'SHEET_NOT_FOUND', { id: sheetId });
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
  async _finalizeSignedSheet(sheet, tenantId) {
    const sheetId = sheet._id;
    const otId = sheet.otId;
    const reportIds = Array.isArray(sheet.reports) ? sheet.reports : [];

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
  async remoteSignRequest({ otId, reportIds, email, message }, tenantId, userId) {
    requireTenant(tenantId);
    const normEmail = String(email || '').toLowerCase().trim();

    const ot = await OT.findOne(applyTenantFilter({ _id: otId, isDeleted: false }, tenantId)).lean();
    if (!ot) throw new ApiError(404, 'OT no encontrada', 'OT_NOT_FOUND');
    const clienteId = ot.ClienteId;

    // Fail-fast: the requester's User.fileFirma is baked into the sheet at
    // creation time so it renders in the PDF preview the client sees AND in
    // the final signed PDF. Same prerequisite as the on-site flow (which
    // reads currentUserData.fileFirma) and D6 of the portal-signature-flow.
    const requester = userId
      ? await User.findById(userId).select('fullName role fileFirma isDeleted').lean()
      : null;
    if (!requester || requester.isDeleted === true || !requester.fileFirma) {
      throw new ApiError(
        409,
        'Tu perfil no tiene firma cargada. Súbela en tu perfil antes de solicitar firmas remotas.',
        'USER_HAS_NO_SIGNATURE'
      );
    }

    const validReportIds = Array.isArray(reportIds) ? reportIds : [];

    const numeroHoja = await this._resolveNumeroHoja(otId, tenantId);

    const now = new Date();
    const sheet = await SheetWork.create({
      tenantId,
      clienteId,
      otId,
      numeroHoja,
      estado: 'EnviadaAFirmar',
      responsable: userId,
      firmaResponsableFile: requester.fileFirma,
      fullNameResponsable: requester.fullName,
      cargoResponsable: requester.role || '',
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
    await sheet.save();

    await sheetWorkSignTokenService.markSuperseded(sheet._id, userId);

    await this._finalizeSignedSheet(sheet.toObject(), tenantId);

    logger.info('signInPlace: sheet signed', { sheetId: String(sheet._id), tenantId });
    return { sheetId: String(sheet._id), estado: 'Firmada', pdfStatus: 'pending' };
  }
}

export const sheetWorkService = new SheetWorkService();
