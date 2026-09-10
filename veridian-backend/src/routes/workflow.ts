import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { getStaff, assertLeadAccess } from "../authz.js";
import { config } from "../config.js";
import { pool } from "../db/client.js";
import { transaction } from "../db/transaction.js";
import { engagementSchema, evidenceSchema, followUpSchema, paymentSchema, qualificationReviewSchema, qualificationSchema, sendSchema, uuid } from "../domain/schemas.js";
import { queueEmail } from "../email/queue.js";
import { AppError, asyncHandler } from "../http/errors.js";
import { encryptJson } from "../security/encryption.js";
import { fingerprint, keyedHash, sha256 } from "../security/hash.js";
import { audit } from "../services/audit.js";
import { scanPdf } from "../storage/scanner.js";
import { createPrivateDownloadUrl, deletePrivateObject, putPrivateObject } from "../storage/s3.js";

export const workflowRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_PDF_BYTES, files: 1, fields: 5 } });

function actionKey(request: { get(name: string): string | undefined }, action: string, targetId: string): { scope: string; keyHash: string } {
  const key = request.get("idempotency-key");
  if (!key || !/^[A-Za-z0-9._:-]{16,128}$/.test(key)) throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
  return { scope: `${action}:${targetId}`, keyHash: sha256(key) };
}

async function reserveAction(client: import("pg").PoolClient, key: { scope: string; keyHash: string }, payload: unknown): Promise<boolean> {
  const requestFingerprint = fingerprint(payload);
  const inserted = await client.query(
    `insert into idempotency_records (scope,key_hash,request_fingerprint,expires_at) values ($1,$2,$3,now()+interval '7 days') on conflict do nothing returning key_hash`,
    [key.scope, key.keyHash, requestFingerprint]
  );
  if (inserted.rowCount === 1) return true;
  const existing = await client.query<{ request_fingerprint: string }>("select request_fingerprint from idempotency_records where scope=$1 and key_hash=$2", [key.scope, key.keyHash]);
  if (existing.rows[0]?.request_fingerprint !== requestFingerprint) throw new AppError(409, "IDEMPOTENCY_CONFLICT", "The Idempotency-Key was used with different action data");
  return false;
}

async function lockLead(client: import("pg").PoolClient, leadId: string, expectedVersion: number) {
  const result = await client.query<{ id: string; full_name: string; email: string; pipeline_stage: string; version: number; archived_at: Date | null }>("select id,full_name,email,pipeline_stage,version,archived_at from leads where id=$1 for update", [leadId]);
  const lead = result.rows[0];
  if (!lead) throw new AppError(404, "NOT_FOUND", "Lead not found");
  if (lead.version !== expectedVersion) throw new AppError(409, "STALE_VERSION", "The lead changed; refresh and resolve the conflict");
  if (lead.archived_at) throw new AppError(409, "LEAD_ARCHIVED", "Archived leads cannot perform this action");
  return lead;
}

workflowRouter.post("/leads/:id/pre-vetting/send", asyncHandler(async (request, response) => {
  const leadId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  await assertLeadAccess(leadId, staff, true);
  const input = sendSchema.parse(request.body);
  const key = actionKey(request, "pre-vetting", leadId);
  const result = await transaction(async (client) => {
    const lead = await lockLead(client, leadId, input.expectedVersion);
    if (["REJECTED", "SIGNED", "CONVERTED"].includes(lead.pipeline_stage)) throw new AppError(409, "INVALID_WORKFLOW_STATE", "Pre-vetting cannot be sent in this stage");
    if (!(await reserveAction(client, key, input))) return { queued: true, replay: true };
    await queueEmail(client, { jobKey: `${key.scope}:${key.keyHash}`, leadId, recipientType: "LEAD", recipientRef: leadId, recipientEmail: lead.email, template: "PRE_VETTING", variables: { fullName: lead.full_name }, category: "DISCRETIONARY", createdBy: staff.userId });
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "PRE_VETTING_QUEUED", targetType: "LEAD", targetId: leadId, requestId: response.locals.requestId });
    return { queued: true, replay: false };
  });
  response.status(202).json(result);
}));

