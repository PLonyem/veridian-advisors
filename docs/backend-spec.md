# Backend Specification

## Repository contract

The initial local directory supplied on 2026-09-09 was empty. Before GitHub handoff on 2026-09-10, the target repository history was fetched and inspected. It contains an established static site under `frontend/` and a legacy backend under `veridian-backend/`. The rebuild replaces only the legacy backend, preserves the marketing site and its navigation/design system, and integrates its existing intake form. The focused staff interface remains at backend `/admin`; no prior admin UI existed.

## Architecture

- TypeScript ESM on Node.js 20.19 or newer; Express 5.2.1.
- PostgreSQL 17 with Drizzle ORM 0.45.2 and Drizzle Kit 0.31.10. SQL migrations are version controlled under `drizzle/` and run only through `npm run db:migrate`.
- Better Auth 1.7.3 with its Drizzle adapter, email/password, admin, and TOTP/recovery-code plugins. Express mounts its handler before JSON parsing. Public sign-up is disabled.
- Zod 4 strict request validation, Pino structured logs with credential/token redaction, and consistent safe error envelopes.
- API and worker are separate processes over one PostgreSQL outbox. SMTP/Nodemailer targets Mailpit in development; Resend is the production adapter. SMTP acceptance is not represented as delivery.
- Private S3-compatible object storage holds engagement and signed-engagement PDFs. Uploads are bounded, signature checked, hashed, quarantined/scanned, and authorized by lead scope. Production requires ClamAV; the development adapter is explicit and forbidden in production.
- Vercel serves `frontend/` and proxies public `/api/*` requests to a fixed Render destination. The Render API serves `/admin`, `/api`, and Better Auth on its own origin, avoiding cross-site staff cookies and browser-stored credentials. Host-only HttpOnly Better Auth cookies and exact trusted origins are used.

## Product policy

Veridian is a private, independent document preparation consultancy with no government affiliation, legal advice, or approval guarantees. Qualification is a human service-fit review, not an immigration eligibility assessment. Communication is `EMAIL_ONLY`; consultations remain disabled by default.

Editable service configuration is seeded as Foundation USD 7,500, Accelerated USD 25,000, and Executive starting at USD 45,000. Values are integer minor units. A final engagement quote is separate from the indicative package price.

Initial intake collects only name, email, country, approximate net-worth category, tier interest, intake acknowledgement, and separate optional marketing consent. It does not collect exact assets, balances, identification documents, or criminal-history narratives.

## Lifecycle

`NEW → CONTACTED → QUALIFICATION_PENDING → QUALIFIED → ENGAGEMENT_SENT → SIGNED → CONVERTED`. `REJECTED` is available from open stages with a reason. Archive is orthogonal and retains stage. Restore only restores visibility. `CONTACTED`, `QUALIFICATION_PENDING`, and `ENGAGEMENT_SENT` advance only when the relevant provider accepts the message. `SIGNED` requires signature evidence. `CONVERTED` means onboarding complete and requires signature plus the engagement's configured external-payment record. Service completion is a separate timestamp.

## Permissions

| Capability | OWNER | ADVISOR | VIEWER |
|---|---:|---:|---:|
| All leads and scoped KPIs | Yes | Assigned | Explicit grant |
| Basic lead summary | Yes | Assigned | Explicit grant |
| Contact, net-worth, qualification details | Yes | Assigned | No |
| Notes and workflow mutations | Yes | Assigned | No |
| Engagement files and financial facts | Yes | Assigned | No |
| Staff/security and provider health | Yes | No | No |
| Privacy workflow and subject export | Yes | No | No |
| Bulk export | Approved owner action only | No | No |

Every query, count, detail, communication, and document route enforces role and record scope on the server. Unauthorized records use a non-enumerating 404 for scoped users.

## Intake reliability

`POST /api/v1/enquiries` and compatibility route `POST /api/submit-lead` use one service. A 16–128 character `Idempotency-Key` is stored as a hash with a request fingerprint for 24 hours. Same key and payload replay the generic receipt; different payload returns 409. A recipient advisory transaction lock serializes first-contact matching. Existing email candidates create a separate reconciliation-pending enquiry and never overwrite a reviewed lead.

The enquiry, optional new lead, candidates, consent events, audit event, idempotency receipt, and outbox jobs commit in one transaction. Abuse protection uses PostgreSQL buckets for IP and HMAC-keyed recipient windows and fails closed with 503 if storage is unavailable. A honeypot receives a generic receipt. Recent acknowledgements are suppressed to limit confirmation floods.

## Email semantics

Workers atomically claim bounded batches with `FOR UPDATE SKIP LOCKED`, commit the lease before network I/O, and finalize only with the matching lease token. Transient failures use capped exponential backoff and jitter; permanent failures stop. SMTP transport uncertainty becomes `UNKNOWN` and is not automatically retried. Resend receives stable idempotency keys, whose documented deduplication window is 24 hours. Outcomes beyond that window require operator reconciliation.

Resend webhooks use raw bodies, SDK signature verification, a five-minute timestamp window, unique `svix-id`, provider message ID reconciliation, and monotonic outcome updates. Bounce and complaint events suppress discretionary mail. Security mail remains separately requested but expires and loses its encrypted token payload.

## Data protection and recovery

Restricted notes and temporary message variables use AES-256-GCM with random nonces and versioned 32-byte keys. Keys are external environment/KMS material; ciphertext includes no key. Rotate by prepending a new key version, retaining old decrypt keys until re-encryption and backup expiry are verified. Backup artifacts use a separate key.

Audit, status history, and email attempts are database-enforced append-only. Enquiry submission snapshots are immutable while reconciliation fields remain editable. The app role receives DML, not schema ownership; the migration role owns schema changes. TLS and infrastructure encryption at rest are deployment requirements.

The owner privacy workflow separates archive, communication withdrawal, export, and erasure. Export payloads are encrypted, authenticated, expire after 15 minutes, and are deleted after one download. Erasure cancels payloads, deletes private objects, removes primary records, and writes a HMAC deletion ledger for restore reconciliation. Provider-retained copies require manual/provider API follow-up and are reported honestly.

Retention policy is deliberately draft and automatic deletion is disabled in `config/retention-policy.draft.json`. No legal retention period is asserted.

## Deployment decision

Vercel builds the preserved static package from `frontend/`. Its checked `vercel.json` proxies `/api/*` to the fixed Render API destination and redirects `/admin` to the backend-owned staff surface. `render.yaml` defines `veridian-backend` as the root for one web process and one worker plus PostgreSQL. The Render URL in `frontend/vercel.json` must be confirmed against the created service before production deployment. Arbitrary request-selected destinations and production wildcard preview origins are forbidden.
