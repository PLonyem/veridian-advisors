# Backend Runbook

## Component map

| Component | Provider | Root | Install/build/start | Health | Dependencies |
|---|---|---|---|---|---|
| Public marketing site | Vercel | `frontend` | `npm ci`; `npm run build` | public page and proxied `/api/v1/public-config` | fixed Render API destination |
| Admin, API, auth | Render web | `veridian-backend` | `npm ci`; `npm run build`; `npm start` | `/health/live`, `/health/ready` | PostgreSQL, private S3, scanner, email provider |
| Email worker | Render worker | `veridian-backend` | `npm ci`; `npm run build`; `npm run start:worker` | Protected worker heartbeat via `/api/v1/admin/email/health` | PostgreSQL, private S3, email provider |
| Schema release | Render pre-deploy | `veridian-backend` | `npm ci`; `npm run db:migrate` | migration exit code | PostgreSQL migration role |
| PostgreSQL | Render PostgreSQL | n/a | managed service | API readiness query | backups and restore policy |
| Engagement objects | S3-compatible service | n/a | private bucket | provider-specific | versioning, lifecycle, encryption |

The established static site remains in `frontend/`. The backend's `public/` directory contains only staff dashboard assets. Configure Vercel with root `frontend`; configure Render from the repository-root blueprint, which selects `veridian-backend` for API and worker services.

## Local development (PowerShell)

Prerequisites: Node.js 20.19+, npm, Docker Desktop with Compose.

```powershell
Set-Location veridian-backend
Copy-Item .env.example .env
# Replace development placeholders as desired; never commit .env.
docker compose up -d
npm ci
npm run db:migrate
npm run db:migrate
npm run owner:bootstrap
npm run dev
```

Start the worker in another `veridian-backend` terminal:

```powershell
npm run dev:worker
```

Start the preserved frontend in a third terminal:

```powershell
Set-Location frontend
npm ci
npm run dev
```

Open:

- Public marketing site and intake: `http://localhost:3000` after running `npm ci; npm run dev` from `frontend/`
- Staff dashboard: `http://localhost:5000/admin`
- Mailpit: `http://localhost:8025`
- MinIO Console: `http://localhost:9001`

The second migration command must report success without applying a duplicate migration. On Unix-like systems, the commands are the same except `cp .env.example .env`.

## Local verification

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Run PostgreSQL integration tests only against the isolated test database:

```powershell
$env:NODE_ENV = 'test'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:MIGRATION_DATABASE_URL = $env:TEST_DATABASE_URL
$env:RUN_DB_TESTS = 'true'
npm run db:test:reset
npm run db:migrate
npm test
```

`db:test:reset` refuses to run unless `NODE_ENV=test`, the target differs from `DATABASE_URL`, and the database name contains `test`.

## Owner bootstrap and MFA

```powershell
npm run owner:bootstrap
```

The command refuses to create a second owner and reads the password without echo in an interactive terminal. For controlled automation only, pipe the password and add `--password-stdin`; do not place it in shell history or environment variables. Sign in at `/admin`, enroll TOTP, and store recovery codes in an approved password manager. Production lead access remains blocked until `twoFactorEnabled` is true.

Owners provision additional staff through `POST /api/v1/admin/staff`. Disabling an account deletes every active database session immediately. Password reset requests use Better Auth's single-use expiring token and the durable outbox.

## Same-origin auth routing

Supported production layout:

```text
https://www.example.com/               Vercel public surface
https://www.example.com/api/*          fixed Vercel rewrite to Render API
https://api.example.com/admin          Render staff surface
https://api.example.com/api/auth/*     Better Auth on the staff origin
```

Set `PUBLIC_SITE_URL=https://www.example.com`, and set `ADMIN_APP_URL` plus `API_BASE_URL` to `https://api.example.com`. `TRUSTED_ORIGINS` contains the exact backend staff origin; add the public origin only if cookie-authenticated endpoints are deliberately exposed through that fixed proxy and tested. Better Auth cookies are HttpOnly, Secure in production, and host-only on the backend origin. No token is stored in browser storage.

`frontend/vercel.json` uses a fixed external rewrite for `/api/:path*` and an external `/admin` redirect. Confirm its checked Render hostname after service creation; do not interpolate a request-supplied destination. Preview deployments must target isolated non-production data and credentials, and production must not trust wildcard preview origins.

## Database roles and release

The migration URL is the schema owner. Create a separate application role and grant DML/default privileges before release, using secrets from the provider's secret manager:

