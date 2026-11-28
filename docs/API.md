# API Reference (Summary)

All API routes are under `app/api/*`. Mutating endpoints should be called same-origin with a valid authenticated session. `GET /api/health` is a public liveness probe used by healthchecks; `GET /api/ready` is an infrastructure readiness probe that requires `READY_TOKEN` in production. Neither exposes patient data.

## Authentication

- Most endpoints require a valid NextAuth session.
- Invalid/stale sessions are rejected (`401/403` depending route).
- RBAC is fail-closed; unknown roles have no permissions.

## Endpoints

| Method   | Path                                    | Auth                            | Purpose                         | Notes                                                                                                                                                 |
| -------- | --------------------------------------- | :------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET/POST | `/api/auth/[...nextauth]`               | Public/Auth                     | NextAuth handlers               | Credentials auth.                                                                                                                                     |
| GET      | `/api/health`                           | Public                          | Liveness probe                  | `200` + `status: ok`; used by container healthcheck.                                                                                                  |
| GET      | `/api/ready`                            | Dev public / prod token         | Readiness probe                 | Production needs `Authorization: Bearer <READY_TOKEN>`; `200` when DB (and Redis in Redis queue mode) reachable, `403` unauthorized, `503` not ready. |
| POST     | `/api/chatbot`                          | Yes                             | Generic education chatbot       | No diagnosis; rate limited; same-origin.                                                                                                              |
| GET      | `/api/me`                               | Yes (own:read)                  | Current patient data            | Returns masked NIK; patient-owned.                                                                                                                    |
| POST     | `/api/orchestrator/run`                 | Yes (agent:run)                 | Run/queue orchestrator          | Redis: `202` + `jobId`; sync: `200` + `outcomes`.                                                                                                     |
| GET      | `/api/patients`                         | Yes (patient:read/triage:write) | List patients                   | Masked NIK, limited fields.                                                                                                                           |
| GET      | `/api/patients/[id]/record`             | Yes (patient:read)              | Patient medical records         | Diagnosis redacted by role.                                                                                                                           |
| GET      | `/api/reports/download?type=pdf\|excel` | Yes (report:read/agent:run)     | Download a report file          | Optional `reportId` (default: latest); path contained to `reports/`.                                                                                  |
| POST     | `/api/reports/generate`                 | Yes (report:read/agent:run)     | Generate daily report           | Optional `approvalId` for real email.                                                                                                                 |
| POST     | `/api/triage`                           | Yes (triage:write)              | Triage evaluation               | Zod validated vitals; may trigger urgent flow.                                                                                                        |
| POST     | `/api/urgent/approve`                   | Yes (DOKTER/ADMIN)              | Create outbound approval        | HMAC-signed, 30-min TTL.                                                                                                                              |
| POST     | `/api/urgent/simulate`                  | Yes (triage:write/agent:run)    | Simulate/queue urgent follow-up | Redis: `202` + `jobId`; sync: `200` + `totalLogs`.                                                                                                    |

Queue-mode note: `npm run queue:check` accepts both Redis responses (`202` + `jobId`) and sync responses (`200` + `outcomes`/`totalLogs`).

## Security Controls

- **Rate limiting**: per-user/IP on sensitive endpoints.
- **Same-origin**: enforced on mutating sensitive endpoints.
- **Audit logging**: access/deny/action events recorded with integrity signature.
- **No-store**: API responses set `Cache-Control: no-store, max-age=0`.
