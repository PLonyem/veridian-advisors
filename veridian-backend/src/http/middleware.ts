import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { config } from "../config.js";
import { AppError } from "./errors.js";

export const requestContext: RequestHandler = (_request, response, next) => {
  const requestId = randomUUID();
  response.locals.requestId = requestId;
  response.setHeader("X-Request-Id", requestId);
  response.setHeader("Cache-Control", "no-store");
  next();
};

export const requireJson: RequestHandler = (request, _response, next) => {
  if (!request.is("application/json")) return next(new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json"));
  next();
};

export const requireTrustedOrigin: RequestHandler = (request, _response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
  const origin = request.get("origin");
  if (!origin || !config.trustedOrigins.includes(origin)) {
    return next(new AppError(403, "UNTRUSTED_ORIGIN", "Request origin is not trusted"));
  }
  next();
};
