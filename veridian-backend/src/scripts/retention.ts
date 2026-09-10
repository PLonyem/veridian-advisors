import policy from "../../config/retention-policy.draft.json" with { type: "json" };
import { config } from "../config.js";
import { pool, closeDatabase } from "../db/client.js";

const execute = process.argv.includes("--execute");
const batchArg = process.argv.find((item) => item.startsWith("--batch="));
const batch = Math.min(1000, Math.max(1, Number(batchArg?.split("=")[1] ?? 100)));
if (execute && (policy.status !== "APPROVED" || !policy.automaticDeletionEnabled)) {
  throw new Error("Retention execution is disabled until the owner approves the policy");
}
if (config.NODE_ENV === "production" && execute && !process.argv.includes("--reviewed-production-execution")) {
  throw new Error("Production retention execution requires --reviewed-production-execution");
}

const targets = await pool.query(
  `select
    (select count(*) from idempotency_records where expires_at<now())::int expired_idempotency,
    (select count(*) from rate_limit_buckets where expires_at<now())::int expired_rate_limits,
    (select count(*) from privacy_exports where expires_at<now() and payload_encrypted is not null)::int expired_exports,
    (select count(*) from email_outbox where expires_at<now() and payload_encrypted is not null)::int expired_email_payloads`
);
const report = { mode: execute ? "execute" : "dry-run", batch, policyStatus: policy.status, targets: targets.rows[0] };
if (execute) {
  await pool.query("delete from idempotency_records where ctid in (select ctid from idempotency_records where expires_at<now() limit $1)", [batch]);
  await pool.query("delete from rate_limit_buckets where ctid in (select ctid from rate_limit_buckets where expires_at<now() limit $1)", [batch]);
  await pool.query("update privacy_exports set payload_encrypted=null where id in (select id from privacy_exports where expires_at<now() and payload_encrypted is not null limit $1)", [batch]);
  await pool.query("update email_outbox set payload_encrypted=null,state=case when state in ('QUEUED','RETRY_SCHEDULED') then 'CANCELLED' else state end where id in (select id from email_outbox where expires_at<now() and payload_encrypted is not null limit $1)", [batch]);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
await closeDatabase();
