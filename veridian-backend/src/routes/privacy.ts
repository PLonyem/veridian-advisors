import { Router } from "express";
import { getStaff } from "../authz.js";
import { pool } from "../db/client.js";
import { transaction } from "../db/transaction.js";
import { privacyCreateSchema, privacyReviewSchema, uuid } from "../domain/schemas.js";
import { AppError, asyncHandler } from "../http/errors.js";
import { decryptJson, encryptJson } from "../security/encryption.js";
import { keyedHash } from "../security/hash.js";
import { audit } from "../services/audit.js";
import { deletePrivateObject } from "../storage/s3.js";

export const privacyRouter = Router();

function requireOwner(response: import("express").Response) {
  const staff = getStaff(response);
  if (staff.role !== "OWNER") throw new AppError(403, "FORBIDDEN", "Only owners can perform privacy operations");
  return staff;
}

privacyRouter.post("/privacy-requests", asyncHandler(async (request, response) => {
  const staff = requireOwner(response);
  const input = privacyCreateSchema.parse(request.body);
  const result = await transaction(async (client) => {
    if (input.leadId) {
      const exists = await client.query("select 1 from leads where id=$1", [input.leadId]);
      if (!exists.rowCount) throw new AppError(404, "NOT_FOUND", "Lead not found");
    }
    const created = await client.query("insert into privacy_requests (lead_id,type,requester_reference) values ($1,$2,$3) returning *", [input.leadId ?? null, input.type, input.requesterReference]);
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "PRIVACY_REQUEST_RECORDED", targetType: "PRIVACY_REQUEST", targetId: created.rows[0].id, requestId: response.locals.requestId, metadata: { type: input.type } });
    return created.rows[0];
  });
  response.status(201).json({ privacyRequest: result });
}));

privacyRouter.post("/privacy-requests/:id/review", asyncHandler(async (request, response) => {
  const staff = requireOwner(response);
  const requestId = uuid.parse(request.params.id);
  const input = privacyReviewSchema.parse(request.body);
  const result = await transaction(async (client) => {
    const updated = await client.query(
      `update privacy_requests set state='REVIEWED',identity_verified_at=now(),reviewed_by=$2,review_evidence=$3,hold_until=$4,updated_at=now()
       where id=$1 and state in ('REQUESTED','IDENTITY_VERIFIED') returning *`,
      [requestId, staff.userId, input.reviewEvidence, input.holdUntil ? new Date(input.holdUntil) : null]
    );
    if (!updated.rows[0]) throw new AppError(409, "INVALID_PRIVACY_STATE", "Request is not awaiting identity review");
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "PRIVACY_IDENTITY_REVIEWED", targetType: "PRIVACY_REQUEST", targetId: requestId, requestId: response.locals.requestId });
    return updated.rows[0];
  });
  response.json({ privacyRequest: result });
}));

