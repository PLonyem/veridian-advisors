require('dotenv').config({ quiet: true });

const logger = require('../utils/logger');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REQUIRED_VARS = [
  'PORT',
  'EMAIL_USER',
  'EMAIL_PASS',
  'ADMIN_EMAIL',
  'ADMIN_KEY',
  'BASE_URL',
  'ALLOWED_ORIGINS',
];

function validate() {
  const errors = [];

  const missing = REQUIRED_VARS.filter((name) => !process.env[name] || !process.env[name].trim());
  if (missing.length) {
    errors.push(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  if (process.env.PORT && Number.isNaN(Number(process.env.PORT))) {
    errors.push(`PORT must be a valid number, got "${process.env.PORT}"`);
  }

  if (process.env.EMAIL_USER && !EMAIL_REGEX.test(process.env.EMAIL_USER)) {
    errors.push(`EMAIL_USER must be a valid email address, got "${process.env.EMAIL_USER}"`);
  }

  if (process.env.ADMIN_EMAIL && !EMAIL_REGEX.test(process.env.ADMIN_EMAIL)) {
    errors.push(`ADMIN_EMAIL must be a valid email address, got "${process.env.ADMIN_EMAIL}"`);
  }

  if (process.env.ADMIN_KEY && process.env.ADMIN_KEY.length < 32) {
    errors.push(`ADMIN_KEY must be at least 32 characters long, got ${process.env.ADMIN_KEY.length}`);
  }

  if (process.env.ALLOWED_ORIGINS && !process.env.ALLOWED_ORIGINS.split(',').some((origin) => origin.trim())) {
    errors.push('ALLOWED_ORIGINS must be a comma-separated list of at least one origin');
  }

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n  - ${errors.join('\n  - ')}`);
  }
}

validate();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10),
  baseUrl: process.env.BASE_URL,

  email: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    adminEmail: process.env.ADMIN_EMAIL,
  },

  adminKey: process.env.ADMIN_KEY,

  allowedOrigins: process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 5,
  },
};

logger.info(
  `Config loaded: env=${config.env} port=${config.port} baseUrl=${config.baseUrl} ` +
    `emailUser=${config.email.user} adminEmail=${config.email.adminEmail} ` +
    `allowedOrigins=${config.allowedOrigins.join(',')} adminKey=${'*'.repeat(8)} emailPass=${'*'.repeat(8)}`,
);

module.exports = config;
