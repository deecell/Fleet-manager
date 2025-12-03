/**
 * Structured Logger for Device Manager
 * 
 * Outputs JSON logs for easy parsing by log aggregators.
 * Includes deviceId, orgId correlation for debugging.
 */

const { config } = require('./config');

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = LOG_LEVELS[config.logging.level] ?? LOG_LEVELS.info;

/**
 * Format a log entry
 */
function formatLog(level, message, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: 'device-manager',
    ...context,
  };

  if (config.logging.format === 'json') {
    return JSON.stringify(entry);
  }

  // Text format for development
  const contextStr = Object.keys(context).length > 0 
    ? ` ${JSON.stringify(context)}` 
    : '';
  return `[${entry.timestamp}] ${level.toUpperCase()} ${message}${contextStr}`;
}

/**
 * Log an error message
 */
function error(message, context = {}) {
  if (currentLevel >= LOG_LEVELS.error) {
    console.error(formatLog('error', message, context));
  }
}

/**
 * Log a warning message
 */
function warn(message, context = {}) {
  if (currentLevel >= LOG_LEVELS.warn) {
    console.warn(formatLog('warn', message, context));
  }
}

/**
 * Log an info message
 */
function info(message, context = {}) {
  if (currentLevel >= LOG_LEVELS.info) {
    console.log(formatLog('info', message, context));
  }
}

/**
 * Log a debug message
 */
function debug(message, context = {}) {
  if (currentLevel >= LOG_LEVELS.debug) {
    console.log(formatLog('debug', message, context));
  }
}

/**
 * Create a child logger with preset context
 */
function child(defaultContext) {
  return {
    error: (msg, ctx = {}) => error(msg, { ...defaultContext, ...ctx }),
    warn: (msg, ctx = {}) => warn(msg, { ...defaultContext, ...ctx }),
    info: (msg, ctx = {}) => info(msg, { ...defaultContext, ...ctx }),
    debug: (msg, ctx = {}) => debug(msg, { ...defaultContext, ...ctx }),
  };
}

module.exports = {
  error,
  warn,
  info,
  debug,
  child,
};
