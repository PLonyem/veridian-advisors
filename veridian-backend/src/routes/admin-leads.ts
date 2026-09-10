import { Router } from "express";
import { getStaff, assertLeadAccess, scopeSql } from "../authz.js";
import { pool } from "../db/client.js";
import { transaction } from "../db/transaction.js";
import { allowedManualTransitions, type LeadStage } from "../domain/constants.js";
import { listLeadsQuery, noteSchema, patchLeadSchema, reconcileSchema, transitionSchema, uuid } from "../domain/schemas.js";
import { AppError, asyncHandler } from "../http/errors.js";
import { encryptJson, decryptJson } from "../security/encryption.js";
import { audit } from "../services/audit.js";

export const adminLeadsRouter = Router();

adminLeadsRouter.get("/leads", asyncHandler(async (request, response) => {
  const staff = getStaff(response);
  const query = listLeadsQuery.parse(request.query);
  const scope = scopeSql(staff);
  const values: unknown[] = [...scope.values];
  const clauses = [scope.clause, query.includeArchived ? "true" : "lead.archived_at is null"];
  const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (query.search) { const slot = add(`%${query.search}%`); clauses.push(staff.role === "VIEWER" ? `lead.full_name ilike ${slot}` : `(lead.full_name ilike ${slot} or lead.email ilike ${slot})`); }
  if (query.stage) clauses.push(`lead.pipeline_stage=${add(query.stage)}`);
  if (query.assignedStaffId) clauses.push(`lead.assigned_staff_id=${add(query.assignedStaffId)}`);
  if (query.from) clauses.push(`lead.created_at>=${add(new Date(query.from))}`);
  if (query.to) clauses.push(`lead.created_at<${add(new Date(query.to))}`);
  const sortColumns = { createdAt: "lead.created_at", updatedAt: "lead.updated_at", fullName: "lead.full_name", pipelineStage: "lead.pipeline_stage" } as const;
  const offset = (query.page - 1) * query.pageSize;
  const limitSlot = add(query.pageSize);
  const offsetSlot = add(offset);
  const viewerFields = staff.role === "VIEWER"
    ? "lead.id,lead.full_name,lead.country,lead.tier_interest,lead.pipeline_stage,lead.assigned_staff_id,lead.version,lead.archived_at,lead.created_at,lead.updated_at"
    : "lead.id,lead.full_name,lead.email,lead.country,lead.net_worth_range,lead.tier_interest,lead.pipeline_stage,lead.assigned_staff_id,lead.version,lead.archived_at,lead.created_at,lead.updated_at";
  const result = await pool.query(
    `select ${viewerFields}, count(*) over()::int as total from leads lead
     where ${clauses.join(" and ")} order by ${sortColumns[query.sort]} ${query.direction},lead.id ${query.direction}
     limit ${limitSlot} offset ${offsetSlot}`,
    values
  );
  response.json({ data: result.rows.map(({ total, ...row }) => { void total; return row; }), pagination: { page: query.page, pageSize: query.pageSize, total: result.rows[0]?.total ?? 0 } });
}));

adminLeadsRouter.get("/leads/stats", asyncHandler(async (request, response) => {
  const staff = getStaff(response);
  const scope = scopeSql(staff);
  const from = typeof request.query.from === "string" ? new Date(request.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60_000);
  if (Number.isNaN(from.getTime())) throw new AppError(400, "VALIDATION_ERROR", "from must be a valid date");
  const values = [...scope.values, from];
  const result = await pool.query(
    `select pipeline_stage,count(*)::int as count from leads lead where ${scope.clause} and archived_at is null and created_at >= $${values.length} group by pipeline_stage order by pipeline_stage`,
    values
  );
  response.json({ from: from.toISOString(), counts: result.rows });
}));

