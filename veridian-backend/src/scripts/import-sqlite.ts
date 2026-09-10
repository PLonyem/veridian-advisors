import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { pool, closeDatabase } from "../db/client.js";

const sourceArgument = process.argv.find((item) => item.startsWith("--source="));
if (!sourceArgument) throw new Error("Provide --source=<read-only-sqlite-path>");
const sourcePath = resolve(sourceArgument.slice("--source=".length));
const execute = process.argv.includes("--execute");
if (config.NODE_ENV === "production" && execute && !process.argv.includes("--reviewed-production-import")) throw new Error("Production import requires --reviewed-production-import");
const checksum = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
if (execute) {
  const prior = await pool.query("select 1 from import_runs where source_checksum=$1 and dry_run=false", [checksum]);
  if (prior.rowCount) throw new Error("This source checksum was already imported");
}
const source = new DatabaseSync(sourcePath, { readOnly: true });
const tables = source.prepare("select name from sqlite_master where type='table'").all().map((row) => String(row.name));
if (!tables.includes("leads")) throw new Error("Source has no leads table");
const rows = source.prepare("select * from leads").all() as Record<string, unknown>[];
const report = { sourcePath, checksum, mode: execute ? "execute" : "dry-run", sourceLeads: rows.length, imported: 0, conflicts: 0, reviewRequired: 0 };
if (execute) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const row of rows) {
      const email = String(row.email ?? "").trim().toLowerCase();
      if (!email) { report.conflicts += 1; continue; }
      const oldStatus = String(row.status ?? "NEW").toUpperCase();
      const ambiguous = ["SIGNED", "CONVERTED"].includes(oldStatus);
      const archived = oldStatus === "ARCHIVED";
      const mapped = ["NEW", "CONTACTED", "QUALIFICATION_PENDING", "QUALIFIED", "ENGAGEMENT_SENT", "REJECTED"].includes(oldStatus) ? oldStatus : "NEW";
      await client.query(
        `insert into leads (full_name,email,normalized_email,country,net_worth_range,tier_interest,pipeline_stage,archived_at,legacy_review_required,created_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [String(row.name ?? row.full_name ?? "Legacy lead"), String(row.email), email, String(row.country ?? "Unknown"), null, "NOT_SURE", mapped, archived ? new Date() : null, true, row.created_at ? new Date(String(row.created_at)) : new Date(), row.updated_at ? new Date(String(row.updated_at)) : new Date()]
      );
      report.imported += 1;
      if (ambiguous || archived) report.reviewRequired += 1;
    }
    await client.query("insert into import_runs (source_checksum,dry_run,report) values ($1,false,$2)", [checksum, JSON.stringify(report)]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
source.close();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
await closeDatabase();