workflowRouter.put("/leads/:id/qualification", asyncHandler(async (request, response) => {
  const leadId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  await assertLeadAccess(leadId, staff, true);
  const input = qualificationSchema.parse(request.body);
  const encrypted = input.restrictedNotes ? await encryptJson({ text: input.restrictedNotes }) : null;
  const review = await transaction(async (client) => {
    await lockLead(client, leadId, input.expectedVersion);
    const existing = await client.query<{ id: string; version: number }>("select id,version from qualification_reviews where lead_id=$1 and state<>'REVIEWED' order by created_at desc limit 1 for update", [leadId]);
    const result = existing.rows[0]
      ? await client.query(
          `update qualification_reviews set state='SUBMITTED',citizenship_residence=$2,approximate_net_worth_range=$3,source_of_funds_category=$4,
             requested_service_timing=$5,preferred_tier=$6,received_at=$7,restricted_notes_encrypted=$8,version=version+1,updated_at=now()
           where id=$1 returning *`,
          [existing.rows[0].id, input.citizenshipResidence, input.approximateNetWorthRange, input.sourceOfFundsCategory, input.requestedServiceTiming, input.preferredTier, new Date(input.receivedAt), encrypted ? JSON.stringify(encrypted) : null]
        )
      : await client.query(
          `insert into qualification_reviews (lead_id,state,citizenship_residence,approximate_net_worth_range,source_of_funds_category,requested_service_timing,preferred_tier,received_at,restricted_notes_encrypted)
           values ($1,'SUBMITTED',$2,$3,$4,$5,$6,$7,$8) returning *`,
          [leadId, input.citizenshipResidence, input.approximateNetWorthRange, input.sourceOfFundsCategory, input.requestedServiceTiming, input.preferredTier, new Date(input.receivedAt), encrypted ? JSON.stringify(encrypted) : null]
        );
    await client.query("update leads set version=version+1,updated_at=now() where id=$1", [leadId]);
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "QUALIFICATION_RECORDED", targetType: "LEAD", targetId: leadId, requestId: response.locals.requestId });
    return result.rows[0];
  });
  response.json({ qualification: review });
}));

workflowRouter.post("/leads/:id/qualification/review", asyncHandler(async (request, response) => {
  const leadId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  await assertLeadAccess(leadId, staff, true);
  const input = qualificationReviewSchema.parse(request.body);
  const result = await transaction(async (client) => {
    const lead = await lockLead(client, leadId, input.expectedVersion);
    if (lead.pipeline_stage !== "QUALIFICATION_PENDING") throw new AppError(409, "INVALID_WORKFLOW_STATE", "The lead must be qualification pending");
    const review = await client.query<{ id: string }>("select id from qualification_reviews where lead_id=$1 and state='SUBMITTED' order by created_at desc limit 1 for update", [leadId]);
    if (!review.rows[0]) throw new AppError(409, "QUALIFICATION_REQUIRED", "A submitted qualification summary is required");
    const nextVersion = lead.version + 1;
    await client.query("update qualification_reviews set state='REVIEWED',decision=$2,service_fit_reason=$3,reviewer_id=$4,reviewed_at=now(),version=version+1,updated_at=now() where id=$1", [review.rows[0].id, input.decision, input.serviceFitReason, staff.userId]);
    await client.query("update leads set pipeline_stage=$2,version=$3,updated_at=now() where id=$1", [leadId, input.decision, nextVersion]);
    await client.query("insert into status_history (lead_id,from_stage,to_stage,actor_id,actor_type,reason,from_version,to_version) values ($1,$2,$3,$4,'STAFF',$5,$6,$7)", [leadId, lead.pipeline_stage, input.decision, staff.userId, input.serviceFitReason, lead.version, nextVersion]);
    await queueEmail(client, { jobKey: `qualification-outcome:${review.rows[0].id}`, leadId, recipientType: "LEAD", recipientRef: leadId, recipientEmail: lead.email, template: "QUALIFICATION_OUTCOME", variables: { fullName: lead.full_name, outcome: input.decision, reason: input.serviceFitReason }, category: "TRANSACTIONAL", createdBy: staff.userId });
    if (input.decision === "REJECTED") {
      await client.query("update email_outbox set state='CANCELLED',payload_encrypted=null,updated_at=now() where communication_id in (select id from communications where lead_id=$1 and category='DISCRETIONARY' and template<>'QUALIFICATION_OUTCOME') and state in ('QUEUED','RETRY_SCHEDULED')", [leadId]);
    }
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "QUALIFICATION_REVIEWED", targetType: "LEAD", targetId: leadId, requestId: response.locals.requestId, metadata: { decision: input.decision } });
    return { decision: input.decision, version: nextVersion };
  });
  response.json(result);
}));

