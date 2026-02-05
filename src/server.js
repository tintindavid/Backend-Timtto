'use strict';
import process from 'process';
import mongoose from 'mongoose';
import app from './app.js';
import { env } from './config/env.js';
import { connect } from './config/database.js';
import { logger } from './config/logger.config.js';
import { initializeFirebase } from './config/firebase.config.js';

async function start() {
  try {
    await connect();
    
    // Inicializar Firebase
    try {
      initializeFirebase();
      logger.info('Firebase Storage inicializado');
    } catch (firebaseErr) {
      logger.warn('No se pudo inicializar Firebase Storage:', firebaseErr.message);
      logger.warn('Las funciones de subida de archivos no estar\u00e1n disponibles');
    }
    
    const tryListen = (port) =>
      new Promise((resolve, reject) => {
        const srv = app.listen(port);
        srv.on('listening', () => resolve(srv));
        srv.on('error', (err) => reject(err));
      });

    let server;
    const basePort = Number(env.PORT) || 3000;
    const maxAttempts = 5;
    for (let i = 0; i < maxAttempts; i++) {
      const port = basePort + i;
      try {
        server = await tryListen(port);
        logger.info(`Server running in ${env.NODE_ENV} on port ${port}`);
        break;
      } catch (err) {
        if (err && err.code === 'EADDRINUSE') {
          logger.warn(`Port ${port} in use, trying next port...`);
          continue;
        }
        throw err;
      }
    }
    if (!server) {
      throw new Error(`Could not bind to any port in range ${basePort}-${basePort + maxAttempts - 1}`);
    }

    const graceful = async (signal) => {
      logger.info(`Received ${signal}. Closing server...`);
      server.close(async () => {
        try {
          await mongoose.connection.close();
          logger.info('Mongo connection closed.');
          process.exit(0);
        } catch (err) {
          logger.error('Error during shutdown', err);
          process.exit(1);
        }
      });
    };

    process.on('SIGINT', () => graceful('SIGINT'));
    process.on('SIGTERM', () => graceful('SIGTERM'));

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled Rejection:', reason);
    });

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception:', err);
      process.exit(1);
    });
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
}

start();
