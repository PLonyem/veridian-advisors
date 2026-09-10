import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config.js";

export type EncryptedValue = {
  version: string;
  nonce: string;
  ciphertext: string;
};

export async function encryptJson(value: unknown): Promise<EncryptedValue> {
  const version = config.activeEncryptionKeyVersion;
  const key = config.encryptionKeys.get(version);
  if (!key) throw new Error("Active encryption key unavailable");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { version, nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64") };
}

export async function decryptJson<T>(value: EncryptedValue): Promise<T> {
  const key = config.encryptionKeys.get(value.version);
  if (!key) throw new Error(`Encryption key ${value.version} is unavailable`);
  const nonce = Buffer.from(value.nonce, "base64");
  const combined = Buffer.from(value.ciphertext, "base64");
  if (combined.length < 17) throw new Error("Encrypted payload is invalid");
  const tag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(0, combined.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
