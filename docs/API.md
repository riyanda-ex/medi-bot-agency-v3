# API Reference (Summary)

All API routes are under `app/api/*`. Mutating endpoints should be called same-origin with a valid authenticated session.

## Authentication

- Most endpoints require a valid NextAuth session.
- Invalid/stale sessions are rejected (`401/403` depending route).
- RBAC is fail-closed; unknown roles have no permissions.

## Endpoints

| Method   | Path                        |                            Auth | Purpose                                     | Notes                                          |
| -------- | --------------------------- | ------------------------------: | ------------------------------------------- | ---------------------------------------------- |
| GET/POST | `/api/auth/[...nextauth]`   |                     Public/Auth | NextAuth handlers                           | Credentials auth.                              |
| POST     | `/api/chatbot`              |                             Yes | Generic education chatbot                   | No diagnosis; rate limited; same-origin.       |
| GET      | `/api/me`                   |                  Yes (own:read) | Current patient data                        | Returns masked NIK; patient-owned.             |
| POST     | `/api/orchestrator/run`     |                 Yes (agent:run) | Run/queue orchestrator                      | Returns 202+`jobId` in Redis mode.             |
| GET      | `/api/patients`             | Yes (patient:read/triage:write) | List patients                               | Masked NIK, limited fields.                    |
| GET      | `/api/patients/[id]/record` |              Yes (patient:read) | Patient medical records                     | Diagnosis redacted by role.                    |
| GET      | `/api/reports/download`     |               Yes (report:read) | Download report (`type=pdf` / `type=excel`) | Path contained to `reports/`.                  |
| POST     | `/api/reports/generate`     |     Yes (report:read/agent:run) | Generate daily report                       | Optional `approvalId` for real email.          |
| POST     | `/api/triage`               |              Yes (triage:write) | Triage evaluation                           | Zod validated vitals; may trigger urgent flow. |
| POST     | `/api/urgent/approve`       |              Yes (DOKTER/ADMIN) | Create outbound approval                    | HMAC-signed, 30-min TTL.                       |
| POST     | `/api/urgent/simulate`      |    Yes (triage:write/agent:run) | Simulate/queue urgent follow-up             | Validates patient/visit/log consistency.       |

## Operations & Privacy Endpoints

- `GET /api/health` — liveness probe (process up).
- `GET /api/ready` — readiness probe (database/Redis checks); returns `503` when not ready and is
  the healthcheck target used by `docker-compose.yml`.
- Privacy endpoints:
  - `GET/PUT /api/me/consent` — consent state and 25-year retention (`legalHold`, `dsrSlaHours`).
  - `GET/POST /api/me/privacy-requests` — patient's own tickets; new tickets carry a 72 h SLA.
  - `GET/PATCH /api/privacy-requests/[id]` — ADMIN-only verification/closure;
    deletion/anonymisation requires an approved ticket, consent `REVOKED` (or non-null
    `consentRevokedAt`), expired retention, and no legal hold.
  - `DELETE /api/patients/[id]/privacy` — identity anonymisation; clinical facts are preserved.
  - `GET /api/audit/phi` — ADMIN-only, redacted, cursor-paginated PHI access audit.
- Security endpoints:
  - `GET/POST /api/me/mfa` — TOTP enrolment/verification and single-use recovery codes.
  - `POST /api/auth/forgot-password` / `POST /api/auth/reset-password` — single-use reset tokens,
    old sessions revoked on success. The first endpoint returns 200 for both known and unknown
    emails (anti-enumeration); origin/rate-limit guards can still return 403/429.
  - `PATCH /api/admin/users/[id]` — ADMIN can only change `status` and `revokeSessions`; MFA is
    self-service via `/api/me/mfa` (admins cannot enrol or reset it for another user).
  - `GET /api/metrics` — Prometheus text endpoint gated by `METRICS_TOKEN` (404 without it).
- `GET /api/patients` supports `limit` (1–100) and `cursor` for keyset pagination.
- See `docs/DATA-LIFECYCLE.md` and `openapi.yaml` for the full state model and schemas.

## Security Controls

- **Rate limiting**: per-user/IP on sensitive endpoints, Redis-backed in production.
- **Same-origin**: enforced on mutating sensitive endpoints.
- **Audit logging**: access/deny/action events recorded with integrity signature.
- **No-store**: API responses set `Cache-Control: no-store, max-age=0`.
- **Consent gate**: patient-directed WhatsApp/phone calls re-check `GRANTED` consent at execution
  (`agents/urgentCaller.ts`). Staff report email requires signed approval but does not re-check
  patient consent (`agents/reporter.ts`).
