import { randomUUID } from "node:crypto";
import { pool } from "../db/client.js";
import { encryptJson } from "../security/encryption.js";

export async function queueAuthEmail(input: {
  recipientEmail: string;
  userId: string;
  resetUrl: string;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  const payload = await encryptJson({ resetUrl: input.resetUrl });
  const communicationId = randomUUID();
  const outboxId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into communications
        (id, recipient_type, recipient_ref, recipient_email, template, template_version, category, state, created_at)
       values ($1, 'STAFF', $2, $3, 'PASSWORD_RESET', '1', 'SECURITY', 'QUEUED', now())`,
      [communicationId, input.userId, input.recipientEmail]
    );
    await client.query(
      `insert into email_outbox
        (id, communication_id, job_key, payload_encrypted, priority, state, attempts, next_attempt_at, expires_at, created_at, updated_at)
       values ($1, $2, $3, $4, 100, 'QUEUED', 0, now(), $5, now(), now())`,
      [outboxId, communicationId, `password-reset:${input.userId}:${outboxId}`, JSON.stringify(payload), expiresAt]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
