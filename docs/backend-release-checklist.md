# Backend Release Checklist

The implementation is not ready for live use until every required gate has evidence, an owner, and a date.

## Code and data

- Local evidence (2026-09-10): backend `npm ci`, `npm run check`, `npm run auth:schema`, and `npm audit --omit=dev --audit-level=high` passed; frontend `npm ci` and `npm run build` passed. Ten backend tests ran; three PostgreSQL tests were skipped because Docker/PostgreSQL was unavailable.
- Dependency triage: no high/critical production finding; four moderate findings are confined to the Drizzle CLI's development-only esbuild chain. The suggested npm remediation is a breaking Drizzle Kit downgrade and requires upstream resolution or a separately validated toolchain change.
- [ ] `npm ci`, typecheck, lint, build, migration on empty PostgreSQL, second no-op migration, tests, audit, and secret scan pass in CI.
- [ ] Real PostgreSQL tests cover concurrent idempotency, repeat enquiry, rollback, constraints, worker lease recovery, and scoped authorization.
- [ ] Application and migration database roles are distinct; app role cannot alter schema.
- [ ] Production secrets are generated in the secret manager; no development placeholder remains.
- [ ] Data and backup encryption keys have separately tested recovery procedures.

## Identity and browser

- [ ] Trusted origins are exact HTTPS origins; preview origins use isolated non-production services.
- [ ] The fixed Render hostname in `frontend/vercel.json` matches the provisioned API service, and public `/api` plus `/admin` routing is tested after deployment.
- [ ] Owner bootstrap completed, password removed from transient channels, MFA enrolled, recovery codes secured.
- [ ] OWNER, assigned ADVISOR, explicitly granted VIEWER, disabled user, revoked session, partial-MFA, CSRF, 401, 403/404, 409, 429, and 503 paths pass in a real browser.
- [ ] Desktop, mobile, keyboard, loading, empty, expired-session, stale-edit, and worker-failure states are visually verified.

## Email

- [ ] Sender domain ownership and provider verification are complete.
- [ ] SPF, DKIM, and DMARC records are verified from the provider and DNS, not merely configured locally.
- [ ] Monitored Reply-To and fixed test recipient are approved.
- [ ] Signed webhook endpoint passes real provider replay, duplicate, out-of-order, bounce, and complaint tests.
- [ ] Worker heartbeat, queue-age, dead-letter, and ambiguous-outcome alerts are connected and tested.
- [ ] Crash-after-send reconciliation runbook has an assigned operator.

## Documents and privacy

- [ ] S3-compatible bucket is private, TLS-only, encrypted, versioned, least-privilege, and tested for denied public access.
- [ ] Production scanner is configured; clean, infected, oversized, non-PDF, quarantined, wrong-lead, and exact-version cases pass.
- [ ] Staff-approved engagement PDF and external signature/payment evidence procedures are approved.
- [ ] Draft retention policy has approved periods, holds, automatic-deletion decision, and owner sign-off.
- [ ] Subject export isolation, one-time expiry, erasure, provider limitation, backup expiry, and deletion-ledger reconciliation are exercised.

## Recovery and launch

- [ ] Managed PostgreSQL backup schedule and retention are explicitly enabled and inspected.
- [ ] Encrypted offsite logical backup and S3 object version/checksum strategy are operational.
- [ ] Restore to a new isolated database passes counts, constraints, sample document checksums, auth, and deletion-ledger reconciliation.
- [ ] Measured restore duration and accepted recovery objectives are recorded.
- [ ] Render plans/limits, service region, database capacity, connection limits, worker availability, and object/email quotas are reviewed against current provider documentation.
- [ ] Authorized staging flow passes enquiry → Mailpit/provider acceptance → qualification → approved engagement → signature/payment records → conversion.
- [ ] Rollback artifact and schema-compatible worker version are identified before traffic switch.
- [ ] Explicit launch authorization is recorded. No paid provisioning, deployment, real email, import, or production traffic switch is performed by the implementation session.
