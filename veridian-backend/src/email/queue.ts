import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { encryptJson } from "../security/encryption.js";
import type { TemplateName, TemplateVariables } from "./templates.js";

export async function queueEmail(client: PoolClient, input: {
  jobKey: string;
  leadId?: string;
  engagementId?: string;
  documentId?: string;
  recipientType: "LEAD" | "STAFF" | "CONFIGURED_TEST";
  recipientRef: string;
  recipientEmail: string;
  template: TemplateName;
  variables: TemplateVariables;
  category: "SECURITY" | "TRANSACTIONAL" | "DISCRETIONARY";
  createdBy?: string;
  priority?: number;
  expiresAt?: Date;
}): Promise<{ communicationId: string; outboxId: string }> {
  const communicationId = randomUUID();
  const outboxId = randomUUID();
  const encrypted = await encryptJson({ template: input.template, variables: input.variables });
  await client.query(
    `insert into communications
      (id, lead_id, engagement_id, document_id, recipient_type, recipient_ref, recipient_email, template, template_version, category, state, created_by, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'1',$9,'QUEUED',$10,now(),now())`,
    [communicationId, input.leadId ?? null, input.engagementId ?? null, input.documentId ?? null, input.recipientType, input.recipientRef, input.recipientEmail, input.template, input.category, input.createdBy ?? null]
  );
  await client.query(
    `insert into email_outbox
      (id, communication_id, job_key, payload_encrypted, priority, state, attempts, next_attempt_at, expires_at, created_at, updated_at)
     values ($1,$2,$3,$4,$5,'QUEUED',0,now(),$6,now(),now())`,
    [outboxId, communicationId, input.jobKey, JSON.stringify(encrypted), input.priority ?? 0, input.expiresAt ?? null]
  );
  return { communicationId, outboxId };
}
