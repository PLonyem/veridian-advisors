import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { resolve } from "node:path";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import { requireStaff } from "./authz.js";
import { config } from "./config.js";
import { checkDatabaseReady } from "./db/client.js";
import { processResendWebhook } from "./email/webhook.js";
import { errorHandler, notFound, asyncHandler } from "./http/errors.js";
import { requestContext, requireTrustedOrigin } from "./http/middleware.js";
import { logger } from "./logger.js";
import { adminLeadsRouter } from "./routes/admin-leads.js";
import { operationsRouter } from "./routes/operations.js";
import { privacyRouter } from "./routes/privacy.js";
import { publicRouter } from "./routes/public.js";
import { workflowRouter } from "./routes/workflow.js";
import { consumeRateLimit } from "./security/rate-limit.js";
import { keyedHash } from "./security/hash.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.use(helmet({ contentSecurityPolicy: { directives: { "script-src": ["'self'"], "style-src": ["'self'"] } } }));
  app.use(pinoHttp({ logger }));
  app.use(requestContext);

  app.get("/health/live", (_request, response) => response.json({ status: "live" }));
  app.get("/health/ready", asyncHandler(async (_request, response) => { await checkDatabaseReady(); response.json({ status: "ready" }); }));

  app.post("/api/webhooks/resend", express.raw({ type: "application/json", limit: "256kb" }), asyncHandler(async (request, response) => {
    await processResendWebhook(request.body as Buffer, {
      ...(request.get("svix-id") ? { id: request.get("svix-id")! } : {}),
      ...(request.get("svix-timestamp") ? { timestamp: request.get("svix-timestamp")! } : {}),
      ...(request.get("svix-signature") ? { signature: request.get("svix-signature")! } : {})
    });
    response.json({ received: true });
  }));

  app.use("/api/auth", requireTrustedOrigin, asyncHandler(async (request, _response, next) => {
    if (request.method !== "POST") return next();
    const sensitive = /sign-in|reset|password|two-factor/.test(request.path);
    if (sensitive) await consumeRateLimit(`auth:${request.path}:${keyedHash(request.ip ?? "unknown")}`, 10, 15 * 60);
    next();
  }));
  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.use(express.json({ limit: "32kb", strict: true }));
  app.use("/api", publicRouter);
  app.use("/api/v1/admin", requireTrustedOrigin, requireStaff, adminLeadsRouter, workflowRouter, operationsRouter, privacyRouter);
  app.get(["/admin", "/admin/"], (_request, response) => response.sendFile(resolve("public/admin.html")));
  app.use(express.static("public", { etag: true, maxAge: config.NODE_ENV === "production" ? "1h" : 0, index: "index.html" }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
