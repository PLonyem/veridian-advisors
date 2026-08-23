const fs = require('fs');
const path = require('path');

const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

const COLORS = {
  DEBUG: '\x1b[90m', // gray
  INFO: '\x1b[36m', // cyan
  WARN: '\x1b[33m', // yellow
  ERROR: '\x1b[31m', // red
};
const RESET = '\x1b[0m';

const isProduction = process.env.NODE_ENV === 'production';

// LOG_LEVEL lets either environment be overridden explicitly; otherwise
// development shows everything (including DEBUG) and production hides DEBUG
// noise by default.
const configuredLevel = (process.env.LOG_LEVEL || (isProduction ? 'INFO' : 'DEBUG')).toUpperCase();
const minLevelIndex = LEVELS.includes(configuredLevel) ? LEVELS.indexOf(configuredLevel) : LEVELS.indexOf('INFO');

// See DATA_DIR note in src/config/database.js - same reasoning applies here so
// log files land on a persistent volume in deployments that have one, instead
// of the container's ephemeral filesystem.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, '..', '..');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
let logDirReady = false;

function ensureLogDir() {
  if (logDirReady) return true;
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    logDirReady = true;
  } catch (err) {
    // A logging failure should never take the app down - fall back to console.
    console.error(`logger: failed to create log directory, falling back to console: ${err.message}`);
  }
  return logDirReady;
}

function formatLine(level, message, meta) {
  const timestamp = new Date().toISOString();
  const metaSuffix = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level}] ${message}${metaSuffix}`;
}

function consoleMethodFor(level) {
  if (level === 'ERROR') return console.error;
  if (level === 'WARN') return console.warn;
  return console.log;
}

function writeToFile(line) {
  if (!ensureLogDir()) return;
  try {
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch (err) {
    console.error(`logger: failed to write to log file, falling back to console: ${err.message}`);
    console.log(line);
  }
}

function log(level, message, meta) {
  if (LEVELS.indexOf(level) < minLevelIndex) return;

  const line = formatLine(level, message, meta);

  if (isProduction) {
    writeToFile(line);
  } else {
    const color = COLORS[level] || '';
    consoleMethodFor(level)(`${color}${line}${RESET}`);
  }
}

/**
 * @param {string} message
 * @param {Object} [meta] - Optional structured context, e.g. { leadId: 123 }.
 */
function debug(message, meta) {
  log('DEBUG', message, meta);
}

function info(message, meta) {
  log('INFO', message, meta);
}

function warn(message, meta) {
  log('WARN', message, meta);
}

function error(message, meta) {
  log('ERROR', message, meta);
}

/**
 * Logs a completed HTTP request/response cycle. Severity follows the response
 * status: 5xx logs as ERROR, 4xx as WARN, everything else as INFO.
 *
 * @param {string} method
 * @param {string} url
 * @param {number} statusCode
 * @param {number} responseTimeMs
 */
function logRequest(method, url, statusCode, responseTimeMs) {
  const level = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';
  log(level, `${method} ${url} ${statusCode} ${responseTimeMs.toFixed(1)}ms`);
}

/**
 * Logs an email send/receive both as a normal log line and as a row in the
 * communications table. leadService is required lazily (inside the function
 * body, not at module load time) because leadService.js itself requires this
 * logger module - requiring it up top would create a circular require.
 *
 * @param {number|string} leadId
 * @param {('incoming'|'outgoing')} type
 * @param {string} subject
 * @param {string} content
 * @returns {Promise<Object|null>} The created communications row, or null if the DB write failed (already logged).
 */
async function logEmail(leadId, type, subject, content) {
  info('Email logged', { leadId, type, subject });

  try {
    const leadService = require('../services/leadService');
    return await leadService.addCommunication(leadId, type, subject, content);
  } catch (err) {
    error('Failed to log email to communications table', { leadId, type, error: err.message });
    return null;
  }
}

/**
 * Logs the details of a lead's form submission at INFO level.
 *
 * @param {Object} leadData
 * @param {string} [leadData.full_name]
 * @param {string} [leadData.email]
 * @param {string} [leadData.country]
 * @param {string} [leadData.net_worth]
 * @param {string} [leadData.tier_interest]
 * @returns {void}
 */
function logFormSubmission(leadData = {}) {
  const { full_name, email, country, net_worth, tier_interest } = leadData;
  info('Form submission received', { full_name, email, country, net_worth, tier_interest });
}

module.exports = { debug, info, warn, error, logRequest, logEmail, logFormSubmission };
