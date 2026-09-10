import { createHash, createHmac } from "node:crypto";
import { config } from "../config.js";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function fingerprint(value: unknown): string {
  return sha256(JSON.stringify(stableValue(value)));
}

export function keyedHash(value: string): string {
  return createHmac("sha256", config.RATE_LIMIT_HMAC_KEY).update(value).digest("hex");
}
