# Veridian Backend

TypeScript ESM/Express backend for enquiry intake, individual Better Auth staff accounts with MFA, role-scoped lead operations, durable email delivery, private engagement documents, and reviewed privacy workflows.

## Commands

```powershell
Copy-Item .env.example .env
docker compose up -d
npm ci
npm run db:migrate
npm run owner:bootstrap
npm run dev
```

Run `npm run dev:worker` separately. The API defaults to `http://localhost:5000`, the protected dashboard to `/admin`, Mailpit to `http://localhost:8025`, and MinIO Console to `http://localhost:9001`.

Use `npm run check` for static verification. PostgreSQL integration tests require the isolated test variables documented in `../docs/backend-runbook.md`.