adminLeadsRouter.get("/leads/:id", asyncHandler(async (request, response) => {
  const leadId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  await assertLeadAccess(leadId, staff);
  if (staff.role === "VIEWER") {
    const result = await pool.query("select id,full_name,country,tier_interest,pipeline_stage,assigned_staff_id,version,archived_at,created_at,updated_at from leads where id=$1", [leadId]);
    response.json({ lead: result.rows[0] });
    return;
  }
  const [lead, enquiries, consents, qualifications, notes, timeline, engagements, documents, communications] = await Promise.all([
    pool.query("select * from leads where id=$1", [leadId]),
    pool.query("select * from enquiries where lead_id=$1 or id in (select enquiry_id from enquiry_candidates where lead_id=$1) order by submitted_at desc", [leadId]),
    pool.query("select id,enquiry_id,purpose,state,notice_version,occurred_at from consent_events where lead_id=$1 order by occurred_at desc", [leadId]),
    pool.query("select * from qualification_reviews where lead_id=$1 order by created_at desc", [leadId]),
    pool.query("select id,actor_id,note_encrypted,created_at from lead_notes where lead_id=$1 order by created_at desc", [leadId]),
    pool.query("select * from status_history where lead_id=$1 order by occurred_at desc", [leadId]),
    pool.query("select engagement.*,coalesce((select sum(amount_minor) from payments where engagement_id=engagement.id and status='EXTERNALLY_CONFIRMED'),0)::bigint as confirmed_payment_minor from engagements engagement where lead_id=$1 order by created_at desc", [leadId]),
    pool.query("select id,engagement_id,type,state,checksum_sha256,size_bytes,version,approved_at,created_at from documents where lead_id=$1 and deleted_at is null order by created_at desc", [leadId]),
    pool.query("select id,template,category,state,provider_message_id,last_error_redacted,accepted_at,delivered_at,created_at from communications where lead_id=$1 order by created_at desc", [leadId])
  ]);
  const decodedNotes = await Promise.all(notes.rows.map(async (row) => ({ id: row.id, actorId: row.actor_id, createdAt: row.created_at, note: (await decryptJson<{ note: string }>(row.note_encrypted)).note })));
  const decodedQualifications = await Promise.all(qualifications.rows.map(async (row) => ({ ...row, restricted_notes_encrypted: undefined, restrictedNotes: row.restricted_notes_encrypted ? (await decryptJson<{ text: string }>(row.restricted_notes_encrypted)).text : undefined })));
  response.json({ lead: lead.rows[0], enquiries: enquiries.rows, consents: consents.rows, qualifications: decodedQualifications, notes: decodedNotes, timeline: timeline.rows, engagements: engagements.rows, documents: documents.rows, communications: communications.rows });
}));

adminLeadsRouter.patch("/leads/:id", asyncHandler(async (request, response) => {
  const leadId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  await assertLeadAccess(leadId, staff, true);
  const input = patchLeadSchema.parse(request.body);
  if (input.assignedStaffId !== undefined && staff.role !== "OWNER") throw new AppError(403, "FORBIDDEN", "Only owners can assign leads");
  const allowed = ["fullName", "email", "country", "assignedStaffId", "tierInterest"] as const;
  const columns = { fullName: "full_name", email: "email", country: "country", assignedStaffId: "assigned_staff_id", tierInterest: "tier_interest" } as const;
  const updates: string[] = [];
  const values: unknown[] = [leadId, input.expectedVersion];
  for (const key of allowed) if (input[key] !== undefined) { values.push(input[key]); updates.push(`${columns[key]}=$${values.length}`); }
  if (input.email !== undefined) { values.push(input.email.toLowerCase()); updates.push(`normalized_email=$${values.length}`); }
  if (!updates.length) throw new AppError(400, "VALIDATION_ERROR", "No editable fields were supplied");
  const result = await transaction(async (client) => {
    const updated = await client.query(
      `update leads set ${updates.join(",")},version=version+1,updated_at=now() where id=$1 and version=$2 returning *`,
      values
    );
    if (!updated.rows[0]) throw new AppError(409, "STALE_VERSION", "The lead changed; refresh and resolve the conflict");
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "LEAD_UPDATED", targetType: "LEAD", targetId: leadId, requestId: response.locals.requestId, metadata: { fields: updates.map((value) => value.split("=")[0]) } });
    return updated.rows[0];
  });
  response.json({ lead: result });
}));

