const config = require('../config');
const logger = require('../utils/logger');

/**
 * Restricts access to admin-only routes (viewing/managing leads) with a shared
 * secret key. The key may be supplied as a query parameter (?key=<ADMIN_KEY>)
 * or via the `x-api-key` header; either is checked against config.adminKey.
 * Every attempt, successful or failed, is logged for audit purposes.
 *
 * To extend this to JWT authentication instead of a static shared key:
 *   1. Read the token from the `Authorization: Bearer <token>` header instead
 *      of (or in addition to) req.query.key.
 *   2. Replace the direct string comparison below with `jwt.verify(token, JWT_SECRET)`
 *      wrapped in a try/catch (an invalid/expired token throws).
 *   3. On success, attach the decoded payload to `req.user` so downstream
 *      handlers can check roles/permissions instead of a single "is admin" flag.
 *   4. Keep returning 401 for a missing/invalid token; use 403 if the token is
 *      valid but lacks the required role/permission.
 */
function authenticateAdmin(req, res, next) {
  const providedKey = req.query.key || req.header('x-api-key');
  const ip = req.ip;
  const path = req.originalUrl;

  if (providedKey && providedKey === config.adminKey) {
    logger.info(`[AUTH] Admin authentication succeeded: ip=${ip} path=${path}`);
    return next();
  }

  const reason = providedKey ? 'invalid_key' : 'missing_key';
  logger.warn(`[AUTH] Admin authentication failed: ip=${ip} path=${path} reason=${reason}`);

  return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing admin key' });
}

module.exports = { authenticateAdmin };
