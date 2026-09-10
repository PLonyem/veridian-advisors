import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "../config.js";
import { pool } from "../db/client.js";
import { stageRank, type LeadStage } from "../domain/constants.js";
import { logger } from "../logger.js";
import { decryptJson } from "../security/encryption.js";
import { keyedHash } from "../security/hash.js";
import { getPrivateObject } from "../storage/s3.js";
import { createEmailProvider, ProviderFailure, type EmailProvider } from "./provider.js";
import { renderTemplate, type TemplateName, type TemplateVariables } from "./templates.js";

type ClaimedJob = {
  id: string;
  communication_id: string;
  job_key: string;
  payload_encrypted: { version: string; nonce: string; ciphertext: string };
  attempts: number;
  lease_token: string;
  expires_at: Date | null;
};

type Communication = {
  id: string;
  lead_id: string | null;
  document_id: string | null;
  recipient_email: string;
  template: TemplateName;
  category: string;
};

export class EmailWorker {
  private stopping = false;
  private active = 0;
  private readonly workerId = `${process.pid}-${randomUUID()}`;

  constructor(private readonly provider: EmailProvider = createEmailProvider()) {}

  async claim(): Promise<ClaimedJob[]> {
    await pool.query(
      `with expired as (
         update email_outbox set state='FAILED',payload_encrypted=null,last_error_redacted='Message expired before dispatch',updated_at=now()
         where state in ('QUEUED','RETRY_SCHEDULED') and expires_at<=now()
         returning communication_id
       )
       update communications set state='FAILED',last_error_redacted='Message expired before dispatch',updated_at=now()
       where id in (select communication_id from expired)`
    );
    const leaseToken = randomUUID();
    const result = await pool.query<ClaimedJob>(
      `with candidates as (
         select id from email_outbox
         where (
           (state in ('QUEUED','RETRY_SCHEDULED') and next_attempt_at <= now())
           or (state = 'PROCESSING' and lease_expires_at < now())
         )
         and (expires_at is null or expires_at > now())
         order by priority desc, next_attempt_at asc, id asc
         for update skip locked
         limit $1
       )
       update email_outbox outbox
       set state='PROCESSING', lease_owner=$2, lease_token=$3,
           lease_expires_at=now()+($4::text || ' seconds')::interval,
           attempts=attempts+1, updated_at=now()
       from candidates where outbox.id=candidates.id
       returning outbox.id, outbox.communication_id, outbox.job_key, outbox.payload_encrypted,
                 outbox.attempts, outbox.lease_token, outbox.expires_at`,
      [config.WORKER_BATCH_SIZE, this.workerId, leaseToken, config.WORKER_LEASE_SECONDS]
    );
    return result.rows;
  }

  private async loadCommunication(job: ClaimedJob): Promise<Communication> {
    const result = await pool.query<Communication>(
      `select id, lead_id, document_id, recipient_email, template, category from communications where id=$1`,
      [job.communication_id]
    );
    if (!result.rows[0]) throw new ProviderFailure("permanent", "Communication no longer exists");
    return result.rows[0];
  }

  private async attachment(documentId: string | null): Promise<{ filename: string; content: Buffer } | undefined> {
    if (!documentId) return undefined;
    const result = await pool.query<{ object_key: string; state: string; size_bytes: string }>(
      "select object_key, state, size_bytes from documents where id=$1 and deleted_at is null",
      [documentId]
    );
    const document = result.rows[0];
    if (!document || document.state !== "APPROVED") throw new ProviderFailure("permanent", "Approved attachment is unavailable");
    if (Number(document.size_bytes) > config.MAX_PDF_BYTES) throw new ProviderFailure("permanent", "Attachment exceeds configured limit");
    return { filename: "veridian-engagement.pdf", content: await getPrivateObject(document.object_key) };
  }

