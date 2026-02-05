'use strict';
import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.config.js';

export async function connect() {
  try {
    mongoose.set('strictQuery', true);
    // Log the connection URI (masked) for debugging tenant resolution issues
    try {
      const masked = String(env.MONGO_URI).replace(/:\/\/.+@/, '://****@');
      logger.info('Connecting to MongoDB with URI (masked): ' + masked);
    } catch (e) {
      logger.info('Connecting to MongoDB');
    }
    await mongoose.connect(env.MONGO_URI, {});
    logger.info('Database connected', { db: mongoose.connection.name });
    mongoose.connection.on('disconnected', () => logger.warn('Database disconnected'));
    mongoose.connection.on('error', (err) => logger.error('Database error', err));
  } catch (error) {
    logger.error('Error connecting to database', error);
    throw error;
  }
}
