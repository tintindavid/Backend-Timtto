'use strict';
import winston from 'winston';
import path from 'path';
import { env } from './env.js';

const { combine, timestamp, printf, colorize } = winston.format;

const logFormat = printf(({ level, message, timestamp: ts, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} ${level}: ${message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: combine(timestamp(), logFormat),
  transports: [
    ...(env.NODE_ENV === 'production'
      ? [
          new winston.transports.File({
            filename: path.join('logs', 'app.log'),
            level: 'info',
            maxsize: 5 * 1024 * 1024,
          }),
        ]
      : [
          new winston.transports.Console({
            format: combine(colorize(), timestamp(), logFormat),
          }),
        ]),
  ],
  exitOnError: false,
});

export const loggerStream = {
  write: (message = '') => {
    logger.info(message.trim());
  },
};