workflowRouter.post("/leads/:id/follow-ups", asyncHandler(async (request, response) => {
  const leadId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  await assertLeadAccess(leadId, staff, true);
  const input = followUpSchema.parse(request.body);
  const key = actionKey(request, "follow-up", leadId);
  const result = await transaction(async (client) => {
    const lead = await lockLead(client, leadId, input.expectedVersion);
    if (["REJECTED", "CONVERTED"].includes(lead.pipeline_stage)) throw new AppError(409, "INVALID_WORKFLOW_STATE", "Follow-up is not permitted in this stage");
    const suppression = await client.query("select 1 from email_suppressions where recipient_hash=$1", [keyedHash(lead.email.toLowerCase())]);
    if (suppression.rowCount) throw new AppError(409, "RECIPIENT_SUPPRESSED", "This recipient is suppressed from discretionary messages");
    if (!(await reserveAction(client, key, input))) return { queued: true, replay: true };
    await queueEmail(client, { jobKey: `${key.scope}:${key.keyHash}`, leadId, recipientType: "LEAD", recipientRef: leadId, recipientEmail: lead.email, template: "FOLLOW_UP", variables: { subject: input.subject, message: input.message }, category: "DISCRETIONARY", createdBy: staff.userId });
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "FOLLOW_UP_QUEUED", targetType: "LEAD", targetId: leadId, requestId: response.locals.requestId });
    return { queued: true, replay: false };
  });
  response.status(202).json(result);
}));

workflowRouter.post("/leads/:id/engagements", asyncHandler(async (request, response) => {
  const leadId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  await assertLeadAccess(leadId, staff, true);
  const input = engagementSchema.parse(request.body);
  const engagement = await transaction(async (client) => {
    const lead = await lockLead(client, leadId, input.expectedVersion);
    if (lead.pipeline_stage !== "QUALIFIED") throw new AppError(409, "INVALID_WORKFLOW_STATE", "Only qualified leads can receive an engagement");
    const result = await client.query("insert into engagements (lead_id,package_code,quote_minor,currency,payment_required,created_by) values ($1,$2,$3,$4,$5,$6) returning *", [leadId, input.packageCode, input.quoteMinor, input.currency, input.paymentRequired, staff.userId]);
    await client.query("update leads set version=version+1,updated_at=now() where id=$1", [leadId]);
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "ENGAGEMENT_CREATED", targetType: "ENGAGEMENT", targetId: result.rows[0].id, requestId: response.locals.requestId, metadata: { packageCode: input.packageCode } });
    return result.rows[0];
  });
  response.status(201).json({ engagement });
}));