privacyRouter.post("/privacy-requests/:id/execute", asyncHandler(async (_request, response) => {
  const staff = requireOwner(response);
  const requestId = uuid.parse(_request.params.id);
  const privacyResult = await pool.query<{ id: string; lead_id: string | null; type: string; state: string; hold_until: Date | null }>("select id,lead_id,type,state,hold_until from privacy_requests where id=$1", [requestId]);
  const privacy = privacyResult.rows[0];
  if (!privacy) throw new AppError(404, "NOT_FOUND", "Privacy request not found");
  if (privacy.state !== "REVIEWED" || !privacy.lead_id) throw new AppError(409, "INVALID_PRIVACY_STATE", "A verified, reviewed subject record is required");
  if (privacy.hold_until && privacy.hold_until > new Date()) throw new AppError(409, "PRIVACY_HOLD_ACTIVE", "This request is under an active hold");

  if (privacy.type === "EXPORT") {
    const [lead, enquiries, consents, qualification, engagements, payments, communications, documents] = await Promise.all([
      pool.query("select id,full_name,email,country,net_worth_range,tier_interest,pipeline_stage,archived_at,created_at,updated_at from leads where id=$1", [privacy.lead_id]),
      pool.query("select id,full_name,email,country,net_worth_range,tier_interest,repeat_contact,submitted_at from enquiries where lead_id=$1", [privacy.lead_id]),
      pool.query("select purpose,state,notice_version,occurred_at from consent_events where lead_id=$1", [privacy.lead_id]),
      pool.query("select state,citizenship_residence,approximate_net_worth_range,source_of_funds_category,requested_service_timing,preferred_tier,received_at,decision,service_fit_reason,reviewed_at from qualification_reviews where lead_id=$1", [privacy.lead_id]),
      pool.query("select id,package_code,quote_minor,currency,payment_required,state,signature_evidence_type,signature_evidence_reference,signed_at,created_at from engagements where lead_id=$1", [privacy.lead_id]),
      pool.query("select engagement_id,amount_minor,currency,status,externally_confirmed_at,external_reference,created_at from payments where engagement_id in (select id from engagements where lead_id=$1)", [privacy.lead_id]),
      pool.query("select template,category,state,accepted_at,delivered_at,created_at from communications where lead_id=$1", [privacy.lead_id]),
      pool.query("select type,state,checksum_sha256,size_bytes,version,approved_at,created_at from documents where lead_id=$1 and deleted_at is null", [privacy.lead_id])
    ]);
    const payload = await encryptJson({ exportedAt: new Date().toISOString(), lead: lead.rows[0], enquiries: enquiries.rows, consents: consents.rows, qualification: qualification.rows, engagements: engagements.rows, payments: payments.rows, communications: communications.rows, documents: documents.rows });
    const exportRecord = await transaction(async (client) => {
      const created = await client.query("insert into privacy_exports (request_id,payload_encrypted,expires_at) values ($1,$2,now()+interval '15 minutes') returning id,expires_at", [requestId, JSON.stringify(payload)]);
      await client.query("update privacy_requests set state='COMPLETED',execution_report=$2,completed_at=now(),updated_at=now() where id=$1", [requestId, JSON.stringify({ exportId: created.rows[0].id, expiresAt: created.rows[0].expires_at })]);
      await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "PRIVACY_EXPORT_PREPARED", targetType: "PRIVACY_REQUEST", targetId: requestId, requestId: response.locals.requestId });
      return created.rows[0];
    });
    response.json({ completed: true, export: { id: exportRecord.id, expiresAt: exportRecord.expires_at, downloadPath: `/api/v1/admin/privacy-exports/${exportRecord.id}` } });
    return;
  }

  if (privacy.type === "ERASURE") {
    const documents = await pool.query<{ object_key: string }>("select object_key from documents where lead_id=$1 and deleted_at is null", [privacy.lead_id]);
    for (const document of documents.rows) await deletePrivateObject(document.object_key);
    await transaction(async (client) => {
      const lead = await client.query<{ normalized_email: string }>("select normalized_email from leads where id=$1 for update", [privacy.lead_id]);
      if (!lead.rows[0]) throw new AppError(404, "NOT_FOUND", "Lead not found");
      await client.query("update email_outbox set state='CANCELLED',payload_encrypted=null,updated_at=now() where communication_id in (select id from communications where lead_id=$1) and state in ('QUEUED','RETRY_SCHEDULED','FAILED')", [privacy.lead_id]);
      const enquiryIds = await client.query<{ id: string }>("select id from enquiries where lead_id=$1 or id in (select enquiry_id from enquiry_candidates where lead_id=$1)", [privacy.lead_id]);
      await client.query("delete from communications where lead_id=$1", [privacy.lead_id]);
      for (const enquiry of enquiryIds.rows) {
        await client.query("delete from consent_events where enquiry_id=$1", [enquiry.id]);
        await client.query("delete from enquiry_candidates where enquiry_id=$1", [enquiry.id]);
        await client.query("delete from enquiries where id=$1", [enquiry.id]);
      }
      await client.query("delete from email_suppressions where recipient_hash=$1", [keyedHash(lead.rows[0].normalized_email)]);
      await client.query("update privacy_requests set lead_id=null,state='COMPLETED',execution_report=$2,completed_at=now(),updated_at=now() where id=$1", [requestId, JSON.stringify({ primaryStoreErased: true, providerErasure: "manual-provider-review-required", deletedObjects: documents.rowCount })]);
      await client.query("delete from leads where id=$1", [privacy.lead_id]);
      await client.query("insert into deletion_ledger (subject_hash,request_id,erased_at,key_version,evidence) values ($1,$2,now(),'v1',$3) on conflict do nothing", [keyedHash(lead.rows[0].normalized_email), requestId, JSON.stringify({ source: "verified-owner-workflow" })]);
      await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "PRIVACY_ERASURE_COMPLETED", targetType: "PRIVACY_REQUEST", targetId: requestId, requestId: response.locals.requestId });
    });
    response.json({ completed: true, providerActionRequired: true });
    return;
  }

  await transaction(async (client) => {
    if (privacy.type === "ARCHIVE") await client.query("update leads set archived_at=coalesce(archived_at,now()),version=version+1,updated_at=now() where id=$1", [privacy.lead_id]);
    if (privacy.type === "COMMUNICATION_WITHDRAWAL") {
      const lead = await client.query<{ normalized_email: string }>("select normalized_email from leads where id=$1 for update", [privacy.lead_id]);
      const enquiry = await client.query<{ id: string }>("select id from enquiries where lead_id=$1 order by submitted_at desc limit 1", [privacy.lead_id]);
      if (enquiry.rows[0]) await client.query("insert into consent_events (enquiry_id,lead_id,purpose,state,notice_version) values ($1,$2,'MARKETING','WITHDRAWN','owner-reviewed-request')", [enquiry.rows[0].id, privacy.lead_id]);
      await client.query("insert into email_suppressions (recipient_hash,reason) values ($1,'COMMUNICATION_WITHDRAWAL') on conflict (recipient_hash) do update set reason=excluded.reason", [keyedHash(lead.rows[0]!.normalized_email)]);
    }
    await client.query("update email_outbox set state='CANCELLED',payload_encrypted=null,updated_at=now() where communication_id in (select id from communications where lead_id=$1 and category='DISCRETIONARY') and state in ('QUEUED','RETRY_SCHEDULED','FAILED')", [privacy.lead_id]);
    await client.query("update communications set state='CANCELLED',updated_at=now() where lead_id=$1 and category='DISCRETIONARY' and state in ('QUEUED','RETRY_SCHEDULED','FAILED')", [privacy.lead_id]);
    await client.query("update privacy_requests set state='COMPLETED',execution_report=$2,completed_at=now(),updated_at=now() where id=$1", [requestId, JSON.stringify({ action: privacy.type, completed: true })]);
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: `PRIVACY_${privacy.type}_COMPLETED`, targetType: "PRIVACY_REQUEST", targetId: requestId, requestId: response.locals.requestId });
  });
  response.json({ completed: true });
}));

privacyRouter.get("/privacy-exports/:id", asyncHandler(async (request, response) => {
  const staff = requireOwner(response);
  const exportId = uuid.parse(request.params.id);
  const result = await transaction(async (client) => {
    const record = await client.query<{ payload_encrypted: { version: string; nonce: string; ciphertext: string }; expires_at: Date }>("select payload_encrypted,expires_at from privacy_exports where id=$1 for update", [exportId]);
    const item = record.rows[0];
    if (!item || !item.payload_encrypted || item.expires_at <= new Date()) throw new AppError(404, "EXPORT_UNAVAILABLE", "Export is unavailable or expired");
    const data = await decryptJson(item.payload_encrypted);
    await client.query("update privacy_exports set payload_encrypted=null,downloaded_at=now() where id=$1", [exportId]);
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "PRIVACY_EXPORT_DOWNLOADED", targetType: "PRIVACY_EXPORT", targetId: exportId, requestId: response.locals.requestId });
    return data;
  });
  response.setHeader("Content-Disposition", `attachment; filename="veridian-privacy-export-${exportId}.json"`);
  response.type("application/json").send(JSON.stringify(result, null, 2));
}));
