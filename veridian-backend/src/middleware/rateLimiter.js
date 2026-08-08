const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('../utils/logger');

// Admin endpoints (e.g. GET /api/leads) are authenticated and used internally,
// so they shouldn't be throttled by the public lead-submission limit.
function skipAdminEndpoints(req) {
  return req.method === 'GET';
}

// windowMs is configurable (RATE_LIMIT_WINDOW_MS), so the 429 message can't
// just hardcode "an hour" - it needs to describe whatever the window actually is.
function formatWindow(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

const leadSubmissionLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAdminEndpoints,
  handler: (req, res) => {
    logger.warn(`[RATE_LIMIT] Limit exceeded: ip=${req.ip} path=${req.originalUrl}`);
    res.status(429).json({
      error: 'Too many requests',
      message: `You have exceeded the request limit. Please try again in ${formatWindow(config.rateLimit.windowMs)}.`,
    });
  },
});

module.exports = { leadSubmissionLimiter };