workflowRouter.post("/engagements/:id/document", upload.single("document"), asyncHandler(async (request, response) => {
  const engagementId = uuid.parse(request.params.id);
  const expectedVersion = Number(request.body.expectedVersion);
  const uploadedType = request.body.type === "SIGNED_ENGAGEMENT" ? "SIGNED_ENGAGEMENT" : "ENGAGEMENT";
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new AppError(400, "VALIDATION_ERROR", "expectedVersion is required");
  if (!request.file) throw new AppError(400, "DOCUMENT_REQUIRED", "A PDF document is required");
  if (request.file.size > config.MAX_PDF_BYTES) throw new AppError(413, "DOCUMENT_TOO_LARGE", "The PDF exceeds the configured limit");
  const detected = await fileTypeFromBuffer(request.file.buffer);
  if (detected?.mime !== "application/pdf" || !request.file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new AppError(415, "INVALID_DOCUMENT", "Only a valid PDF is accepted");
  const engagement = await pool.query<{ lead_id: string; version: number }>("select lead_id,version from engagements where id=$1", [engagementId]);
  if (!engagement.rows[0]) throw new AppError(404, "NOT_FOUND", "Engagement not found");
  const staff = getStaff(response);
  await assertLeadAccess(engagement.rows[0].lead_id, staff, true);
  if (engagement.rows[0].version !== expectedVersion) throw new AppError(409, "STALE_VERSION", "The engagement changed; refresh and resolve the conflict");
  const scan = await scanPdf(request.file.buffer);
  const objectKey = `engagements/${engagement.rows[0].lead_id}/${randomUUID()}.pdf`;
  await putPrivateObject(objectKey, request.file.buffer);
  try {
    const document = await transaction(async (client) => {
      const locked = await client.query<{ lead_id: string; version: number; state: string }>("select lead_id,version,state from engagements where id=$1 for update", [engagementId]);
      if (locked.rows[0]?.version !== expectedVersion) throw new AppError(409, "STALE_VERSION", "The engagement changed during upload");
      const expectedState = uploadedType === "SIGNED_ENGAGEMENT" ? "SENT" : "DRAFT";
      if (locked.rows[0].state !== expectedState) throw new AppError(409, "INVALID_WORKFLOW_STATE", `This document type requires an engagement in ${expectedState} state`);
      const version = await client.query<{ next: number }>("select coalesce(max(version),0)+1 as next from documents where engagement_id=$1", [engagementId]);
      const created = await client.query(
        `insert into documents (lead_id,engagement_id,type,state,object_key,checksum_sha256,mime_type,size_bytes,version,original_name,scan_reference,approved_at,created_by)
         values ($1,$2,$3,$4,$5,$6,'application/pdf',$7,$8,$9,$10,$11,$12) returning *`,
        [locked.rows[0].lead_id, engagementId, uploadedType, scan.clean ? "APPROVED" : "REJECTED", objectKey, sha256(request.file!.buffer), request.file!.size, version.rows[0]!.next, uploadedType === "SIGNED_ENGAGEMENT" ? "staff-approved-signed-engagement.pdf" : "staff-approved-engagement.pdf", scan.reference, scan.clean ? new Date() : null, staff.userId]
      );
      if (scan.clean && uploadedType === "ENGAGEMENT") await client.query("update engagements set current_document_id=$2,version=version+1,updated_at=now() where id=$1", [engagementId, created.rows[0].id]);
      else await client.query("update engagements set version=version+1,updated_at=now() where id=$1", [engagementId]);
      await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "ENGAGEMENT_DOCUMENT_UPLOADED", targetType: "DOCUMENT", targetId: created.rows[0].id, requestId: response.locals.requestId, metadata: { scanClean: scan.clean, type: uploadedType } });
      return created.rows[0];
    });
    response.status(201).json({ document: { id: document.id, state: document.state, checksumSha256: document.checksum_sha256, version: document.version } });
  } catch (error) {
    await deletePrivateObject(objectKey).catch(() => undefined);
    throw error;
  }
}));

workflowRouter.post("/engagements/:id/send", asyncHandler(async (request, response) => {
  const engagementId = uuid.parse(request.params.id);
  const input = sendSchema.parse(request.body);
  const key = actionKey(request, "engagement-send", engagementId);
  const staff = getStaff(response);
  const result = await transaction(async (client) => {
    const engagementResult = await client.query<{ id: string; lead_id: string; version: number; state: string; current_document_id: string | null }>("select id,lead_id,version,state,current_document_id from engagements where id=$1 for update", [engagementId]);
    const engagement = engagementResult.rows[0];
    if (!engagement) throw new AppError(404, "NOT_FOUND", "Engagement not found");
    await assertLeadAccess(engagement.lead_id, staff, true);
    if (engagement.version !== input.expectedVersion) throw new AppError(409, "STALE_VERSION", "The engagement changed; refresh and resolve the conflict");
    if (engagement.state !== "DRAFT" || !engagement.current_document_id) throw new AppError(409, "INVALID_WORKFLOW_STATE", "A draft engagement with an approved PDF is required");
    const document = await client.query("select 1 from documents where id=$1 and engagement_id=$2 and state='APPROVED' and deleted_at is null", [engagement.current_document_id, engagementId]);
    if (!document.rowCount) throw new AppError(409, "DOCUMENT_NOT_APPROVED", "The selected document has not passed scanning and approval");
    const lead = await client.query<{ email: string; full_name: string; pipeline_stage: string }>("select email,full_name,pipeline_stage from leads where id=$1 for update", [engagement.lead_id]);
    if (lead.rows[0]?.pipeline_stage !== "QUALIFIED") throw new AppError(409, "INVALID_WORKFLOW_STATE", "The lead is no longer qualified for this send");
    if (!(await reserveAction(client, key, input))) return { queued: true, replay: true };
    await queueEmail(client, { jobKey: `${key.scope}:${key.keyHash}`, leadId: engagement.lead_id, engagementId, documentId: engagement.current_document_id, recipientType: "LEAD", recipientRef: engagement.lead_id, recipientEmail: lead.rows[0].email, template: "ENGAGEMENT_DELIVERY", variables: { fullName: lead.rows[0].full_name }, category: "DISCRETIONARY", createdBy: staff.userId });
    await client.query("update engagements set state='QUEUED',sent_document_id=current_document_id,version=version+1,updated_at=now() where id=$1", [engagementId]);
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "ENGAGEMENT_QUEUED", targetType: "ENGAGEMENT", targetId: engagementId, requestId: response.locals.requestId });
    return { queued: true, replay: false };
  });
  response.status(202).json(result);
}));

