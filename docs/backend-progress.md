# Backend Progress

Last updated: 2026-09-10

## Phase 0 — Complete

- The supplied local workspace was initially empty and non-Git. During GitHub handoff, fetched the target repository and discovered the established `frontend/` package plus legacy `veridian-backend/` history.
- Preserved and integrated the existing marketing frontend, replaced the legacy backend in place under `veridian-backend/`, and retained backend `/admin` as the focused staff location because no prior admin interface existed.
- Selected current compatible versions from official documentation and npm metadata. Better Auth CLI generation succeeds through the Drizzle adapter; its generated schema was reviewed and the checked schema intentionally keeps timestamptz plus the established column names.
- Baseline check: no pre-existing command existed.

## Phase 1 — Implemented; live database checks blocked locally

- Added 33-table PostgreSQL/Drizzle domain and auth schema, three migrations, constraints, foreign keys, indexes, app schema marker, package configuration, append-only triggers, enquiry snapshot trigger, and consultation overlap exclusion.
- Added PostgreSQL/Mailpit/MinIO Compose services, environment validation, release migration, safe test reset, synthetic seed, startup readiness, and bounded shutdown.
- `npm run db:generate`: passed and generated all three migrations.
- Migration-on-empty, second no-op, rollback, and locking tests are implemented for CI but were not executed locally because Docker/PostgreSQL is not installed.

## Phase 2 — Implemented; live auth flow blocked locally

- Better Auth email/password, disabled public sign-up, owner/admin provisioning, TOTP/recovery codes, session revocation, password reset outbox, shared PostgreSQL rate limiting, trusted origins, host-only cookies, and role/scope middleware are implemented.
- Added hidden-input one-time owner bootstrap and same-origin login/MFA/enrollment/logout UI.
- HTTP test confirmed an untrusted-origin auth mutation returns 403. Full account/session tests await PostgreSQL.

## Phase 3 — Implemented

- Added strict public intake, compatibility adapter, canonical enum mapping, durable atomic receipt/outbox, candidate reconciliation, generic receipts, rate limits, honeypot, and staff lead APIs.
- Unit tests confirmed Unicode mapping, strict boolean consent, object/unknown field rejection, safe 400 envelopes, and liveness.
- Concurrent idempotency and repeat-lead PostgreSQL tests exist but were skipped locally because `RUN_DB_TESTS` could not be enabled without PostgreSQL.

## Phase 4 — Implemented; provider demonstration blocked locally

- Added SMTP/Mailpit and Resend adapters, leased SKIP LOCKED worker, fencing, attempts, backoff, terminal/unknown outcomes, encrypted payloads, all requested templates, signed Resend webhook processing, suppression, health, test, retry, and cancel actions.
- Dispatch now rechecks current archive/rejection/suppression state, expires unsent messages, and fences both acceptance and failure writes. PostgreSQL CI coverage exercises concurrent claims, ordered stage progression, cancellation, expiry, and stale leases.
- Template tests confirmed escaping, accurate positioning, no invented SLA, and URL-origin validation.
- Mailpit demonstration, concurrent-worker DB tests, and real webhook delivery were not executed because Docker and provider credentials are unavailable.

## Phase 5 — Implemented

- Implemented all specified qualification, follow-up, engagement, document, signature, payment, and conversion routes with assignment checks, expected versions, action idempotency, audit/outbox transactions, PDF checks, scanning gates, and exact document references.
- Consultation schema and overlap constraint exist, but routes are intentionally unavailable while the feature flag is false.
- Synthetic enquiry-to-conversion execution awaits the local service stack.

## Phase 6 — Implemented; visual browser verification pending

- No dashboard existed. Added a focused backend-origin `/admin` interface and connected real session, KPI, paginated lead, detail, timeline, notes, outreach, qualification, engagement/document, signature/payment, conversion, archive/restore, communication retry/cancel, reconciliation, staff, email-health, and privacy controls.
- Added stable retry keys for message actions, loading/empty/error states, stale-form preservation, safe staff-email deep links, and sensitive dashboard clearing on logout.
- Wired the preserved `frontend/` enquiry form to the compatibility API with retry-safe keys, strict consent mapping, separate optional marketing consent, honeypot, accessible errors, and server-driven notice version/package pricing.
- Source is responsive and keyboard-operable by construction; desktop/mobile visual and full browser-flow verification were not executed in this terminal session.

## Phase 7 — Implemented; recovery exercise pending

- Added verified owner privacy requests, separate action types, expiring encrypted one-time exports, coordinated erasure and deletion ledger, draft retention policy and dry-run tool, read-only SQLite importer, and encrypted isolated restore tooling.
- No old SQLite database was present. No `pg_dump`, database, object store, or backup target was available, so import/restore timing is unmeasured.

## Phase 8 — Implemented with external gates open

- Added deterministic lockfile workflow, typecheck, lint, build, clean migration/no-op migration, PostgreSQL integration tests, dependency audit, and gitleaks CI.
- Added minimal liveness/readiness, protected queue/provider diagnostics, worker heartbeats, Render web/worker/PostgreSQL blueprint, runbook, release checklist, and OpenAPI.
- Local backend results from `veridian-backend/`: `npm ci` passed; `npm run check` passed typecheck, lint, YAML/OpenAPI validation, build, and 10 tests with 3 PostgreSQL tests skipped; `npm run auth:schema` passed against the official adapter.
- Local frontend results from `frontend/`: deterministic `npm ci` and the existing minified production `npm run build` passed after intake integration.
- `npm audit --omit=dev --audit-level=high` passed with no high/critical production findings. Four moderate advisories remain in the development-only Drizzle CLI dependency chain; npm's proposed fix is a breaking downgrade and was not applied blindly.
- Docker/PostgreSQL, Mailpit, MinIO, a browser session, provider credentials, and backup infrastructure were unavailable locally, so all checklist items requiring those systems remain explicitly unverified.
- Not ready for live use until the release checklist's infrastructure, MFA, sender-domain, scanner, backup/restore, approved document, retention policy, staging browser flow, and real PostgreSQL checks pass.

## Changed paths

`frontend/`, `veridian-backend/`, `docs/`, `.github/workflows/ci.yml`, root `README.md`, `.gitignore`, and `render.yaml`.