  private async cancelIfDispatchForbidden(job: ClaimedJob, communication: Communication): Promise<boolean> {
    if (communication.category !== "DISCRETIONARY") return false;
    const allowed = await pool.query(
      `select 1 from communications communication
       left join leads lead on lead.id=communication.lead_id
       where communication.id=$1
         and (lead.id is null or (lead.archived_at is null and lead.pipeline_stage not in ('REJECTED','CONVERTED')))
         and not exists (select 1 from email_suppressions where recipient_hash=$2)`,
      [communication.id, keyedHash(communication.recipient_email.toLowerCase())]
    );
    if (allowed.rowCount) return false;
    const client = await pool.connect();
    try {
      await client.query("begin");
      const fenced = await client.query(
        `update email_outbox set state='CANCELLED',payload_encrypted=null,lease_owner=null,lease_token=null,lease_expires_at=null,
           last_error_redacted='Dispatch cancelled by current lead or suppression state',updated_at=now()
         where id=$1 and lease_token=$2 and state='PROCESSING'`,
        [job.id, job.lease_token]
      );
      if (fenced.rowCount === 1) await client.query("update communications set state='CANCELLED',updated_at=now() where id=$1", [communication.id]);
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async advanceLead(client: PoolClient, communication: Communication, providerMessageId: string): Promise<void> {
    if (!communication.lead_id) return;
    const desired = communication.template === "PRE_VETTING" ? "QUALIFICATION_PENDING" : communication.template === "ENGAGEMENT_DELIVERY" ? "ENGAGEMENT_SENT" : communication.template === "FOLLOW_UP" ? "CONTACTED" : null;
    if (!desired) return;
    const result = await client.query<{ pipeline_stage: LeadStage; version: number }>("select pipeline_stage, version from leads where id=$1 for update", [communication.lead_id]);
    const lead = result.rows[0];
    if (!lead || lead.pipeline_stage === "REJECTED" || lead.pipeline_stage === "CONVERTED") return;
    const path: Array<"CONTACTED" | "QUALIFICATION_PENDING" | "ENGAGEMENT_SENT"> = communication.template === "PRE_VETTING" && lead.pipeline_stage === "NEW"
      ? ["CONTACTED", "QUALIFICATION_PENDING"]
      : communication.template === "PRE_VETTING" && lead.pipeline_stage === "CONTACTED"
        ? ["QUALIFICATION_PENDING"]
        : communication.template === "FOLLOW_UP" && lead.pipeline_stage === "NEW"
          ? ["CONTACTED"]
          : communication.template === "ENGAGEMENT_DELIVERY" && lead.pipeline_stage === "QUALIFIED"
            ? ["ENGAGEMENT_SENT"]
            : [];
    let currentStage = lead.pipeline_stage;
    let currentVersion = lead.version;
    for (const nextStage of path) {
      if (stageRank[nextStage] <= stageRank[currentStage as Exclude<LeadStage, "REJECTED">]) continue;
      await client.query("update leads set pipeline_stage=$2, version=version+1, updated_at=now() where id=$1", [communication.lead_id, nextStage]);
      await client.query(
        `insert into status_history (lead_id, from_stage, to_stage, actor_type, reason, triggering_event_id, from_version, to_version)
         values ($1,$2,$3,'SYSTEM','Email provider accepted workflow message',$4,$5,$6)`,
        [communication.lead_id, currentStage, nextStage, providerMessageId, currentVersion, currentVersion + 1]
      );
      currentStage = nextStage;
      currentVersion += 1;
    }
  }

  private async accepted(job: ClaimedJob, communication: Communication, providerMessageId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const fenced = await client.query(
        `update email_outbox set state='PROVIDER_ACCEPTED', provider_message_id=$3, payload_encrypted=null,
           lease_owner=null, lease_token=null, lease_expires_at=null, updated_at=now()
         where id=$1 and lease_token=$2 and state='PROCESSING'`,
        [job.id, job.lease_token, providerMessageId]
      );
      if (fenced.rowCount !== 1) { await client.query("rollback"); return; }
      await client.query(
        `update communications set state='PROVIDER_ACCEPTED', provider_message_id=$2, accepted_at=now(), updated_at=now() where id=$1`,
        [communication.id, providerMessageId]
      );
      if (communication.template === "ENGAGEMENT_DELIVERY") {
        await client.query(
          `update engagements set state='SENT',version=version+1,updated_at=now()
           where id=(select engagement_id from communications where id=$1) and state='QUEUED'`,
          [communication.id]
        );
      }
      await client.query(
        `insert into email_attempts (outbox_id, attempt_number, lease_token, outcome, provider_message_id, started_at)
         values ($1,$2,$3,'ACCEPTED',$4,now())`,
        [job.id, job.attempts, job.lease_token, providerMessageId]
      );
      await this.advanceLead(client, communication, providerMessageId);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async failed(job: ClaimedJob, communication: Communication | null, error: unknown): Promise<void> {
    const failure = error instanceof ProviderFailure ? error : new ProviderFailure("transient", error instanceof Error ? error.message : "Unknown provider error");
    const exhausted = job.attempts >= 5;
    const state = failure.kind === "ambiguous" ? "UNKNOWN" : failure.kind === "permanent" || exhausted ? "FAILED" : "RETRY_SCHEDULED";
    const outcome = failure.kind === "ambiguous" ? "AMBIGUOUS" : failure.kind === "permanent" || exhausted ? "PERMANENT_FAILURE" : "TRANSIENT_FAILURE";
    const delaySeconds = Math.min(3600, 15 * 2 ** Math.max(0, job.attempts - 1)) + Math.floor(Math.random() * 10);
    const redacted = failure.message.replace(/[\w.+-]+@[\w.-]+/g, "[email]").slice(0, 500);
    const client = await pool.connect();
    try {
      await client.query("begin");
      const fenced = await client.query(
        `update email_outbox set state=$3, next_attempt_at=now()+($4::text || ' seconds')::interval,
           last_error_redacted=$5, lease_owner=null, lease_token=null, lease_expires_at=null,
           payload_encrypted=case when $3='UNKNOWN' then null else payload_encrypted end, updated_at=now()
         where id=$1 and lease_token=$2`,
        [job.id, job.lease_token, state, delaySeconds, redacted]
      );
      if (fenced.rowCount !== 1) { await client.query("rollback"); return; }
      await client.query(
        `insert into email_attempts (outbox_id, attempt_number, lease_token, outcome, error_redacted, started_at)
         values ($1,$2,$3,$4,$5,now())`,
        [job.id, job.attempts, job.lease_token, outcome, redacted]
      );
      if (communication) await client.query("update communications set state=$2, last_error_redacted=$3, updated_at=now() where id=$1", [communication.id, state, redacted]);
      await client.query("commit");
    } catch (inner) {
      await client.query("rollback");
      throw inner;
    } finally {
      client.release();
    }
  }

  async process(job: ClaimedJob): Promise<void> {
    let communication: Communication | null = null;
    try {
      communication = await this.loadCommunication(job);
      if (job.expires_at && job.expires_at <= new Date()) throw new ProviderFailure("permanent", "Message expired before dispatch");
      if (await this.cancelIfDispatchForbidden(job, communication)) return;
      const payload = await decryptJson<{ template: TemplateName; variables: TemplateVariables }>(job.payload_encrypted);
      const rendered = renderTemplate(payload.template, payload.variables);
      const attachment = await this.attachment(communication.document_id);
      const result = await this.provider.send({
        idempotencyKey: job.job_key.slice(0, 256),
        to: communication.recipient_email,
        ...rendered,
        ...(attachment ? { attachment } : {})
      });
      await this.accepted(job, communication, result.providerMessageId);
    } catch (error) {
      await this.failed(job, communication, error);
    }
  }

  async tick(): Promise<number> {
    await pool.query(
      `insert into worker_heartbeats (worker_id, last_seen_at, metadata) values ($1,now(),$2)
       on conflict (worker_id) do update set last_seen_at=excluded.last_seen_at, metadata=excluded.metadata`,
      [this.workerId, JSON.stringify({ provider: this.provider.name })]
    );
    const jobs = await this.claim();
    this.active += jobs.length;
    await Promise.all(jobs.map((job) => this.process(job).finally(() => { this.active -= 1; })));
    return jobs.length;
  }

  async run(): Promise<void> {
    while (!this.stopping) {
      const count = await this.tick().catch((error) => { logger.error({ err: error }, "Worker tick failed"); return 0; });
      if (count === 0) await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_MS));
    }
    const deadline = Date.now() + config.WORKER_LEASE_SECONDS * 1000;
    while (this.active > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  }

  stop(): void { this.stopping = true; }
}
