'use strict';
import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.config.js';

export async function connect() {
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(env.MONGO_URI, {});
    logger.info('Database connected');
    mongoose.connection.on('disconnected', () => logger.warn('Database disconnected'));
    mongoose.connection.on('error', (err) => logger.error('Database error', err));
  } catch (error) {
    logger.error('Error connecting to database', error);
    throw error;
  }
}
