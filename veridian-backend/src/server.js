const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
// eslint-disable-next-line no-unused-vars
const path = require('path');

const config = require('./config');
const database = require('./config/database');
const logger = require('./utils/logger');
const leadRoutes = require('./routes/leadRoutes');
const emailService = require('./services/emailService');
const { authenticateAdmin } = require('./middleware/auth');
const { leadSubmissionLimiter, emailLimiter } = require('./middleware/rateLimiter');
const requestLogger = require('./middleware/requestLogger');

// Environment check: config.env only becomes 'production' if NODE_ENV was
// explicitly set that way (see src/config/index.js), so this can't catch a
// deploy that *meant* to be production but forgot to set it - it can only
// warn when NODE_ENV was left unset entirely, which silently falls back to
// development-mode settings (permissive CORS, no HSTS, console instead of
// file logging). That's the common, dangerous version of this footgun.
if (!process.env.NODE_ENV) {
  logger.warn('NODE_ENV is not set - defaulting to "development". Set NODE_ENV=production for production deployments.');
}

const app = express();

// Request logging: logs every request's method, URL, status code, and response
// time once it finishes. Applied first, ahead of everything else, so it
// captures all requests regardless of where they terminate in the rest of the
// middleware/route chain (including ones rejected by CORS or the error handler).
app.use(requestLogger);

// Security headers (CSP, X-Frame-Options, X-Content-Type-Options, etc.) on every
// response. HSTS (strict-transport-security) is enabled only in production:
// it tells browsers to only ever contact this host over HTTPS, which is correct
// for a real deployment but actively unhelpful (and confusing) when developing
// against plain http://localhost.
app.use(
  helmet({
    hsts: config.env === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  }),
);

// Compression: gzip response bodies in production to reduce bandwidth/latency.
// Skipped in development since it just adds CPU overhead with no real benefit
// for local requests.
if (config.env === 'production') {
  app.use(compression());
}

// CORS: in production only the origins listed in ALLOWED_ORIGINS may call this API;
// in development we allow any origin so the frontend can be run from any local port.
const corsOptions = {
  origin: config.env === 'production' ? config.allowedOrigins : true,
};
app.use(cors(corsOptions));

// Parse JSON and URL-encoded request bodies. 10mb is generous headroom for a lead
// submission form while still guarding against unbounded request bodies.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limit only the public lead-submission endpoint. Admin routes are already
// gated by authenticateAdmin and shouldn't be throttled by a public-abuse limit.
app.use('/api/submit-lead', leadSubmissionLimiter);

// All lead-related routes (public submission + admin management).
app.use('/api', leadRoutes);

// GET / - friendly root response. Mainly here so tooling that probes the bare
// host (IDE port detection, uptime pings hitting "/" instead of "/api/health")
// gets a real 200 instead of noisy 404s in the request log.
app.get('/', (req, res) => {
  res.json({ name: 'Veridian Backend API', status: 'ok', docs: '/api/health' });
});

// GET /api/health - liveness check for uptime monitors / load balancers.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// POST /api/test-email - email configuration health check. Protected (sends a
// real email, so it shouldn't be public) and rate-limited like the other
// email-sending routes. Sends a real test message to ADMIN_EMAIL so you can
// confirm EMAIL_USER/EMAIL_PASS actually work - after a fresh deploy or a
// credential rotation - without needing to submit a whole fake lead just to
// trigger sendClientConfirmation.
app.post('/api/test-email', authenticateAdmin, emailLimiter, async (req, res) => {
  try {
    const info = await emailService.sendTestEmail(config.email.adminEmail);
    if (!info) {
      return res.status(200).json({
        success: true,
        skipped: true,
        message: `Skipped - a test email was already sent to ${config.email.adminEmail} within the last 5 minutes.`,
      });
    }
    return res.status(200).json({ success: true, message: `Test email sent to ${config.email.adminEmail}` });
  } catch (err) {
    logger.error(`Failed to send test email: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Failed to send test email', message: err.message });
  }
});

// Catch-all for any request that didn't match a route above.
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler. Must be declared last and take 4 args for Express to
// recognize it as an error handler rather than regular middleware. Catches
// anything thrown or rejected in a route that wasn't already handled locally.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error(err.stack || err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

let server;
let isShuttingDown = false;

async function start() {
  try {
    await database.initializeDatabase();

    server = app.listen(config.port, () => {
      logger.info(`Veridian backend listening at ${config.baseUrl} (${config.env})`);
    });

    // app.listen() reports bind failures (e.g. the port already being in use)
    // via an 'error' event on the returned server, not by throwing - without
    // this listener, that event has no handler and Node turns it into an
    // opaque uncaught exception instead of a clear, actionable message.
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`Port ${config.port} is already in use. Stop whatever else is using it, or change PORT in .env.`);
      } else {
        logger.error(`Server error: ${err.message}`);
      }
      process.exit(1);
    });
  } catch (err) {
    logger.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  }
}

// Graceful shutdown: stop accepting new connections, close the database
// connection, then exit so process managers (Docker, systemd, PM2) don't have
// to force-kill the process. Shared by the SIGINT/SIGTERM handlers below and
// by the crash handlers further down (with a non-zero exit code, so process
// managers/monitoring can tell a clean stop from a crash).
async function shutdown(signal, exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received, shutting down gracefully`);

  // Safety net: if closing the server/db hangs (e.g. a stuck connection),
  // force-exit instead of leaving a zombie process behind.
  const forceExitTimer = setTimeout(() => {
    logger.error('Graceful shutdown timed out after 10s, forcing exit');
    process.exit(exitCode || 1);
  }, 10000);
  forceExitTimer.unref();

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await database.closeDatabase();
    clearTimeout(forceExitTimer);
    logger.info('Shutdown complete');
    process.exit(exitCode);
  } catch (err) {
    logger.error(`Error during shutdown: ${err.message}`);
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT', 0));
process.on('SIGTERM', () => shutdown('SIGTERM', 0));

// Unhandled rejection handler: catches promise rejections that no `.catch()`
// or `try/catch` ever handled. Left alone, Node would eventually crash the
// process anyway (and already prints a warning) - logging it ourselves first
// and shutting down deliberately beats an untraced hard crash.
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  logger.error(`Unhandled promise rejection: ${message}`);
  shutdown('unhandledRejection', 1);
});

// Uncaught exception handler: catches synchronous errors that escaped every
// try/catch. Per Node's own guidance, the process is in an undefined state at
// this point, so we log it and shut down rather than trying to keep serving
// requests.
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.stack || err.message}`);
  shutdown('uncaughtException', 1);
});

start();

module.exports = app;