```sql
CREATE ROLE veridian_app LOGIN PASSWORD '<generated-secret>';
GRANT CONNECT ON DATABASE veridian TO veridian_app;
GRANT USAGE ON SCHEMA public TO veridian_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO veridian_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO veridian_app;
ALTER DEFAULT PRIVILEGES FOR ROLE veridian_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO veridian_app;
ALTER DEFAULT PRIVILEGES FOR ROLE veridian_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO veridian_app;
```

Set `MIGRATION_DATABASE_URL` to the owner and `DATABASE_URL` to the app role. Production migration refuses to use the application URL. Render's web `preDeployCommand` serializes migration before API replacement; the worker does not run migrations. Use expand/contract schema changes: deploy additive schema, deploy compatible code, backfill, then remove old schema in a later release.

## Email operations

Development uses SMTP at Mailpit. Production sets `EMAIL_PROVIDER=resend`, verified `EMAIL_FROM`, monitored `MONITORED_REPLY_TO`, `RESEND_API_KEY`, and `RESEND_WEBHOOK_SECRET`. Register `POST /api/webhooks/resend` for sent/delivered/bounced/complained/failed events.

`/api/v1/admin/email/health` exposes only provider name, queue counts/age, and worker heartbeat. The owner-only test action sends only to `EMAIL_TEST_RECIPIENT`. It never accepts an arbitrary recipient.

Resend idempotency is documented as 24 hours. A process crash after provider acceptance but before database finalization is retried with the same key inside that window. Beyond it, operators compare provider message IDs and event history before retrying. SMTP timeout/reset outcomes become `UNKNOWN`; do not retry them automatically.

## Document operations

The bucket must block all public access, require TLS, enable provider-side encryption and object versioning, and limit credentials to this bucket/prefix. Production requires `SCANNER_ADAPTER=clamav` and reachable `CLAMAV_HOST`/`CLAMAV_PORT`. The development scanner performs only PDF signature/type checks and production configuration rejects it.

Downloads require fresh staff authorization and return a 60-second signed URL. Email attachments are fetched by opaque key only after state `APPROVED`; the exact sent document ID/checksum remains attached to communication history.

## Retention and privacy

Preview retention without mutation:

```powershell
npm run privacy:retention
```

Execution remains refused while `config/retention-policy.draft.json` is draft or automatic deletion is false. Approval periods are an owner/legal policy decision, not supplied by the software. Holds prevent privacy execution. Erasure reports external provider follow-up rather than claiming provider copies disappeared.

Read-only legacy import defaults to dry run:

```powershell
npm run legacy:import -- --source=C:\path\legacy.sqlite
npm run legacy:import -- --source=C:\path\legacy.sqlite --execute
```

The importer never changes the SQLite source, hashes it for repeatability, and flags legacy Signed, Converted, and Archived records for review rather than inventing signature/payment evidence.

## Backup and restore

Create a locally encrypted logical backup with the separate `BACKUP_ENCRYPTION_KEY`:

```powershell
npm run backup:create
```

Move the resulting `.enc` artifact to approved encrypted offsite storage. Database backups do not include S3 objects; maintain object version retention and a separately exported checksum manifest. Store backup and data-encryption key recovery material outside the application environment with dual-control access.

Verify only into a newly created isolated database whose name contains `restore`:

```powershell
$env:RESTORE_DATABASE_URL = 'postgresql://.../veridian_restore'
npm run backup:verify -- --file=backups\veridian-<timestamp>.dump.enc
```

After restore, compare relational counts, sample approved document SHA-256 values, and apply `deletion_ledger` reconciliation before allowing any restored data to serve traffic. Never overwrite production for a restore drill. Record measured start/end times in the release evidence; no RTO/RPO is claimed until exercised.

## Alerts

Create actionable alerts for:

- `/health/ready` failing twice over two minutes: page API operator.
- No worker heartbeat for two lease periods: page messaging operator.
- Oldest queued/retry message over 10 minutes: warn; over 30 minutes: page.
- `FAILED` count growth or any `UNKNOWN` SMTP outcome: create manual review incident.
- Repeated webhook signature failures: security warning without logging payload/signature.
- Scanner unavailable or rejected-document growth: block sends and notify operations.
- Database backup failure, missing offsite copy, or failed restore drill: page owner; do not claim recoverability.

## Rollback

Roll back application and worker to the previous artifact only when it is compatible with the current expanded schema. Do not reverse a migration automatically. Stop the worker first if the old version cannot understand new queue states. Restore traffic to the previous web artifact, verify readiness, then resume the compatible worker. Data recovery uses an isolated restore and reviewed cutover, never an in-place destructive restore.