adminLeadsRouter.post("/leads/:id/notes", asyncHandler(async (request, response) => {
  const leadId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  await assertLeadAccess(leadId, staff, true);
  const input = noteSchema.parse(request.body);
  const encrypted = await encryptJson({ note: input.note });
  const result = await transaction(async (client) => {
    const inserted = await client.query("insert into lead_notes (lead_id,actor_id,note_encrypted) values ($1,$2,$3) returning id,created_at", [leadId, staff.userId, JSON.stringify(encrypted)]);
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "LEAD_NOTE_ADDED", targetType: "LEAD", targetId: leadId, requestId: response.locals.requestId });
    return inserted.rows[0];
  });
  response.status(201).json(result);
}));

adminLeadsRouter.post("/leads/:id/transitions", asyncHandler(async (request, response) => {
  const leadId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  await assertLeadAccess(leadId, staff, true);
  const input = transitionSchema.parse(request.body);
  const result = await transaction(async (client) => {
    const currentResult = await client.query<{ pipeline_stage: LeadStage; version: number }>("select pipeline_stage,version from leads where id=$1 for update", [leadId]);
    const current = currentResult.rows[0];
    if (!current) throw new AppError(404, "NOT_FOUND", "Lead not found");
    if (current.version !== input.expectedVersion) throw new AppError(409, "STALE_VERSION", "The lead changed; refresh and resolve the conflict");
    if (!allowedManualTransitions[current.pipeline_stage].includes(input.toStage)) throw new AppError(409, "INVALID_TRANSITION", `Cannot transition from ${current.pipeline_stage} to ${input.toStage}`);
    const updated = await client.query("update leads set pipeline_stage=$2,version=version+1,updated_at=now() where id=$1 returning *", [leadId, input.toStage]);
    await client.query(
      `insert into status_history (lead_id,from_stage,to_stage,actor_id,actor_type,reason,from_version,to_version) values ($1,$2,$3,$4,'STAFF',$5,$6,$7)`,
      [leadId, current.pipeline_stage, input.toStage, staff.userId, input.reason, current.version, current.version + 1]
    );
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "LEAD_TRANSITIONED", targetType: "LEAD", targetId: leadId, requestId: response.locals.requestId, metadata: { from: current.pipeline_stage, to: input.toStage } });
    return updated.rows[0];
  });
  response.json({ lead: result });
}));

adminLeadsRouter.post("/leads/:id/archive", asyncHandler(async (request, response) => {
  const leadId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  await assertLeadAccess(leadId, staff, true);
  const input = transitionSchema.pick({ expectedVersion: true, reason: true }).parse(request.body);
  const lead = await transaction(async (client) => {
    const updated = await client.query("update leads set archived_at=now(),version=version+1,updated_at=now() where id=$1 and version=$2 and archived_at is null returning *", [leadId, input.expectedVersion]);
    if (!updated.rows[0]) throw new AppError(409, "STALE_VERSION", "The lead changed or is already archived");
    await client.query("update email_outbox set state='CANCELLED',payload_encrypted=null,updated_at=now() where communication_id in (select id from communications where lead_id=$1 and category='DISCRETIONARY') and state in ('QUEUED','RETRY_SCHEDULED')", [leadId]);
    await client.query("update communications set state='CANCELLED',updated_at=now() where lead_id=$1 and category='DISCRETIONARY' and state in ('QUEUED','RETRY_SCHEDULED')", [leadId]);
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "LEAD_ARCHIVED", targetType: "LEAD", targetId: leadId, requestId: response.locals.requestId, metadata: { reason: input.reason } });
    return updated.rows[0];
  });
  response.json({ lead });
}));

