import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "../src/security/encryption.js";

describe("restricted payload encryption", () => {
  it("round trips and rejects tampering", async () => {
    const encrypted = await encryptJson({ token: "synthetic-secret", note: "restricted" });
    expect(encrypted.ciphertext).not.toContain("synthetic-secret");
    await expect(decryptJson(encrypted)).resolves.toEqual({ token: "synthetic-secret", note: "restricted" });
    const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -4)}AAAA` };
    await expect(decryptJson(tampered)).rejects.toBeDefined();
  });
});
