import pino from 'pino';

// Centralized application logger
// Uses pino for high-performance structured logging.
// The log level can be controlled via the LOG_LEVEL env variable.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
});
