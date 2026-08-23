# Veridian Backend API

## Base URL

```
http://localhost:3000/api
```

In local development, the frontend dev server (`npm run dev` in `frontend/`, see `frontend/dev-server.js`) serves the site on port `3000` and reverse-proxies every `/api/*` request through to this backend — so `http://localhost:3000/api` is the base URL you'll actually use day to day, matching how the frontend itself calls the API via relative `/api/...` URLs.

The backend can also be reached directly, without the frontend proxy in front of it, at `http://localhost:5000/api` (the port comes from the `PORT` env var, `5000` by default — see `.env.example`). Both reach the same server; use whichever matches what you have running. All endpoints below are relative to whichever base URL you're using.

## Authentication

Admin endpoints (everything under `/api/leads`, except submission) require the `ADMIN_KEY` configured in `.env`. Supply it either as a query parameter or a header — both are checked and either is sufficient:

```
?key=<ADMIN_KEY>
```

```
x-api-key: <ADMIN_KEY>
```

Every authentication attempt (successful or failed) is logged server-side for audit purposes. A missing or incorrect key returns:

```json
// 401 Unauthorized
{ "error": "Unauthorized", "message": "Invalid or missing admin key" }
```

## Rate Limiting

`POST /submit-lead` is limited to **5 requests per IP per hour**. Exceeding it returns:

```json
// 429 Too Many Requests
{ "error": "Too many requests", "message": "You have exceeded the request limit. Please try again in an hour." }
```

Admin endpoints (`/leads*`) are not rate limited.

---

## `GET /health`

Liveness check. No authentication required.

**Response `200`**

```json
{ "status": "ok", "timestamp": "2026-01-01T12:00:00.000Z" }
```

**Example**

```bash
curl http://localhost:3000/api/health
```

---

## `POST /api/test-email`

Email configuration health check. Sends a real test email to `ADMIN_EMAIL` so you can confirm `EMAIL_USER`/`EMAIL_PASS` actually work. **Requires authentication.**

**Success Response `200`**

```json
{ "success": true, "message": "Test email sent to leads@veridianglobal.com" }
```

If a test email was already sent within the last 5 minutes (see the rate-limit note on `emailService`), the request still succeeds but nothing new is sent:

```json
{ "success": true, "skipped": true, "message": "Skipped - a test email was already sent to leads@veridianglobal.com within the last 5 minutes." }
```

**Example**

```bash
curl -X POST "http://localhost:3000/api/test-email?key=$ADMIN_KEY"
```

---

## `POST /submit-lead`

Public endpoint for submitting a new lead. No authentication required; rate limited (see above). Submitting an email that already exists updates that lead's record instead of creating a duplicate.

**Headers**

```
Content-Type: application/json
```

**Body**

| Field               | Type    | Required | Notes |
|---------------------|---------|----------|-------|
| `fullName`          | string  | yes      | At least 2 characters |
| `country`           | string  | yes      | At least 2 characters |
| `netWorth`          | string  | yes      | One of: `$1M–$5M`, `$5M–$20M`, `$20M+` |
| `tierInterest`      | string  | yes      | One of: `Foundation`, `Accelerated`, `Executive`, `Not sure` |
| `email`             | string  | yes      | Must be a valid email address |
| `disclaimerAccepted`| boolean | yes      | Must be exactly `true` |

```json
{
  "fullName": "John Doe",
  "country": "United States",
  "netWorth": "$5M–$20M",
  "tierInterest": "Accelerated",
  "email": "john@example.com",
  "disclaimerAccepted": true
}
```

**Success Response `201`**

```json
{
  "success": true,
  "leadId": 1,
  "message": "Thank you for your submission. Our team will be in touch within 24 hours."
}
```

**Error Response `400`** — disclaimer not accepted (checked first, before other field validation):

```json
{ "success": false, "error": "You must accept the disclaimer" }
```

**Error Response `400`** — one or more other fields invalid:

```json
{
  "success": false,
  "error": "Validation failed",
  "details": [
    "email must be a valid email address (received: \"not-an-email\")",
    "net_worth must be one of: $1M–$5M, $5M–$20M, $20M+ (received: \"lots\")"
  ]
}
```

