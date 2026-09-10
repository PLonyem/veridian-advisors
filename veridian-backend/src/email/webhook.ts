import { sha256, keyedHash } from "../security/hash.js";
import { config } from "../config.js";
import { pool } from "../db/client.js";
import { Resend } from "resend";
import { AppError } from "../http/errors.js";

type ResendEvent = { type: string; created_at: string; data: { email_id?: string } };

const terminalRank: Record<string, number> = { PROVIDER_ACCEPTED: 1, DELIVERED: 2, BOUNCED: 3, COMPLAINED: 4, FAILED: 3 };

export async function processResendWebhook(rawBody: Buffer, headers: { id?: string; timestamp?: string; signature?: string }): Promise<void> {
  if (!config.RESEND_WEBHOOK_SECRET) throw new AppError(503, "WEBHOOK_NOT_CONFIGURED", "Webhook processing is not configured");
  if (!headers.id || !headers.timestamp || !headers.signature) throw new AppError(400, "INVALID_WEBHOOK", "Webhook signature headers are required");
  const timestamp = Number(headers.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 5 * 60) throw new AppError(400, "STALE_WEBHOOK", "Webhook timestamp is outside the accepted window");
  let event: ResendEvent;
  try {
    const resend = new Resend(config.RESEND_API_KEY);
    event = resend.webhooks.verify({
      payload: rawBody.toString("utf8"),
      headers: { id: headers.id, timestamp: headers.timestamp, signature: headers.signature },
      webhookSecret: config.RESEND_WEBHOOK_SECRET
    }) as ResendEvent;
  } catch {
    throw new AppError(400, "INVALID_WEBHOOK", "Webhook signature is invalid");
  }
  const providerMessageId = event.data.email_id ?? null;
  const state = event.type === "email.delivered" ? "DELIVERED" : event.type === "email.bounced" ? "BOUNCED" : event.type === "email.complained" ? "COMPLAINED" : event.type === "email.failed" ? "FAILED" : null;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query(
      `insert into webhook_events (provider, provider_event_id, event_type, provider_message_id, payload_hash, occurred_at)
       values ('resend',$1,$2,$3,$4,$5) on conflict (provider,provider_event_id) do nothing returning id`,
      [headers.id, event.type, providerMessageId, sha256(rawBody), new Date(event.created_at)]
    );
    if (inserted.rowCount === 0) { await client.query("rollback"); return; }
    if (state && providerMessageId) {
      const current = await client.query<{ id: string; state: string; recipient_email: string }>("select id,state,recipient_email from communications where provider_message_id=$1 for update", [providerMessageId]);
      const communication = current.rows[0];
      if (communication && (terminalRank[state] ?? 0) >= (terminalRank[communication.state] ?? 0)) {
        await client.query(
          `update communications set state=$2, delivered_at=case when $2='DELIVERED' then coalesce(delivered_at,now()) else delivered_at end, updated_at=now() where id=$1`,
          [communication.id, state]
        );
        await client.query("update email_outbox set state=$2, updated_at=now() where communication_id=$1", [communication.id, state]);
        if (state === "BOUNCED" || state === "COMPLAINED") {
          await client.query(
            `insert into email_suppressions (recipient_hash,reason,provider_message_id) values ($1,$2,$3)
             on conflict (recipient_hash) do update set reason=excluded.reason, provider_message_id=excluded.provider_message_id`,
            [keyedHash(communication.recipient_email.toLowerCase()), state, providerMessageId]
          );
        }
      }
    }
    await client.query("update webhook_events set state='PROCESSED', processed_at=now() where provider='resend' and provider_event_id=$1", [headers.id]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
