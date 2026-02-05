'use strict';
import { initializeApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { logger } from './logger.config.js';

/**
 * Configuración de Firebase Client SDK
 * Usa apiKey para autenticación (compatible con configuración de cliente)
 */

const firebaseConfig = {
  projectId: "biolab-storage",
  appId: "1:27663579649:web:0b817f5344be7f52899e00",
  storageBucket: "biolab-storage.appspot.com",
  locationId: "northamerica-northeast1",
  apiKey: "AIzaSyAUKVlkxTr2sNmz_xImloRemjvlSNKPIu8",
  authDomain: "biolab-storage.firebaseapp.com",
  messagingSenderId: "27663579649"
};

let firebaseApp;
let storage;

/**
 * Inicializar Firebase
 */
export function initializeFirebase() {
  try {
    firebaseApp = initializeApp(firebaseConfig);
    storage = getStorage(firebaseApp);
    logger.info('Firebase Storage inicializado correctamente');
    return { app: firebaseApp, storage };
  } catch (error) {
    logger.error('Error inicializando Firebase:', error);
    throw error;
  }
}

/**
 * Obtener instancia de Storage
 */
export function getFirebaseStorage() {
  if (!storage) {
    throw new Error('Firebase no ha sido inicializado. Llama a initializeFirebase() primero.');
  }
  return storage;
}

/**
 * Obtener instancia de Firebase App
 */
export function getFirebaseApp() {
  if (!firebaseApp) {
    throw new Error('Firebase no ha sido inicializado. Llama a initializeFirebase() primero.');
  }
  return firebaseApp;
}

// Exportar funciones de Storage para uso en servicios
export { ref, uploadBytes, getDownloadURL, deleteObject };
