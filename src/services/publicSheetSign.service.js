'use strict';
import mongoose from 'mongoose';
import { SheetWork } from '../models/sheetwork.model.js';
import { SheetWorkSignToken } from '../models/sheetWorkSignToken.model.js';
import { Tenant } from '../models/tenant.model.js';
import { Customer } from '../models/customer.model.js';
import { OT } from '../models/ot.model.js';
import { Report } from '../models/report.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/apiError.util.js';
import { logger } from '../config/logger.config.js';
import { applyTenantFilter } from '../utils/tenant.util.js';
import { validateSignaturePng } from '../utils/validateSignaturePng.util.js';
import { firebaseStorageService } from './external/firebase.service.js';
import SheetWorkPDFService from './sheetworkPDF.service.js';
import { sheetWorkSignTokenService } from './sheetWorkSignToken.service.js';
import { sheetWorkService } from './sheetwork.service.js';
import { emailService } from './external/email.service.js';
import { env } from '../config/env.js';

export class PublicSheetSignService {
  constructor() {
    this.pdfService = new SheetWorkPDFService();
  }

  async getForToken(token) {
    const resolved = await sheetWorkSignTokenService.resolveByToken(token);
    if (!resolved) throw new ApiError(404, 'Enlace no encontrado', 'SHEET_SIGN_TOKEN_NOT_FOUND');

    if (resolved.status === 'expired' || resolved.status === 'revoked' || resolved.status === 'superseded') {
      throw new ApiError(410, 'Este enlace ya no está disponible', 'SHEET_SIGN_TOKEN_' + resolved.status.toUpperCase(), {
        status: resolved.status,
      });
    }

    const tokenDoc = resolved.doc;
    const tenantId = tokenDoc.tenantId;

    const sheet = await SheetWork.findOne(applyTenantFilter({ _id: tokenDoc.sheetId, isDeleted: false }, tenantId))
      .populate('clienteId')
      .populate({
        path: 'reports',
        populate: { path: 'Equipo', select: 'ItemText Marca Modelo Serie Servicio Ubicacion' },
      })
      .populate('otId', 'Consecutivo')
      .populate('responsable', 'fullName role fileFirma')
      .lean();
    if (!sheet) throw new ApiError(404, 'Hoja de trabajo no encontrada', 'SHEET_NOT_FOUND');

    const tenant = await Tenant.findOne({ tenantId }).lean();

    const basePayload = {
      status: resolved.status,
      expiresAt: tokenDoc.expiresAt,
      sheet: {
        _id: String(sheet._id),
        numeroHoja: sheet.numeroHoja || null,
        otConsecutivo: sheet.otId?.Consecutivo || null,
        clienteNombre: sheet.clienteId?.Razonsocial || null,
        estado: sheet.estado,
      },
      tenant: {
        name: tenant?.name || null,
        logoUrl: tenant?.logoUrl || null,
      },
    };

    if (resolved.status === 'signed') {
      return {
        ...basePayload,
        pdfStatus: sheet.pdfStatus,
        pdfUrl: sheet.PdfHojaTrabajo || null,
      };
    }

    // active — render the preview HTML using the shared PDF template so the
    // client sees exactly what they'll sign
    const previewHtml = this.pdfService.generateHTML(sheet, tenant || {});
    return { ...basePayload, previewHtml };
  }

  async getPreviewHtmlForToken(token) {
    const resolved = await sheetWorkSignTokenService.resolveByToken(token);
    if (!resolved) throw new ApiError(404, 'Enlace no encontrado', 'SHEET_SIGN_TOKEN_NOT_FOUND');
    if (resolved.status !== 'active') {
      throw new ApiError(410, 'Este enlace ya no está disponible', 'SHEET_SIGN_TOKEN_INACTIVE');
    }
    const tokenDoc = resolved.doc;
    const sheet = await SheetWork.findOne(applyTenantFilter({ _id: tokenDoc.sheetId, isDeleted: false }, tokenDoc.tenantId))
      .populate('clienteId')
      .populate({
        path: 'reports',
        populate: { path: 'Equipo', select: 'ItemText Marca Modelo Serie Servicio Ubicacion' },
      })
      .populate('otId', 'Consecutivo')
      .populate('responsable', 'fullName role fileFirma')
      .lean();
    if (!sheet) throw new ApiError(404, 'Hoja no encontrada', 'SHEET_NOT_FOUND');
    const tenant = await Tenant.findOne({ tenantId: tokenDoc.tenantId }).lean();
    return this.pdfService.generateHTML(sheet, tenant || {});
  }

