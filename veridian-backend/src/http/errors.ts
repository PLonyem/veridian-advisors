import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { logger } from "../logger.js";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string[]>
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (request, _response, next) => {
  next(new AppError(404, "NOT_FOUND", `No route for ${request.method} ${request.path}`));
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  void _next;
  const requestId = String(response.locals.requestId ?? "unknown");
  if (error instanceof AppError) {
    response.status(error.status).json({
      error: { code: error.code, message: error.message, requestId, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) }
    });
    return;
  }
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "body";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request validation failed", requestId, fieldErrors } });
    return;
  }
  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON", requestId } });
    return;
  }
  if (error instanceof multer.MulterError || (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large")) {
    response.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request payload exceeds the configured limit", requestId } });
    return;
  }
  logger.error({ err: error, requestId }, "Unhandled request error");
  response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed", requestId } });
};

export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}
