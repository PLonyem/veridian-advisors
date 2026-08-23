# Veridian Global Advisors – Backend

## Project Overview

This is the backend API for Veridian Global Advisors, built with Express and SQLite.

**Purpose:** lead management for Veridian Global Advisors. The API captures prospective client inquiries submitted through the public lead form — full name, country, net worth bracket, service tier interest, email, and disclaimer acceptance — and gives the internal team admin tooling to review and act on them as they move through the pipeline.

Core capabilities:

- **Public lead submission** (`POST /api/submit-lead`) — validated, rate-limited, upserts on email so a repeat submission updates the existing lead instead of duplicating it.
- **Admin lead management** (`/api/leads*`, protected by an admin key) — list and filter leads, view a single lead, update status, soft-delete (archive), and view status-breakdown stats.
- **Automated email notifications** — a confirmation email to the lead and a notification to the admin inbox, sent asynchronously so a slow/failed email never blocks or fails the API response.
- **Operational tooling** — a tracked SQL migration runner, a JSON+gzip database backup script with retention cleanup, and structured request/application logging.

## Prerequisites

- **Node.js v18 or later** — required by Express 5 and this project's other dependencies.
- **npm** (bundled with Node.js) or **yarn** — for installing dependencies and running the scripts in `package.json`.
- **SQLite (optional)** — only needed if you want to inspect `data.db` directly, e.g. via the `sqlite3` CLI or a GUI tool like DB Browser for SQLite. The app itself doesn't require a system SQLite install: the `sqlite3` npm package bundles its own native bindings, so `npm install` is all that's needed to run the server.

## Environment Setup

1. Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env          # macOS/Linux/Git Bash
   ```

   ```powershell
   Copy-Item .env.example .env   # Windows PowerShell
   ```

2. Fill in every value below. `src/config/index.js` validates all of this on startup and refuses to boot with a clear error message if anything required is missing or malformed.

### Server

| Variable | Required | Notes |
|---|---|---|
| `PORT` | yes | Port the Express server listens on. Must be a number. |
| `NODE_ENV` | no (defaults to `development`) | `development` or `production`. This isn't just cosmetic — it controls whether CORS is locked to `ALLOWED_ORIGINS` or wide open, whether HSTS and gzip compression are enabled, and whether logs go to the console or to `logs/app.log`. Set it explicitly to `production` in real deployments. |

### Email

| Variable | Required | Notes |
|---|---|---|
| `EMAIL_USER` | yes, valid email | The Gmail account used to send outbound emails (lead confirmations, admin notifications) via Nodemailer. |
| `EMAIL_PASS` | yes | A Gmail **App Password** — not your regular account password. Enable 2-Step Verification on the account, then generate one at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) specifically for this app. |

### Admin

| Variable | Required | Notes |
|---|---|---|
| `ADMIN_EMAIL` | yes, valid email | Where new-lead notification emails are sent. |
| `ADMIN_KEY` | yes, 32+ characters | The shared secret for the admin endpoints (`GET`/`PATCH`/`DELETE /api/leads*`), passed as `?key=<ADMIN_KEY>` or an `x-api-key` header. Generate a strong one with:<br>`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |

### Application

| Variable | Required | Notes |
|---|---|---|
| `BASE_URL` | yes | The public URL this server is reachable at (e.g. `http://localhost:5000` locally). Used to build links inside notification emails and logged at startup. |
| `ALLOWED_ORIGINS` | yes, comma-separated | Frontend origin(s) permitted to call this API via CORS. **Only enforced when `NODE_ENV=production`** — in development, CORS allows any origin regardless of this value, so local frontend testing isn't blocked. |

### Rate limiting (optional)

| Variable | Required | Notes |
|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | no (default `3600000`, 1 hour) | Rate-limit window, in milliseconds, for `POST /api/submit-lead`. |
| `RATE_LIMIT_MAX` | no (default `5`) | Max requests per IP per window for `POST /api/submit-lead`. Admin endpoints (`GET /api/leads*`) are never rate limited. |