**Error Response `500`** — database save failed:

```json
{ "success": false, "error": "Failed to save lead" }
```

**Example**

```bash
curl -X POST http://localhost:3000/api/submit-lead \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "John Doe",
    "country": "United States",
    "netWorth": "$5M–$20M",
    "tierInterest": "Accelerated",
    "email": "john@example.com",
    "disclaimerAccepted": true
  }'
```

---

## `GET /leads`

Lists leads. **Requires authentication.**

**Query Parameters**

| Param      | Required | Notes |
|------------|----------|-------|
| `key`      | yes      | `ADMIN_KEY` (unless passed via `x-api-key` header instead) |
| `status`   | no       | One of the lead statuses (see `GET /leads/stats` below) |
| `fromDate` | no       | `YYYY-MM-DD`, inclusive lower bound on submission date |
| `toDate`   | no       | `YYYY-MM-DD`, inclusive upper bound on submission date |
| `limit`    | no       | Default `50`, max `200` |
| `offset`   | no       | Default `0`, for pagination |

**Success Response `200`**

```json
{
  "success": true,
  "data": [
    { "id": 1, "full_name": "John Doe", "email": "john@example.com", "status": "New", "...": "..." }
  ],
  "total": 10
}
```

`total` reflects the full count matching the filters, independent of `limit`/`offset`.

**Example**

```bash
curl "http://localhost:3000/api/leads?key=$ADMIN_KEY&status=New&limit=20"
```

---

## `GET /leads/:id`

Fetches a single lead by id. **Requires authentication.**

**Success Response `200`**

```json
{ "data": { "id": 1, "full_name": "John Doe", "email": "john@example.com", "status": "New", "...": "..." } }
```

**Error Response `404`**

```json
{ "error": "Lead not found" }
```

**Example**

```bash
curl "http://localhost:3000/api/leads/1?key=$ADMIN_KEY"
```

---

## `GET /leads/stats`

Returns lead counts grouped by status. **Requires authentication.**

**Success Response `200`**

```json
{
  "success": true,
  "data": {
    "total": 10,
    "byStatus": {
      "New": 5,
      "Contacted": 3,
      "Consultation Scheduled": 1,
      "Engagement Sent": 0,
      "Signed": 1,
      "Rejected": 0,
      "Converted": 0,
      "Archived": 0
    }
  }
}
```

**Example**

```bash
curl "http://localhost:3000/api/leads/stats?key=$ADMIN_KEY"
```

---

## `PATCH /leads/:id/status`

Updates a lead's status. **Requires authentication.**

**Body**

```json
{ "status": "Contacted" }
```

`status` must be one of: `New`, `Contacted`, `Consultation Scheduled`, `Engagement Sent`, `Signed`, `Rejected`, `Converted`, `Archived`.

**Success Response `200`**

```json
{ "success": true, "data": { "id": 1, "status": "Contacted", "...": "..." } }
```

**Error Response `400`** — invalid id or status:

```json
{ "error": "id must be a positive integer" }
```

```json
{ "error": "status must be one of: New, Contacted, Consultation Scheduled, Engagement Sent, Signed, Rejected, Converted, Archived" }
```

**Error Response `404`**

```json
{ "error": "Lead not found" }
```

**Example**

```bash
curl -X PATCH "http://localhost:3000/api/leads/1/status?key=$ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "status": "Contacted" }'
```

---

## `DELETE /leads/:id`

Soft-deletes a lead by setting its status to `Archived`. **Requires authentication.**

**Success Response `200`**

```json
{ "success": true }
```

**Error Response `400`** — invalid id:

```json
{ "error": "id must be a positive integer" }
```

**Error Response `404`**

```json
{ "error": "Lead not found" }
```

**Example**

```bash
curl -X DELETE "http://localhost:3000/api/leads/1?key=$ADMIN_KEY"
```

---

## Manual client-communication endpoints

The client communication system is deliberately email-only and manual: aside from the two automatic emails sent on `POST /submit-lead` (client confirmation, admin notification), every other email is triggered by an admin action below, not by a booking widget, chat, or scheduling integration. Each of these sends an email through the same transport as the rest of the app and logs it to the `communications` table; where the lead-status table (see `PATCH /leads/:id/status` above) maps sending that email to a specific stage, the lead's status is advanced automatically.

