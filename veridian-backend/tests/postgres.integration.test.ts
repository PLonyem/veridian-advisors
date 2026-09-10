import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";

const run = process.env.RUN_DB_TESTS === "true";

describe.skipIf(!run)("PostgreSQL integration", () => {
  it("commits idempotent intake and preserves a reviewed lead on repeat contact", async () => {
    const [{ createApp }, { pool }] = await Promise.all([import("../src/app.js"), import("../src/db/client.js")]);
    const app = createApp();
    const publicConfig = await request(app).get("/api/v1/public-config").expect(200);
    expect(publicConfig.body.noticeVersion).toBe("2026-09-01");
    expect(publicConfig.body.packages).toHaveLength(3);
    const email = `fixture-${randomUUID()}@example.test`;
    const payload = { fullName: "Synthetic Fixture", email, country: "NG", netWorthRange: "$1M-$5M", tierInterest: "Not sure", disclaimerAccepted: true, marketingConsent: false, noticeVersion: "2026-09-01" };
    const key = randomUUID();
    const first = await request(app).post("/api/v1/enquiries").set("Idempotency-Key", key).send(payload).expect(202);
    const replay = await request(app).post("/api/v1/enquiries").set("Idempotency-Key", key).send(payload).expect(202);
    expect(replay.body).toEqual(first.body);
    await request(app).post("/api/v1/enquiries").set("Idempotency-Key", key).send({ ...payload, country: "GH" }).expect(409);
    const lead = await pool.query<{ id: string }>("select id from leads where normalized_email=$1", [email]);
    await pool.query("update leads set pipeline_stage='QUALIFIED' where id=$1", [lead.rows[0]!.id]);
    await request(app).post("/api/v1/enquiries").set("Idempotency-Key", randomUUID()).send({ ...payload, fullName: "Anonymous overwrite attempt" }).expect(202);
    const unchanged = await pool.query<{ full_name: string; pipeline_stage: string }>("select full_name,pipeline_stage from leads where id=$1", [lead.rows[0]!.id]);
    expect(unchanged.rows[0]).toMatchObject({ full_name: "Synthetic Fixture", pipeline_stage: "QUALIFIED" });
    const enquiries = await pool.query<{ count: number }>("select count(*)::int count from enquiries where normalized_email=$1", [email]);
    expect(enquiries.rows[0]!.count).toBe(2);
  });

  it("enforces database constraints and transaction rollback", async () => {
    const { pool } = await import("../src/db/client.js");
    await expect(pool.query("insert into service_packages (code,display_name,price_minor,currency) values ('FOUNDATION','bad',-1,'USD')")).rejects.toBeDefined();
    const client = await pool.connect();
    const marker = `rollback-${randomUUID()}@example.test`;
    try {
      await client.query("begin");
      await client.query("insert into leads (full_name,email,normalized_email,country,net_worth_range,tier_interest) values ('Rollback',$1,$1,'NG','USD_1M_5M','NOT_SURE')", [marker]);
      await client.query("rollback");
    } finally { client.release(); }
    const result = await pool.query("select 1 from leads where normalized_email=$1", [marker]);
    expect(result.rowCount).toBe(0);
  });

  it("fences concurrent workers and rechecks dispatch state", async () => {
    const [{ pool }, { queueEmail }, { EmailWorker }] = await Promise.all([
      import("../src/db/client.js"),
      import("../src/email/queue.js"),
      import("../src/email/worker-service.js")
    ]);
    await pool.query("delete from email_outbox");
    await pool.query("delete from communications");
    let sends = 0;
    const provider = {
      name: "resend" as const,
      send: async () => { sends += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { providerMessageId: `provider-${sends}` }; }
    };
    const enqueue = async (input: Parameters<typeof queueEmail>[1]) => {
      const client = await pool.connect();
      try { await client.query("begin"); const queued = await queueEmail(client, input); await client.query("commit"); return queued; }
      catch (error) { await client.query("rollback"); throw error; }
      finally { client.release(); }
    };

    const one = await enqueue({ jobKey: `concurrent-${randomUUID()}`, recipientType: "CONFIGURED_TEST", recipientRef: "test", recipientEmail: "worker@example.test", template: "CONFIG_TEST", variables: {}, category: "TRANSACTIONAL" });
    await Promise.all([new EmailWorker(provider).tick(), new EmailWorker(provider).tick()]);
    expect(sends).toBe(1);
    expect((await pool.query<{ state: string }>("select state from communications where id=$1", [one.communicationId])).rows[0]!.state).toBe("PROVIDER_ACCEPTED");

    const leadEmail = `worker-lead-${randomUUID()}@example.test`;
    const lead = await pool.query<{ id: string }>("insert into leads (full_name,email,normalized_email,country,net_worth_range,tier_interest) values ('Worker Fixture',$1,$1,'NG','USD_1M_5M','FOUNDATION') returning id", [leadEmail]);
    await enqueue({ jobKey: `prevet-${randomUUID()}`, leadId: lead.rows[0]!.id, recipientType: "LEAD", recipientRef: lead.rows[0]!.id, recipientEmail: leadEmail, template: "PRE_VETTING", variables: { fullName: "Worker Fixture" }, category: "DISCRETIONARY" });
    await new EmailWorker(provider).tick();
    const progressed = await pool.query<{ pipeline_stage: string }>("select pipeline_stage from leads where id=$1", [lead.rows[0]!.id]);
    const history = await pool.query<{ to_stage: string }>("select to_stage from status_history where lead_id=$1 order by occurred_at,id", [lead.rows[0]!.id]);
    expect(progressed.rows[0]!.pipeline_stage).toBe("QUALIFICATION_PENDING");
    expect(history.rows.map((item) => item.to_stage)).toEqual(["CONTACTED", "QUALIFICATION_PENDING"]);

    const cancelled = await enqueue({ jobKey: `cancel-${randomUUID()}`, leadId: lead.rows[0]!.id, recipientType: "LEAD", recipientRef: lead.rows[0]!.id, recipientEmail: leadEmail, template: "FOLLOW_UP", variables: { subject: "Check in", message: "Hello" }, category: "DISCRETIONARY" });
    await pool.query("update leads set archived_at=now() where id=$1", [lead.rows[0]!.id]);
    await new EmailWorker(provider).tick();
    expect((await pool.query<{ state: string }>("select state from communications where id=$1", [cancelled.communicationId])).rows[0]!.state).toBe("CANCELLED");

    const expired = await enqueue({ jobKey: `expired-${randomUUID()}`, recipientType: "CONFIGURED_TEST", recipientRef: "test", recipientEmail: "worker@example.test", template: "CONFIG_TEST", variables: {}, category: "SECURITY", expiresAt: new Date(Date.now() - 1000) });
    await new EmailWorker(provider).tick();
    expect((await pool.query<{ state: string }>("select state from communications where id=$1", [expired.communicationId])).rows[0]!.state).toBe("FAILED");

    const fenced = await enqueue({ jobKey: `fenced-${randomUUID()}`, recipientType: "CONFIGURED_TEST", recipientRef: "test", recipientEmail: "worker@example.test", template: "CONFIG_TEST", variables: {}, category: "TRANSACTIONAL" });
    const staleWorker = new EmailWorker(provider);
    const [claimed] = await staleWorker.claim();
    await pool.query("update email_outbox set lease_token=$2 where id=$1", [fenced.outboxId, randomUUID()]);
    await staleWorker.process(claimed!);
    const fencedState = await pool.query<{ outbox_state: string; communication_state: string }>("select outbox.state outbox_state,communication.state communication_state from email_outbox outbox join communications communication on communication.id=outbox.communication_id where outbox.id=$1", [fenced.outboxId]);
    expect(fencedState.rows[0]).toMatchObject({ outbox_state: "PROCESSING", communication_state: "QUEUED" });
  });
});
