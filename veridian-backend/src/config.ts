import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { z } from "zod";

if (existsSync(".env")) loadEnvFile(".env");

const developmentEncryptionKey = Buffer.alloc(32, 7).toString("base64");
const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  HOST: z.string().min(1).default("0.0.0.0"),
  DATABASE_URL: z.string().url().default("postgresql://veridian_app:local_app_password@localhost:5432/veridian"),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  TEST_DATABASE_URL: z.string().url().optional(),
  BETTER_AUTH_SECRET: z.string().min(32).default("development-only-auth-secret-change-me"),
  DATA_ENCRYPTION_KEYS: z.string().default(`v1:${developmentEncryptionKey}`),
  BACKUP_ENCRYPTION_KEY: z.string().optional(),
  RATE_LIMIT_HMAC_KEY: z.string().min(32).default("development-only-rate-limit-key-change-me"),
  PUBLIC_SITE_URL: z.string().url().default("http://localhost:5000"),
  ADMIN_APP_URL: z.string().url().default("http://localhost:5000"),
  API_BASE_URL: z.string().url().default("http://localhost:5000"),
  TRUSTED_ORIGINS: z.string().default("http://localhost:5000"),
  COMMUNICATION_POLICY: z.literal("EMAIL_ONLY").default("EMAIL_ONLY"),
  CONSULTATIONS_ENABLED: z.stringbool().default(false),
  CURRENT_NOTICE_VERSION: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2026-09-01"),
  STAFF_NOTIFICATION_EMAIL: z.string().email().default("staff@example.test"),
  MONITORED_REPLY_TO: z.string().email().default("reply@example.test"),
  EMAIL_TEST_RECIPIENT: z.string().email().default("test@example.test"),
  EMAIL_PROVIDER: z.enum(["smtp", "resend"]).default("smtp"),
  EMAIL_FROM: z.string().min(3).default("Veridian Global Advisors <no-reply@example.test>"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  S3_ENDPOINT: z.string().url().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(3).default("veridian-private"),
  S3_ACCESS_KEY_ID: z.string().default("veridian-local"),
  S3_SECRET_ACCESS_KEY: z.string().default("replace-local-secret"),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
  MAX_PDF_BYTES: z.coerce.number().int().positive().max(25 * 1024 * 1024).default(10 * 1024 * 1024),
  SCANNER_ADAPTER: z.enum(["development-allow-pdf", "clamav"]).default("development-allow-pdf"),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
  WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(15).max(300).default(60)
});

const parsed = environmentSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${z.prettifyError(parsed.error)}`);
}

const value = parsed.data;
const trustedOrigins = value.TRUSTED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
for (const origin of trustedOrigins) {
  const url = new URL(origin);
  if (url.origin !== origin || (value.NODE_ENV === "production" && url.protocol !== "https:")) {
    throw new Error(`TRUSTED_ORIGINS contains an invalid exact origin: ${origin}`);
  }
}

const encryptionKeys = new Map<string, Uint8Array>();
for (const entry of value.DATA_ENCRYPTION_KEYS.split(",")) {
  const [version, encoded, extra] = entry.split(":");
  if (!version || !encoded || extra) throw new Error("DATA_ENCRYPTION_KEYS must contain version:base64 pairs");
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32) throw new Error(`Encryption key ${version} must decode to 32 bytes`);
  encryptionKeys.set(version, key);
}

if (value.NODE_ENV === "production") {
  const missing: string[] = [];
  if (!value.MIGRATION_DATABASE_URL) missing.push("MIGRATION_DATABASE_URL");
  if (value.BETTER_AUTH_SECRET.startsWith("development-only")) missing.push("BETTER_AUTH_SECRET");
  if (value.RATE_LIMIT_HMAC_KEY.startsWith("development-only")) missing.push("RATE_LIMIT_HMAC_KEY");
  if (value.DATA_ENCRYPTION_KEYS.includes(developmentEncryptionKey)) missing.push("DATA_ENCRYPTION_KEYS");
  if (!value.BACKUP_ENCRYPTION_KEY) missing.push("BACKUP_ENCRYPTION_KEY");
  if (value.EMAIL_PROVIDER === "resend" && !value.RESEND_API_KEY) missing.push("RESEND_API_KEY");
  if (value.EMAIL_PROVIDER === "smtp" && (!value.SMTP_USER || !value.SMTP_PASSWORD)) missing.push("SMTP_USER/SMTP_PASSWORD");
  if (!value.RESEND_WEBHOOK_SECRET && value.EMAIL_PROVIDER === "resend") missing.push("RESEND_WEBHOOK_SECRET");
  if (value.SCANNER_ADAPTER === "development-allow-pdf") missing.push("SCANNER_ADAPTER");
  if (missing.length) throw new Error(`Production configuration is incomplete: ${missing.join(", ")}`);
}

export const config = {
  ...value,
  trustedOrigins,
  encryptionKeys,
  activeEncryptionKeyVersion: encryptionKeys.keys().next().value as string
};

export type AppConfig = typeof config;
