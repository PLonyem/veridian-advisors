const logger = require('../utils/logger');

// Logs every request once it finishes, using the actual response status code
// and total time taken - both of which are only known after the response
// has been sent, hence hooking `res.on('finish')` rather than logging upfront.
function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const responseTimeMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.logRequest(req.method, req.originalUrl, res.statusCode, responseTimeMs);
  });

  next();
}

module.exports = requestLogger;
