import { Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";
import { assertLeadAccess, getStaff } from "../authz.js";
import { config } from "../config.js";
import { pool } from "../db/client.js";
import { transaction } from "../db/transaction.js";
import { staffCreateSchema, uuid } from "../domain/schemas.js";
import { queueEmail } from "../email/queue.js";
import { AppError, asyncHandler } from "../http/errors.js";
import { sha256 } from "../security/hash.js";
import { audit } from "../services/audit.js";

export const operationsRouter = Router();

operationsRouter.get("/session", (_request, response) => {
  const staff = getStaff(response);
  response.json({ user: { id: staff.userId, name: staff.name, email: staff.email, role: staff.role, twoFactorEnabled: staff.twoFactorEnabled } });
});

operationsRouter.get("/staff", asyncHandler(async (_request, response) => {
  const staff = getStaff(response);
  if (staff.role !== "OWNER") throw new AppError(403, "FORBIDDEN", "Only owners can manage staff");
  const result = await pool.query(
    `select account.id,account.name,account.email,profile.role,account."twoFactorEnabled" as two_factor_enabled,
            profile.disabled_at,profile.created_at
     from staff_profiles profile join "user" account on account.id=profile.user_id order by profile.created_at`,
  );
  response.json({ data: result.rows });
}));

operationsRouter.post("/staff", asyncHandler(async (request, response) => {
  const owner = getStaff(response);
  if (owner.role !== "OWNER") throw new AppError(403, "FORBIDDEN", "Only owners can provision staff");
  const input = staffCreateSchema.parse(request.body);
  const created = await auth.api.createUser({
    body: { email: input.email, password: input.password, name: input.name, role: input.role === "OWNER" ? "admin" : "user" },
    headers: fromNodeHeaders(request.headers)
  });
  try {
    await transaction(async (client) => {
      await client.query("insert into staff_profiles (user_id,role) values ($1,$2)", [created.user.id, input.role]);
      await audit(client, { actorId: owner.userId, actorType: "STAFF", action: "STAFF_PROVISIONED", targetType: "STAFF", targetId: created.user.id, requestId: response.locals.requestId, metadata: { role: input.role } });
    });
  } catch (error) {
    await auth.api.removeUser({ body: { userId: created.user.id }, headers: fromNodeHeaders(request.headers) }).catch(() => undefined);
    throw error;
  }
  response.status(201).json({ user: { id: created.user.id, email: created.user.email, name: created.user.name, role: input.role } });
}));

operationsRouter.post("/staff/:id/disable", asyncHandler(async (request, response) => {
  const owner = getStaff(response);
  if (owner.role !== "OWNER") throw new AppError(403, "FORBIDDEN", "Only owners can disable staff");
  const userId = String(request.params.id);
  if (userId === owner.userId) throw new AppError(409, "SELF_DISABLE_FORBIDDEN", "Use another owner account for this action");
  await transaction(async (client) => {
    const updated = await client.query("update staff_profiles set disabled_at=now(),updated_at=now() where user_id=$1 and disabled_at is null returning user_id", [userId]);
    if (!updated.rowCount) throw new AppError(404, "NOT_FOUND", "Staff account not found");
    await client.query("delete from session where \"userId\"=$1", [userId]);
    await audit(client, { actorId: owner.userId, actorType: "STAFF", action: "STAFF_DISABLED", targetType: "STAFF", targetId: userId, requestId: response.locals.requestId });
  });
  response.json({ disabled: true });
}));

operationsRouter.get("/email/health", asyncHandler(async (_request, response) => {
  const staff = getStaff(response);
  if (staff.role !== "OWNER") throw new AppError(403, "FORBIDDEN", "Only owners can view provider health");
  const [queues, heartbeat] = await Promise.all([
    pool.query("select state,count(*)::int count,min(created_at) oldest from email_outbox group by state order by state"),
    pool.query("select worker_id,last_seen_at,metadata from worker_heartbeats order by last_seen_at desc limit 10")
  ]);
  response.json({ provider: config.EMAIL_PROVIDER, configured: config.EMAIL_PROVIDER === "smtp" || Boolean(config.RESEND_API_KEY), queues: queues.rows, workers: heartbeat.rows });
}));

operationsRouter.post("/email/test", asyncHandler(async (request, response) => {
  const staff = getStaff(response);
  if (staff.role !== "OWNER") throw new AppError(403, "FORBIDDEN", "Only owners can test email configuration");
  const key = request.get("idempotency-key");
  if (!key || key.length < 16) throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key is required");
  await transaction(async (client) => {
    await queueEmail(client, { jobKey: `config-test:${sha256(key)}`, recipientType: "CONFIGURED_TEST", recipientRef: "configured-test", recipientEmail: config.EMAIL_TEST_RECIPIENT, template: "CONFIG_TEST", variables: {}, category: "TRANSACTIONAL", createdBy: staff.userId, priority: 20 });
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "EMAIL_TEST_QUEUED", targetType: "EMAIL_PROVIDER", targetId: config.EMAIL_PROVIDER, requestId: response.locals.requestId });
  });
  response.status(202).json({ queued: true, recipient: "configured test recipient" });
}));

