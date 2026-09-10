# Veridian Global Advisors

Production-oriented website and lead-management system for Veridian Global Advisors.

## Repository layout

- `frontend/` — existing static marketing site, built for Vercel.
- `veridian-backend/` — TypeScript/Express API, Better Auth staff dashboard, email worker, PostgreSQL migrations, and operational tooling.
- `docs/` — architecture, OpenAPI, runbook, progress evidence, and launch checklist.
- `render.yaml` — Render API, worker, migration, and PostgreSQL blueprint.

## Local development

Start the backend stack from one PowerShell terminal:

```powershell
Set-Location veridian-backend
Copy-Item .env.example .env
docker compose up -d
npm ci
npm run db:migrate
npm run owner:bootstrap
npm run dev
```

Start `npm run dev:worker` from a second `veridian-backend` terminal. Start `npm ci; npm run dev` from `frontend/` in a third terminal, then open `http://localhost:3000`; staff access is at `http://localhost:5000/admin`.

See `docs/backend-runbook.md` before staging or production deployment.