workflowRouter.post("/engagements/:id/record-signature", asyncHandler(async (request, response) => {
  const engagementId = uuid.parse(request.params.id);
  const input = evidenceSchema.parse(request.body);
  const staff = getStaff(response);
  const result = await transaction(async (client) => {
    const engagementResult = await client.query<{ lead_id: string; version: number; state: string }>("select lead_id,version,state from engagements where id=$1 for update", [engagementId]);
    const engagement = engagementResult.rows[0];
    if (!engagement) throw new AppError(404, "NOT_FOUND", "Engagement not found");
    await assertLeadAccess(engagement.lead_id, staff, true);
    if (engagement.version !== input.expectedVersion) throw new AppError(409, "STALE_VERSION", "The engagement changed; refresh and resolve the conflict");
    if (engagement.state !== "SENT") throw new AppError(409, "INVALID_WORKFLOW_STATE", "Signature evidence can only be recorded after provider acceptance");
    if (input.evidenceType === "SIGNED_PDF") {
      if (!input.signedDocumentId) throw new AppError(400, "SIGNED_DOCUMENT_REQUIRED", "A signed PDF reference is required");
      const document = await client.query("select 1 from documents where id=$1 and engagement_id=$2 and type='SIGNED_ENGAGEMENT' and state='APPROVED'", [input.signedDocumentId, engagementId]);
      if (!document.rowCount) throw new AppError(409, "INVALID_EVIDENCE_DOCUMENT", "The signed evidence PDF is unavailable or not approved");
    }
    const updated = await client.query("update engagements set state='SIGNED',signature_evidence_type=$2,signature_evidence_reference=$3,signed_document_id=$4,signed_at=$5,version=version+1,updated_at=now() where id=$1 returning *", [engagementId, input.evidenceType, input.evidenceReference, input.signedDocumentId ?? null, new Date(input.signedAt)]);
    const lead = await client.query<{ pipeline_stage: string; version: number }>("select pipeline_stage,version from leads where id=$1 for update", [engagement.lead_id]);
    if (lead.rows[0]?.pipeline_stage !== "ENGAGEMENT_SENT") throw new AppError(409, "INVALID_WORKFLOW_STATE", "Lead must be at engagement sent before signature recording");
    await client.query("update leads set pipeline_stage='SIGNED',version=version+1,updated_at=now() where id=$1", [engagement.lead_id]);
    await client.query("insert into status_history (lead_id,from_stage,to_stage,actor_id,actor_type,reason,from_version,to_version) values ($1,'ENGAGEMENT_SENT','SIGNED',$2,'STAFF','External signature evidence recorded',$3,$4)", [engagement.lead_id, staff.userId, lead.rows[0].version, lead.rows[0].version + 1]);
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "SIGNATURE_EVIDENCE_RECORDED", targetType: "ENGAGEMENT", targetId: engagementId, requestId: response.locals.requestId, metadata: { evidenceType: input.evidenceType } });
    return updated.rows[0];
  });
  response.json({ engagement: result });
}));