  async signWithToken(token, body, meta = {}) {
    const resolved = await sheetWorkSignTokenService.resolveByToken(token);
    if (!resolved) throw new ApiError(404, 'Enlace no encontrado', 'SHEET_SIGN_TOKEN_NOT_FOUND');
    if (resolved.status === 'signed') {
      throw new ApiError(409, 'Esta hoja ya fue firmada', 'SHEET_ALREADY_SIGNED');
    }
    if (resolved.status !== 'active') {
      throw new ApiError(410, 'Este enlace ya no está disponible', 'SHEET_SIGN_TOKEN_' + resolved.status.toUpperCase(), {
        status: resolved.status,
      });
    }

    const tokenDoc = resolved.doc;
    const tenantId = tokenDoc.tenantId;
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

    const preSheet = await SheetWork.findOne(
      applyTenantFilter({ _id: tokenDoc.sheetId, isDeleted: false }, tenantId)
    );
    if (!preSheet) throw new ApiError(404, 'Hoja no encontrada', 'SHEET_NOT_FOUND');
    if (preSheet.estado === 'Firmada' || preSheet.firmaFile) {
      throw new ApiError(409, 'Esta hoja ya fue firmada', 'SHEET_ALREADY_SIGNED');
    }

    const signatureBuffer = Buffer.from(signature.imagePng, 'base64');
    const { url: firmaFileUrl } = await firebaseStorageService.uploadEvidencia(
      signatureBuffer,
      `firma-${tokenDoc.sheetId}-remote.png`,
      'image/png',
      'sheetwork/firmas'
    );

    const signedAt = new Date();
    const sheet = await SheetWork.findOneAndUpdate(
      applyTenantFilter({ _id: tokenDoc.sheetId, isDeleted: false, firmaFile: { $in: [null, ''] } }, tenantId),
      {
        $set: {
          firmaFile: firmaFileUrl,
          personaRecibe: signature.signerName,
          cargoRecibe: signature.cargo || '',
          observaciones: signature.observaciones || '',
          estado: 'Firmada',
          pdfStatus: 'pending',
          clientSignature: {
            ip: meta.ip || null,
            userAgent: meta.userAgent || null,
            signedAt,
            tokenId: tokenDoc._id,
          },
        },
      },
      { new: true }
    );
    if (!sheet) {
      throw new ApiError(409, 'Esta hoja ya fue firmada', 'SHEET_ALREADY_SIGNED');
    }

    // Token renewal — extend expiresAt to signedAt + 7d and mark signed
    const renewal = await sheetWorkSignTokenService.renewOnSign(tokenDoc._id, signedAt, meta);

    // Shared closure side-effects (reports → Cerrado, OT recompute, cascade, PDF)
    await sheetWorkService._finalizeSignedSheet(sheet.toObject(), tenantId);

    // Confirmation emails — fire-and-forget with Promise.allSettled so a single
    // failure doesn't affect the other or the response
    if (env.NOTIFICATIONS_ENABLED) {
      setImmediate(async () => {
        try {
          const [ot, requester] = await Promise.all([
            OT.findById(sheet.otId).select('Consecutivo').lean(),
            tokenDoc.requestedBy
              ? User.findById(tokenDoc.requestedBy).select('fullName email').lean()
              : Promise.resolve(null),
          ]);
          const signUrl = `${env.PUBLIC_APP_URL}/firma/${tokenDoc.token}`;
          const tasks = [
            emailService.sendSheetSignedClientEmail({
              to: tokenDoc.email,
              sheetNumero: sheet.numeroHoja,
              otConsecutivo: ot?.Consecutivo || null,
              signerName: signature.signerName,
              signUrl,
              expiresAt: renewal.expiresAt,
            }),
          ];
          if (requester?.email) {
            tasks.push(
              emailService.sendSheetSignedRequesterEmail({
                to: requester.email,
                sheetNumero: sheet.numeroHoja,
                otConsecutivo: ot?.Consecutivo || null,
                signerName: signature.signerName,
                signUrl,
                expiresAt: renewal.expiresAt,
              })
            );
          }
          await Promise.allSettled(tasks);
        } catch (err) {
          logger.warn('publicSheetSign: confirmation emails failed', {
            sheetId: String(sheet._id),
            err: String(err),
          });
        }
      });
    }

    logger.info('publicSheetSign: sheet signed', {
      sheetId: String(sheet._id),
      tokenId: String(tokenDoc._id),
      tenantId,
    });

    return {
      status: 'signed',
      sheetId: String(sheet._id),
      pdfStatus: 'pending',
      expiresAt: renewal.expiresAt,
    };
  }
}

export const publicSheetSignService = new PublicSheetSignService();