### `POST /leads/:id/pre-vetting-email`

Sends the 5-question pre-vetting questionnaire. **Requires authentication.** Advances status to `Contacted`.

**Success Response `200`**

```json
{ "success": true, "data": { "id": 1, "status": "Contacted", "...": "..." } }
```

**Example**

```bash
curl -X POST "http://localhost:3000/api/leads/1/pre-vetting-email?key=$ADMIN_KEY"
```

### `POST /leads/:id/scheduling-email`

Proposes consultation time slots. **Requires authentication.** Does **not** change status — per the manual scheduling workflow, the client replies with their preference and you confirm it yourself, then call `PATCH /leads/:id/status` with `"Consultation Scheduled"` once a time is actually locked in.

**Body**

| Field             | Type     | Required | Notes |
|-------------------|----------|----------|-------|
| `slots`           | string[] | yes      | Proposed date/time options, e.g. `"Tue Aug 12, 2pm ET"` |
| `platform`        | string   | no       | Defaults to `"Video call (Zoom or Google Meet) or phone"` |
| `durationMinutes` | number   | no       | Defaults to `30` |

**Example**

```bash
curl -X POST "http://localhost:3000/api/leads/1/scheduling-email?key=$ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "slots": ["Tue Aug 12, 2pm ET", "Wed Aug 13, 10am ET"], "platform": "Zoom" }'
```

### `POST /leads/:id/engagement-letter-email`

Sends the engagement letter as a PDF attachment. **Requires authentication.** Advances status to `Engagement Sent`.

The PDF is read from `src/documents/engagement-letter-template.pdf`, which is **not included in this repo** (see `src/documents/README.md`) — it must be a real engagement letter prepared or reviewed by qualified legal counsel. Until that file exists, this endpoint returns `500` with a message naming the exact path to fix.

**Example**

```bash
curl -X POST "http://localhost:3000/api/leads/1/engagement-letter-email?key=$ADMIN_KEY"
```

### `POST /leads/:id/follow-up-email`

Sends a gentle follow-up. **Requires authentication.** Does not change status.

**Body**

| Field     | Type   | Required | Notes |
|-----------|--------|----------|-------|
| `message` | string | no       | Custom body text; falls back to a generic reminder if omitted |

**Example**

```bash
curl -X POST "http://localhost:3000/api/leads/1/follow-up-email?key=$ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "message": "Just checking in ahead of your consultation next week." }'
```

### `GET /leads/:id/communications`

Returns the full communication history for a lead, newest first. **Requires authentication.**

**Success Response `200`**

```json
{
  "success": true,
  "data": [
    { "id": 3, "lead_id": 1, "type": "outgoing", "channel": "email", "subject": "Following up – Veridian Global Advisors", "content": "...", "sent_at": "2026-01-02T10:00:00.000Z" },
    { "id": 2, "lead_id": 1, "type": "incoming", "channel": "email", "subject": "Re: Consultation Confirmation", "content": "Tuesday works for me", "sent_at": "2026-01-01T18:30:00.000Z" },
    { "id": 1, "lead_id": 1, "type": "outgoing", "channel": "email", "subject": "Thank you for contacting Veridian Global Advisors", "content": "...", "sent_at": "2026-01-01T12:00:00.000Z" }
  ]
}
```

**Example**

```bash
curl "http://localhost:3000/api/leads/1/communications?key=$ADMIN_KEY"
```

### `POST /leads/:id/communications`

Manually logs a communication that happened outside the app — most commonly a client reply that landed in your own inbox, which the app has no automatic way to see. **Requires authentication.**

**Body**

| Field     | Type   | Required | Notes |
|-----------|--------|----------|-------|
| `type`    | string | yes      | `"incoming"` or `"outgoing"` |
| `channel` | string | no       | Defaults to `"email"` |
| `subject` | string | no       | |
| `content` | string | no       | |

**Example**

```bash
curl -X POST "http://localhost:3000/api/leads/1/communications?key=$ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "type": "incoming", "subject": "Re: Consultation Confirmation", "content": "Tuesday 2pm works for me." }'
```