### Deployment (optional)

| Variable | Required | Notes |
|---|---|---|
| `DATA_DIR` | no (defaults to the project root) | Redirects `data.db`, `backups/`, and `logs/` under this directory instead of the project root. Leave unset for local development. Needed in any deployment where the app's own source directory isn't persistent — e.g. set to `/data` when deploying with a mounted volume (see Deployment below). |

## Database Setup

The server also runs migrations automatically on every startup (see `initializeDatabase()` in `src/config/database.js`), so this step isn't strictly required to get the app running — but running it explicitly is useful for CI, deployments, or just confirming the schema is up to date before you start developing.

1. Run migrations:

   ```bash
   npm run db:migrate
   ```

   This creates `data.db` if it doesn't exist yet, then applies any `.sql` file in `src/migrations/` that hasn't already been recorded in the database's own `migrations` table — each file only ever runs once. Output looks like:

   ```
   migrate: 001_create_leads_table.sql - applying...
   migrate: 001_create_leads_table.sql - done
   migrate: 002_add_communications_table.sql - applying...
   migrate: 002_add_communications_table.sql - done
   migrate: 003_add_communications_indexes.sql - applying...
   migrate: 003_add_communications_indexes.sql - done
   migrate: all migrations applied successfully
   ```

   Running it again is safe — already-applied migrations are skipped:

   ```
   migrate: 001_create_leads_table.sql - already applied, skipping
   migrate: 002_add_communications_table.sql - already applied, skipping
   migrate: 003_add_communications_indexes.sql - already applied, skipping
   ```

2. Verify the database:

   ```bash
   sqlite3 data.db ".schema leads"
   ```

   This requires the `sqlite3` CLI (see Prerequisites — it's optional and not installed by `npm install`). If you don't have it and don't want to install it, you can inspect the same schema with a one-off Node script instead, using the project's own database module:

   ```bash
   node -e "require('./src/config/database').all(\"SELECT sql FROM sqlite_master WHERE type='table' AND name='leads'\").then(r => { console.log(r[0].sql); process.exit(0); })"
   ```

   Either way, you should see the `leads` table with columns `id`, `full_name`, `country`, `net_worth`, `tier_interest`, `email`, `status`, `disclaimer_accepted`, `source`, `notes`, `created_at`, and `updated_at`.

## Running the Server

### Development

```bash
npm run dev
```

Runs the server via `nodemon`, which watches the project and automatically restarts it whenever you edit a `.js`/`.mjs`/`.cjs`/`.json` file. If nodemon ever reports `app crashed - waiting for file changes before starting...`, it won't retry on its own — either fix the error and save, or type `rs` + Enter in that terminal to force a restart.

### Production

```bash
npm start
```

Runs the server directly (`node src/server.js`), without nodemon's file-watching/auto-restart. Use a process manager (PM2, Docker's own restart policy, systemd, etc.) in front of this for real deployments, so the process comes back up automatically if it exits — the app's own `SIGTERM`/`SIGINT`/uncaught-error handlers shut it down cleanly, but nothing about `npm start` itself restarts it after that.