operationsRouter.post("/communications/:id/retry", asyncHandler(async (request, response) => {
  const communicationId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  const result = await pool.query<{ lead_id: string | null; category: string; state: string }>("select lead_id,category,state from communications where id=$1", [communicationId]);
  const communication = result.rows[0];
  if (!communication) throw new AppError(404, "NOT_FOUND", "Communication not found");
  if (communication.lead_id) await assertLeadAccess(communication.lead_id, staff, true);
  if (communication.state !== "FAILED") throw new AppError(409, "INVALID_MESSAGE_STATE", "Only failed messages can be retried; unknown SMTP outcomes require manual reconciliation");
  await transaction(async (client) => {
    const updated = await client.query(
      `update email_outbox set state='RETRY_SCHEDULED',next_attempt_at=now(),last_error_redacted=null,updated_at=now()
       where communication_id=$1 and state='FAILED' and payload_encrypted is not null and (expires_at is null or expires_at>now()) returning id`,
      [communicationId]
    );
    if (!updated.rowCount) throw new AppError(409, "MESSAGE_NOT_RETRYABLE", "Message payload is unavailable or expired");
    await client.query("update communications set state='RETRY_SCHEDULED',last_error_redacted=null,updated_at=now() where id=$1", [communicationId]);
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "MESSAGE_RETRY_AUTHORIZED", targetType: "COMMUNICATION", targetId: communicationId, requestId: response.locals.requestId });
  });
  response.status(202).json({ queued: true });
}));

operationsRouter.post("/communications/:id/cancel", asyncHandler(async (request, response) => {
  const communicationId = uuid.parse(request.params.id);
  const staff = getStaff(response);
  const result = await pool.query<{ lead_id: string | null; state: string }>("select lead_id,state from communications where id=$1", [communicationId]);
  const communication = result.rows[0];
  if (!communication) throw new AppError(404, "NOT_FOUND", "Communication not found");
  if (communication.lead_id) await assertLeadAccess(communication.lead_id, staff, true);
  await transaction(async (client) => {
    const updated = await client.query("update email_outbox set state='CANCELLED',payload_encrypted=null,updated_at=now() where communication_id=$1 and state in ('QUEUED','RETRY_SCHEDULED') returning id", [communicationId]);
    if (!updated.rowCount) throw new AppError(409, "MESSAGE_NOT_CANCELLABLE", "Message is already processing or terminal");
    await client.query("update communications set state='CANCELLED',updated_at=now() where id=$1", [communicationId]);
    await audit(client, { actorId: staff.userId, actorType: "STAFF", action: "MESSAGE_CANCELLED", targetType: "COMMUNICATION", targetId: communicationId, requestId: response.locals.requestId });
  });
  response.json({ cancelled: true });
}));
