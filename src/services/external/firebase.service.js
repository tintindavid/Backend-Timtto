'use strict';
import { getFirebaseStorage, ref, uploadBytes, getDownloadURL, deleteObject } from '../../config/firebase.config.js';
import { logger } from '../../config/logger.config.js';
import { ApiError } from '../../utils/apiError.util.js';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * Servicio para gestionar archivos en Firebase Storage
 * Específicamente para logos de clientes
 */
export class FirebaseStorageService {
  
  /**
   * Sube un logo a Firebase Storage
   * @param {Buffer} fileBuffer - Buffer del archivo
   * @param {string} originalName - Nombre original del archivo
   * @param {string} mimetype - Tipo MIME del archivo
   * @param {string} folder - Carpeta donde guardar (default: 'logos')
   * @returns {Promise<string>} URL pública del archivo subido
   */
  async uploadLogo(fileBuffer, originalName, mimetype, folder = 'logos') {
    try {
      const storage = getFirebaseStorage();
      
      // Validar tipo de archivo (solo imágenes)
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(mimetype)) {
        throw new ApiError(400, 'Tipo de archivo no permitido. Solo se permiten imágenes.', 'INVALID_FILE_TYPE');
      }

      // Validar tamaño (máximo 5MB)
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (fileBuffer.length > maxSize) {
        throw new ApiError(400, 'El archivo es demasiado grande. Máximo 5MB.', 'FILE_TOO_LARGE');
      }

      // Generar nombre único para el archivo
      const extension = path.extname(originalName);
      const uniqueName = `${folder}/${uuidv4()}${extension}`;

      // Crear referencia al archivo en Storage
      const storageRef = ref(storage, uniqueName);

      // Subir archivo con metadata
      const metadata = {
        contentType: mimetype,
        customMetadata: {
          originalName: originalName,
          uploadedAt: new Date().toISOString(),
        }
      };

      await uploadBytes(storageRef, fileBuffer, metadata);

      // Obtener URL pública
      const publicUrl = await getDownloadURL(storageRef);
      
      logger.info('Logo subido exitosamente a Firebase Storage', { url: publicUrl });
      return publicUrl;
      
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error subiendo logo a Firebase Storage:', error);
      throw new ApiError(500, 'Error subiendo archivo a Firebase Storage', 'UPLOAD_ERROR');
    }
  }

  /**
   * Elimina un logo de Firebase Storage
   * @param {string} fileUrl - URL pública del archivo a eliminar
   * @returns {Promise<void>}
   */
  async deleteLogo(fileUrl) {
    try {
      if (!fileUrl) {
        logger.warn('No se proporcionó URL de archivo para eliminar');
        return;
      }

      const storage = getFirebaseStorage();
      
      // Extraer el path del archivo de la URL
      // Formato Firebase Storage URL: https://firebasestorage.googleapis.com/v0/b/bucket/o/path%2Ffile.ext?...
      // O formato download URL: https://firebasestorage.googleapis.com/...
      let filePath;
      
      if (fileUrl.includes('/o/')) {
        // URL con token
        const pathMatch = fileUrl.match(/\/o\/([^?]+)/);
        if (pathMatch) {
          filePath = decodeURIComponent(pathMatch[1]);
        }
      } else if (fileUrl.includes('logos/')) {
        // Formato simple con path directo
        const parts = fileUrl.split('logos/');
        if (parts.length > 1) {
          filePath = 'logos/' + parts[1].split('?')[0];
        }
      }

      if (!filePath) {
        logger.warn('No se pudo extraer el path del archivo de la URL:', fileUrl);
        return;
      }

      // Crear referencia y eliminar
      const fileRef = ref(storage, filePath);
      await deleteObject(fileRef);
      
      logger.info('Logo eliminado exitosamente de Firebase Storage', { filePath });
      
    } catch (error) {
      // Error 404 es esperado si el archivo ya no existe
      if (error.code === 'storage/object-not-found') {
        logger.warn('El archivo ya no existe en Firebase Storage');
        return;
      }
      logger.error('Error eliminando logo de Firebase Storage:', error);
      // No lanzar error para no bloquear otras operaciones
    }
  }

  /**
   * Reemplaza un logo antiguo por uno nuevo
   * @param {string} oldLogoUrl - URL del logo antiguo a eliminar
   * @param {Buffer} newFileBuffer - Buffer del nuevo archivo
   * @param {string} originalName - Nombre original del nuevo archivo
   * @param {string} mimetype - Tipo MIME del nuevo archivo
   * @returns {Promise<string>} URL pública del nuevo archivo
   */
  async replaceLogo(oldLogoUrl, newFileBuffer, originalName, mimetype) {
    try {
      // Subir nuevo logo
      const newLogoUrl = await this.uploadLogo(newFileBuffer, originalName, mimetype);
      
      // Eliminar logo antiguo (no esperar, ejecutar en background)
      if (oldLogoUrl) {
        this.deleteLogo(oldLogoUrl).catch(err => {
          logger.error('Error eliminando logo antiguo:', err);
        });
      }
      
      return newLogoUrl;
      
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error reemplazando logo:', error);
      throw new ApiError(500, 'Error reemplazando logo', 'REPLACE_ERROR');
    }
  }

  /**
   * Obtiene información de un archivo en Storage
   * @param {string} fileUrl - URL pública del archivo
   * @returns {Promise<object>} Metadata del archivo
   */
  async getFileMetadata(fileUrl) {
    try {
      const storage = getFirebaseStorage();
      
      // Extraer path del archivo
      let filePath;
      if (fileUrl.includes('/o/')) {
        const pathMatch = fileUrl.match(/\/o\/([^?]+)/);
        if (pathMatch) {
          filePath = decodeURIComponent(pathMatch[1]);
        }
      } else if (fileUrl.includes('logos/')) {
        const parts = fileUrl.split('logos/');
        if (parts.length > 1) {
          filePath = 'logos/' + parts[1].split('?')[0];
        }
      }
      
      if (!filePath) {
        throw new ApiError(400, 'URL de archivo inválida', 'INVALID_URL');
      }

      const fileRef = ref(storage, filePath);
      const metadata = await getDownloadURL(fileRef); // getMetadata no está disponible en client SDK
      
      return { url: metadata, path: filePath };
      
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error('Error obteniendo metadata del archivo:', error);
      throw new ApiError(500, 'Error obteniendo información del archivo', 'METADATA_ERROR');
    }
  }
}

export const firebaseStorageService = new FirebaseStorageService();
