import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "veridian-backend", environment: config.NODE_ENV },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.password",
      "req.body.token",
      "req.body.code",
      "*.password",
      "*.token",
      "*.secret",
      "*.backupCodes",
      "*.restrictedNotes"
    ],
    censor: "[REDACTED]"
  }
});