**Important:** `npm start` does *not* set `NODE_ENV=production` for you — it just skips nodemon. Whether the app actually runs in "production mode" (CORS locked to `ALLOWED_ORIGINS`, HSTS and gzip compression enabled, logs written to `logs/app.log` instead of the console) depends entirely on `NODE_ENV`, which comes from `.env` (or your shell/host environment, which takes precedence over `.env` since `dotenv` never overrides a variable that's already set). Set `NODE_ENV=production` explicitly wherever you actually deploy this.

## API Documentation

Full endpoint reference — base URL, authentication, rate limiting, request/response shapes, and `curl` examples for every route — lives in [`src/docs/api.md`](src/docs/api.md).

A ready-to-run Postman collection (and matching environment file) covering the same endpoints is also available in [`postman/`](postman/).

## Database Backup

### Manual

```bash
npm run backup
```

Exports every lead to a timestamped JSON file in `backups/` (`backup-YYYY-MM-DD-HHMMSS.json`), alongside a gzip-compressed copy of the same file (`.json.gz`). Each export also prunes any backup older than 30 days. A gzip or cleanup failure is logged as a warning but won't fail the run — the JSON export itself is the critical part and is unaffected either way.

Example output:

```
backup: exported 3 lead(s) to backups/backup-2026-08-07-145707.json
backup: compressed backup to backups/backup-2026-08-07-145707.json.gz
```

### Scheduled Backups

Two installer scripts are provided to run the backup automatically once a day (2:00 AM) — pick the one for your platform:

**Linux/Mac** — installs a cron job:

```bash
bash src/scripts/install-cron-backup.sh
```

Re-running it is safe: it replaces any previous cron entry for this script instead of adding a duplicate. Logs go to `logs/backup.log`. If you'd rather add the crontab entry yourself, the script prints the exact line it would install.

**Windows** — registers a Task Scheduler task (run as Administrator):

```powershell
powershell -ExecutionPolicy Bypass -File .\src\scripts\install-scheduled-backup-windows.ps1
```

This creates a scheduled task named `VeridianBackendBackup`. If you'd rather register it yourself, the script's header comment includes the equivalent `schtasks` one-liner.

## Common Issues & Troubleshooting

### Port already in use

```
[ERROR] Port 5000 is already in use. Stop whatever else is using it, or change PORT in .env.
```

This means something is already bound to the configured `PORT` — often a previous instance of this same server that didn't shut down cleanly. Find and stop it:

```bash
# Windows
netstat -ano | findstr :5000
taskkill /F /PID <pid_from_above>
```

```bash
# macOS/Linux
lsof -ti:5000 | xargs kill -9
```

If it's nodemon specifically: running `npm run dev` twice in different terminals is a common cause. Alternatively, just change `PORT` in `.env` (and `BASE_URL` to match) if you'd rather not hunt down the other process.

### Email authentication failed

Shows up in the logs as something like `sendClientConfirmation failed for ...` / `sendAdminNotification failed for ...`, not as a failed API request — email sending is fire-and-forget (see Project Overview), so **the lead is still saved and the API still returns success even if this fails.** The symptom is "submissions work, but no emails arrive."

Almost always means `EMAIL_PASS` is a regular Gmail password instead of an **App Password**. Gmail rejects plain-password SMTP logins for third-party apps. Fix:

1. Enable 2-Step Verification on the `EMAIL_USER` account, if it isn't already.
2. Generate an App Password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
3. Put that (not your login password) in `EMAIL_PASS`.

Also double check `EMAIL_USER` is spelled correctly — a typo there fails the same way.

### Database file permissions

Usually shows up as a SQLite error like `SQLITE_CANTOPEN: unable to open database file` (can't create/open `data.db` at all) or `SQLITE_BUSY: database is locked` (a write collided with another process holding the file open). Things to check:

- **Only one process should hold `data.db` at a time in normal use.** If you have `npm run dev` running in one terminal and also run `npm start`, `npm run backup`, or `npm run db:migrate` at the exact same moment in another, a `SQLITE_BUSY` is possible — brief overlaps are usually fine (SQLite retries), but a lingering second instance isn't. Same troubleshooting as "port already in use" above: check for and stop any duplicate `node` process.
- **File/folder permissions.** On macOS/Linux, confirm your user owns the project folder and `data.db`: `ls -l data.db`, fix with `chmod u+rw data.db` if needed. On Windows, check `data.db` isn't marked read-only (right-click → Properties), and that the folder isn't inside a path your user lacks write access to.
- **Cloud-synced folders** (OneDrive, Dropbox, Google Drive) can transiently lock the file mid-sync. Running the project from a folder outside of active cloud sync avoids this class of issue entirely.

### CORS errors

First check `NODE_ENV`: in development, CORS allows **any** origin by design (see Environment Setup → `NODE_ENV`), so a CORS error locally almost always means `NODE_ENV` is unexpectedly set to `production`. Check `.env` and your shell environment.

If it's actually production, the browser's CORS error will name the blocked origin — make sure that *exact* origin (protocol + host + port, no trailing slash) is in `ALLOWED_ORIGINS`, comma-separated with no extra whitespace issues.

**After changing `ALLOWED_ORIGINS` (or any `.env` value), restart the server.** `.env` isn't hot-reloaded — and if you're running `npm run dev`, note that nodemon's file-watcher only triggers on `.js`/`.mjs`/`.cjs`/`.json` files by default, so editing `.env` alone won't cause an automatic restart either. Stop and restart manually, or type `rs` in the nodemon terminal.

## Deployment

This app needs a **persistent filesystem** — `data.db` is SQLite, a single file on disk, not a hosted database. That rules out purely serverless/ephemeral-filesystem platforms (e.g. Vercel) without first migrating off SQLite. It works as-is on any host that gives you a long-running process plus persistent storage: Fly.io, Railway, Render (paid disk tier), a VPS, etc.

A `Dockerfile` and `.dockerignore` are included (multi-stage build; the build stage installs `python3`/`make`/`g++` since `sqlite3` is a native addon that may need to compile from source if no prebuilt binary matches the target platform). `DATA_DIR` (see Environment Setup above) is what makes this portable — set it to your mounted volume's path so `data.db`, `backups/`, and `logs/` land there instead of the container's own ephemeral filesystem.

### Fly.io

1. Install `flyctl`:

   ```powershell
   iwr https://fly.io/install.ps1 -useb | iex   # Windows PowerShell
   ```

   ```bash
   curl -L https://fly.io/install.sh | sh        # macOS/Linux
   ```

2. Log in (opens a browser):

   ```bash
   fly auth login
   ```

3. From the `veridian-backend` directory, launch the app. This detects the `Dockerfile`, asks for an app name and region, and generates `fly.toml` — pass `--no-deploy` so you can add the volume mount before the first deploy:

   ```bash
   fly launch --no-deploy
   ```

4. Create a persistent volume in the **same region** you picked in step 3:

   ```bash
   fly volumes create veridian_data --size 1 --region <region-from-step-3>
   ```

5. Open the generated `fly.toml` and add the volume mount, plus the non-secret env vars (`fly launch` already generated most of the file, including the HTTP service block — merge these in rather than replacing it):

   ```toml
   [[mounts]]
     source = "veridian_data"
     destination = "/data"

   [env]
     NODE_ENV = "production"
     DATA_DIR = "/data"
     BASE_URL = "https://<your-app-name>.fly.dev"
     ALLOWED_ORIGINS = "https://your-frontend-domain.com"
   ```

   Also point the health check (if `fly launch` added one) at `/api/health` instead of whatever path it defaulted to.

6. Set the remaining values as secrets (encrypted, not stored in `fly.toml`) — same values you'd put in `.env`:

   ```bash
   fly secrets set EMAIL_USER="your-email@gmail.com" EMAIL_PASS="your-app-password" ADMIN_EMAIL="leads@veridianglobal.com" ADMIN_KEY="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
   ```

7. Deploy:

   ```bash
   fly deploy
   ```

8. Verify:

   ```bash
   fly status
   curl https://<your-app-name>.fly.dev/api/health
   ```

9. Run migrations against the deployed instance (one-off command in the running machine):

   ```bash
   fly ssh console -C "node src/scripts/migrate.js"
   ```

**Note:** I wrote the `Dockerfile` carefully but couldn't `docker build` or `fly deploy` it in this environment to confirm end-to-end — Docker isn't available here. Treat the first `fly deploy` as the real test, and check `fly logs` if it doesn't come up cleanly.
