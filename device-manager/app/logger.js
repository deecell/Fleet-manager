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

const LEVEL_COLORS = {
  error: '\x1b[31m',   // red
  warn: '\x1b[33m',    // yellow
  info: '\x1b[36m',    // cyan
  debug: '\x1b[90m',   // gray
};

/**
 * Format a log entry as a colorized, human-readable line
 */
function formatLog(level, message, context = {}) {
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';
  const bold = '\x1b[1m';
  const levelColor = LEVEL_COLORS[level] || '';
  const tag = level.toUpperCase().padEnd(5);

  const contextKeys = Object.keys(context);
  let contextStr = '';
  if (contextKeys.length > 0) {
    const parts = contextKeys.map(k => {
      const v = context[k];
      return `${dim}${k}=${reset}${v}`;
    });
    contextStr = `  ${parts.join('  ')}`;
  }

  return `${dim}${ts}${reset} ${levelColor}${tag}${reset} ${bold}${message}${reset}${contextStr}`;
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
 * Log a green banner message (always shown, regardless of log level)
 */
function banner(message) {
  const green = '\x1b[32m';
  const reset = '\x1b[0m';
  console.log(`${green}${message}${reset}`);
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
  banner,
  child,
};
