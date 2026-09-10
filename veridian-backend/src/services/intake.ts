import type { Request } from "express";
import { config } from "../config.js";
import { pool } from "../db/client.js";
import { AppError } from "../http/errors.js";
import { fingerprint, keyedHash, sha256 } from "../security/hash.js";
import { consumeRateLimit } from "../security/rate-limit.js";
import { queueEmail } from "../email/queue.js";

export type IntakeInput = {
  fullName: string;
  email: string;
  country: string;
  netWorthRange: "USD_1M_5M" | "USD_5M_20M" | "USD_20M_PLUS";
  tierInterest: "FOUNDATION" | "ACCELERATED" | "EXECUTIVE" | "NOT_SURE";
  disclaimerAccepted: true;
  noticeVersion: string;
  marketingConsent: boolean;
  website?: string | undefined;
};

const receipt = { accepted: true, message: "Your enquiry has been received for staff review." } as const;

export async function submitEnquiry(input: IntakeInput, request: Request): Promise<typeof receipt> {
  if (input.noticeVersion !== config.CURRENT_NOTICE_VERSION) throw new AppError(409, "NOTICE_VERSION_CHANGED", "The published notice changed; review and accept the current version");
  if (input.website) return receipt;
  const key = request.get("idempotency-key");
  if (!key || !/^[A-Za-z0-9._:-]{16,128}$/.test(key)) throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
  const normalizedEmail = input.email.trim().toLowerCase();
  await consumeRateLimit(`intake:ip:${keyedHash(request.ip ?? "unknown")}`, 20, 60 * 60);
  await consumeRateLimit(`intake:recipient:${keyedHash(normalizedEmail)}`, 5, 24 * 60 * 60);
  const keyHash = sha256(key);
  const requestFingerprint = fingerprint(input);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query(
      `insert into idempotency_records (scope,key_hash,request_fingerprint,expires_at)
       values ('public-enquiry',$1,$2,now()+interval '24 hours') on conflict do nothing returning key_hash`,
      [keyHash, requestFingerprint]
    );
    if (inserted.rowCount === 0) {
      const existing = await client.query<{ request_fingerprint: string; response_body: typeof receipt | null }>(
        "select request_fingerprint,response_body from idempotency_records where scope='public-enquiry' and key_hash=$1 for update",
        [keyHash]
      );
      const record = existing.rows[0];
      if (!record || record.request_fingerprint !== requestFingerprint) throw new AppError(409, "IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different request");
      if (!record.response_body) throw new AppError(409, "REQUEST_IN_PROGRESS", "The original request is still processing");
      await client.query("commit");
      return record.response_body;
    }
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [normalizedEmail]);
    const matches = await client.query<{ id: string }>("select id from leads where normalized_email=$1 order by created_at,id for update", [normalizedEmail]);
    const repeatContact = matches.rows.length > 0;
    let leadId: string | null = null;
    if (!repeatContact) {
      const created = await client.query<{ id: string; version: number }>(
        `insert into leads (full_name,email,normalized_email,country,net_worth_range,tier_interest)
         values ($1,$2,$3,$4,$5,$6) returning id,version`,
        [input.fullName, input.email, normalizedEmail, input.country, input.netWorthRange, input.tierInterest]
      );
      leadId = created.rows[0]!.id;
      await client.query(
        `insert into status_history (lead_id,to_stage,actor_type,reason,to_version) values ($1,'NEW','PUBLIC','Initial enquiry',1)`,
        [leadId]
      );
    }
    const enquiry = await client.query<{ id: string }>(
      `insert into enquiries (lead_id,full_name,email,normalized_email,country,net_worth_range,tier_interest,repeat_contact,reconciliation_pending)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$8) returning id`,
      [leadId, input.fullName, input.email, normalizedEmail, input.country, input.netWorthRange, input.tierInterest, repeatContact]
    );
    const enquiryId = enquiry.rows[0]!.id;
    for (const match of matches.rows) await client.query("insert into enquiry_candidates (enquiry_id,lead_id) values ($1,$2)", [enquiryId, match.id]);
    await client.query(
      `insert into consent_events (enquiry_id,lead_id,purpose,state,notice_version) values ($1,$2,'INTAKE_ACKNOWLEDGEMENT','ACCEPTED',$3)`,
      [enquiryId, leadId, config.CURRENT_NOTICE_VERSION]
    );
    if (input.marketingConsent) await client.query(
      `insert into consent_events (enquiry_id,lead_id,purpose,state,notice_version) values ($1,$2,'MARKETING','ACCEPTED',$3)`,
      [enquiryId, leadId, config.CURRENT_NOTICE_VERSION]
    );
    const recentAck = await client.query(
      `select 1 from communications where recipient_email=$1 and template='ENQUIRY_ACK' and created_at>now()-interval '15 minutes' limit 1`,
      [input.email]
    );
    const suppressed = await client.query("select 1 from email_suppressions where recipient_hash=$1", [keyedHash(normalizedEmail)]);
    if (recentAck.rowCount === 0 && suppressed.rowCount === 0) await queueEmail(client, {
      jobKey: `enquiry-ack:${enquiryId}`,
      ...(leadId ? { leadId } : {}),
      recipientType: "LEAD",
      recipientRef: enquiryId,
      recipientEmail: input.email,
      template: "ENQUIRY_ACK",
      variables: { fullName: input.fullName },
      category: "TRANSACTIONAL"
    });
    await queueEmail(client, {
      jobKey: `staff-enquiry:${enquiryId}`,
      ...(leadId ? { leadId } : {}),
      recipientType: "STAFF",
      recipientRef: "intake-team",
      recipientEmail: config.STAFF_NOTIFICATION_EMAIL,
      template: "STAFF_NOTIFICATION",
      variables: { dashboardUrl: `${config.ADMIN_APP_URL}/admin#${leadId ? "lead" : "enquiry"}=${encodeURIComponent(leadId ?? enquiryId)}` },
      category: "TRANSACTIONAL",
      priority: 10
    });
    await client.query(
      `insert into audit_events (actor_type,action,target_type,target_id,request_id,metadata)
       values ('PUBLIC','ENQUIRY_SUBMITTED','ENQUIRY',$1,$2,$3)`,
      [enquiryId, String(request.res?.locals.requestId ?? "unknown"), JSON.stringify({ repeatContact })]
    );
    await client.query(
      `update idempotency_records set response_status=202,response_body=$3 where scope='public-enquiry' and key_hash=$1 and request_fingerprint=$2`,
      [keyHash, requestFingerprint, JSON.stringify(receipt)]
    );
    await client.query("commit");
    return receipt;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