workflowRouter.post("/engagements/:id/payments", asyncHandler(async (request, response) => {
  const engagementId = uuid.parse(request.params.id);
  const input = paymentSchema.parse(request.body);
  const staff = getStaff(response);
  const payment = await transaction(async (client) => {
    const engagement = await client.query<{ lead_id: string; version: number }>("select lead_id,version from engagements where id=$1 for update", [engagementId]);
    if (!engagement.rows[0]) throw new AppError(404, "NOT_FOUND", "Engagement not found");
    await assertLeadAccess(engagement.rows[0].lead_id, staff, true);
    if (engagement.rows[0].version !== input.expectedVersion) throw new AppError(409, "STALE_VERSION", "The engagement changed; refresh and resolve the conflict");
    const result = await client.query("insert into payments (engagement_id,amount_minor,currency,status,externally_confirmed_at,external_reference,recorded_by) values ($1,$2,$3,'EXTERNALLY_CONFIRMED',$4,$5,$6) returning *", [engagementId, input.amountMinor, input.currency, new Date(input.externallyConfirmedAt), input.externalReference, staff.userId]);
    await client.query("update engagements set version=version+1,updated_at=now() where id=$1", [engagementId]);
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "EXTERNAL_PAYMENT_RECORDED", targetType: "ENGAGEMENT", targetId: engagementId, requestId: response.locals.requestId, metadata: { currency: input.currency } });
    return result.rows[0];
  });
  response.status(201).json({ payment });
}));

workflowRouter.post("/leads/:id/convert", asyncHandler(async (request, response) => {
  const leadId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  await assertLeadAccess(leadId, staff, true);
  const input = sendSchema.pick({ expectedVersion: true }).parse(request.body);
  const lead = await transaction(async (client) => {
    const locked = await lockLead(client, leadId, input.expectedVersion);
    if (locked.pipeline_stage !== "SIGNED") throw new AppError(409, "INVALID_WORKFLOW_STATE", "Lead must have recorded signature evidence before onboarding");
    const engagementResult = await client.query<{ id: string; quote_minor: string; payment_required: boolean; state: string }>(
      `select id,quote_minor,payment_required,state from engagements
       where lead_id=$1 order by created_at desc limit 1 for update`,
      [leadId]
    );
    const engagement = engagementResult.rows[0];
    if (!engagement || engagement.state !== "SIGNED") throw new AppError(409, "SIGNATURE_REQUIRED", "A signed engagement is required");
    const paid = await client.query<{ total: string }>("select coalesce(sum(amount_minor),0) as total from payments where engagement_id=$1 and status='EXTERNALLY_CONFIRMED'", [engagement.id]);
    if (engagement.payment_required && BigInt(paid.rows[0]!.total) < BigInt(engagement.quote_minor)) throw new AppError(409, "PAYMENT_REQUIREMENT_NOT_MET", "The externally recorded payment requirement is not met");
    const updated = await client.query("update leads set pipeline_stage='CONVERTED',version=version+1,updated_at=now() where id=$1 returning *", [leadId]);
    await client.query("insert into status_history (lead_id,from_stage,to_stage,actor_id,actor_type,reason,from_version,to_version) values ($1,'SIGNED','CONVERTED',$2,'STAFF','Onboarding completed',$3,$4)", [leadId, staff.userId, locked.version, locked.version + 1]);
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "LEAD_ONBOARDED", targetType: "LEAD", targetId: leadId, requestId: response.locals.requestId });
    return updated.rows[0];
  });
  response.json({ lead });
}));

workflowRouter.get("/documents/:id/download", asyncHandler(async (request, response) => {
  const documentId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  if (staff.role === "VIEWER") throw new AppError(403, "FORBIDDEN", "Viewers cannot download documents");
  const result = await pool.query<{ lead_id: string; object_key: string; state: string }>("select lead_id,object_key,state from documents where id=$1 and deleted_at is null", [documentId]);
  const document = result.rows[0];
  if (!document) throw new AppError(404, "NOT_FOUND", "Document not found");
  await assertLeadAccess(document.lead_id, staff);
  if (document.state !== "APPROVED") throw new AppError(409, "DOCUMENT_NOT_APPROVED", "Document is unavailable until scanning and approval complete");
  const url = await createPrivateDownloadUrl(document.object_key);
  await transaction((client) => audit(client, { actorId: staff.userId, actorType: "STAFF", action: "DOCUMENT_DOWNLOAD_AUTHORIZED", targetType: "DOCUMENT", targetId: documentId, requestId: response.locals.requestId }));
  response.json({ url, expiresInSeconds: 60 });
}));
