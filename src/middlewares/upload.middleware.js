'use strict';
import multer from 'multer';
import { ApiError } from '../utils/apiError.util.js';
import {
  MAX_EVIDENCES,
  MAX_EVIDENCE_SIZE_BYTES,
  ALLOWED_EVIDENCE_MIME,
} from '../constants/evidence.constants.js';

/**
 * Configuración de Multer para manejo de archivos
 * Usa memoria storage para procesar archivos en memoria y subirlos a Firebase
 */

// Configurar almacenamiento en memoria
const storage = multer.memoryStorage();

// Filtro para validar tipos de archivo
const fileFilter = (req, file, cb) => {
  // Solo permitir imágenes
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, 'Tipo de archivo no permitido. Solo se permiten imágenes.', 'INVALID_FILE_TYPE'), false);
  }
};

// Configuración de multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB máximo
  }
});

/**
 * Middleware para subir un solo archivo de logo
 * El campo del formulario debe llamarse 'logo'
 */
export const uploadLogo = upload.single('logo');

/**
 * Middleware para subir logo con campo 'logoUrl'
 */
export const uploadLogoUrl = upload.single('logoUrl');

/**
 * Middleware opcional para logo - no falla si no hay archivo
 * Acepta tanto 'logo' como 'logoUrl'
 */
export const uploadLogoOptional = (req, res, next) => {
  const uploadAny = upload.any();
  uploadAny(req, res, (err) => {
    if (err) {
      return next(err);
    }
    // Si hay archivos, buscar el que se llame 'logo' o 'logoUrl'
    if (req.files && req.files.length > 0) {
      const logoFile = req.files.find(f => f.fieldname === 'logo' || f.fieldname === 'logoUrl');
      if (logoFile) {
        req.file = logoFile;
      }
    }
    next();
  });
};

/**
 * Multer instance for report evidences: JPEG/PNG only, max 3 files, 5MB each.
 * Field name: `evidencias`.
 */
const evidenceFileFilter = (req, file, cb) => {
  if (ALLOWED_EVIDENCE_MIME.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, 'Only JPEG or PNG images are allowed', 'INVALID_FILE_TYPE'), false);
  }
};

const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: evidenceFileFilter,
  limits: {
    fileSize: MAX_EVIDENCE_SIZE_BYTES,
    files: MAX_EVIDENCES,
  },
});

export const uploadEvidencias = evidenceUpload.array('evidencias', MAX_EVIDENCES);

/**
 * Middleware para manejar errores de multer
 */
export const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new ApiError(400, 'El archivo es demasiado grande. Máximo 5MB.', 'FILE_TOO_LARGE'));
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return next(new ApiError(400, `A report can have at most ${MAX_EVIDENCES} evidences`, 'EVIDENCE_LIMIT_EXCEEDED'));
    }
    return next(new ApiError(400, `Error al procesar el archivo: ${err.message}`, 'MULTER_ERROR'));
  }
  next(err);
};

export default { uploadLogo, handleMulterError };