adminLeadsRouter.post("/leads/:id/restore", asyncHandler(async (request, response) => {
  const leadId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  await assertLeadAccess(leadId, staff, true);
  const input = transitionSchema.pick({ expectedVersion: true, reason: true }).parse(request.body);
  const lead = await transaction(async (client) => {
    const updated = await client.query("update leads set archived_at=null,version=version+1,updated_at=now() where id=$1 and version=$2 and archived_at is not null returning *", [leadId, input.expectedVersion]);
    if (!updated.rows[0]) throw new AppError(409, "STALE_VERSION", "The lead changed or is not archived");
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "LEAD_RESTORED", targetType: "LEAD", targetId: leadId, requestId: response.locals.requestId, metadata: { reason: input.reason } });
    return updated.rows[0];
  });
  response.json({ lead });
}));

adminLeadsRouter.get("/leads/:id/communications", asyncHandler(async (request, response) => {
  const leadId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  await assertLeadAccess(leadId, staff);
  if (staff.role === "VIEWER") throw new AppError(403, "FORBIDDEN", "Viewers cannot access communications");
  const result = await pool.query(
    `select communication.id,communication.template,communication.category,communication.state,communication.provider_message_id,
            communication.last_error_redacted,communication.accepted_at,communication.delivered_at,communication.created_at,
            coalesce(json_agg(json_build_object('attemptNumber',attempt.attempt_number,'outcome',attempt.outcome,'error',attempt.error_redacted,'startedAt',attempt.started_at)) filter (where attempt.id is not null),'[]') attempts
     from communications communication left join email_outbox outbox on outbox.communication_id=communication.id left join email_attempts attempt on attempt.outbox_id=outbox.id
     where communication.lead_id=$1 group by communication.id order by communication.created_at desc`,
    [leadId]
  );
  response.json({ data: result.rows });
}));

adminLeadsRouter.get("/enquiries", asyncHandler(async (_request, response) => {
  const staff = getStaff(response);
  if (staff.role === "VIEWER") throw new AppError(403, "FORBIDDEN", "Viewers cannot access enquiry snapshots");
  const scope = scopeSql(staff, "lead");
  const result = await pool.query(
    `select enquiry.*,coalesce(json_agg(candidate.lead_id) filter (where candidate.lead_id is not null),'[]') candidate_lead_ids
     from enquiries enquiry left join enquiry_candidates candidate on candidate.enquiry_id=enquiry.id
     left join leads lead on lead.id=candidate.lead_id or lead.id=enquiry.lead_id
     where enquiry.reconciliation_pending=true and (${scope.clause})
     group by enquiry.id order by enquiry.submitted_at desc limit 100`,
    scope.values
  );
  response.json({ data: result.rows });
}));

adminLeadsRouter.post("/enquiries/:id/reconcile", asyncHandler(async (request, response) => {
  const enquiryId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  const input = reconcileSchema.parse(request.body);
  await assertLeadAccess(input.leadId, staff, true);
  await transaction(async (client) => {
    const version = await client.query<{ version: number }>("select version from leads where id=$1 for update", [input.leadId]);
    if (version.rows[0]?.version !== input.expectedVersion) throw new AppError(409, "STALE_VERSION", "The lead changed; refresh and resolve the conflict");
    const updated = await client.query("update enquiries set lead_id=$2,reconciliation_pending=false,reconciled_at=now(),reconciled_by=$3 where id=$1 and reconciliation_pending=true returning id", [enquiryId, input.leadId, staff.userId]);
    if (!updated.rows[0]) throw new AppError(409, "ALREADY_RECONCILED", "This enquiry has already been reconciled");
    await client.query("update consent_events set lead_id=$2 where enquiry_id=$1", [enquiryId, input.leadId]);
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "ENQUIRY_RECONCILED", targetType: "ENQUIRY", targetId: enquiryId, requestId: response.locals.requestId, metadata: { leadId: input.leadId } });
  });
  response.json({ reconciled: true });
}));
