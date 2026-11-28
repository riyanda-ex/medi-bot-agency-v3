# Production Checklist

Use this before exposing MediBot Clinical Operations Platform to real users or clinical data.

## Configuration

- [ ] `NODE_ENV=production`
- [ ] `NEXTAUTH_URL=https://<real-domain>`
- [ ] Strong random `NEXTAUTH_SECRET` (>= 32 bytes, not DEV/CI/placeholder)
- [ ] Strong random `FIELD_ENCRYPTION_KEY` (>= 32 bytes)
- [ ] `DATABASE_URL` points to PostgreSQL (SQLite is local dev only)
- [ ] `SYNC_MODE=false`
- [ ] `QUEUE_MODE=redis` with `REDIS_URL` and a running BullMQ worker
- [ ] `RATE_LIMIT_MODE=redis` for rate-limit state shared across instances
- [ ] `READY_TOKEN` set to a random token; production `GET /api/ready` requires `Authorization: Bearer <READY_TOKEN>` or `x-ready-token` (`403` otherwise)
- [ ] `REQUIRE_HUMAN_APPROVAL=true`
- [ ] `ALLOW_REAL_OUTBOUND=false` unless explicitly approved
- [ ] `ALLOW_SEED=false` (seed only controlled test env)
- [ ] `TRUST_PROXY` set to trusted reverse proxy IPs only

## Network & Infrastructure

- [ ] HTTPS/TLS termination at trusted reverse proxy/load balancer
- [ ] App, PostgreSQL, Redis not exposed publicly; private network/firewall rules
- [ ] Redis password enabled; TLS/rediss for non-local/public paths (CI Redis is passwordless for tests only)
- [ ] Database backups encrypted; restore tested regularly
- [ ] Secret manager/KMS used for secrets and key rotation plan

## Startup & Health

- [ ] Start infrastructure only with `docker compose up -d`; app and worker require `docker compose --profile app up -d` (both use the `app` profile).
- [ ] Run the worker and server as separate processes: `npm run queue:worker` in one terminal (blocking), `npm run start` in another.
- [ ] `GET /api/health` (liveness) returns 200 and `GET /api/ready` with the configured token (DB + Redis readiness) returns 200 before routing traffic. Healthchecks use `/api/health`; in non-production `/api/ready` stays open when the token is unset.
- [ ] `npm run queue:check` passes in Redis mode (`202` + `jobId`); the script also accepts sync mode (`200` + outcomes/`totalLogs`) for local checks.

## Application Security

- [ ] RBAC reviewed for least privilege/data minimization (permission names verified)
- [ ] Rate limiting backed by Redis and fail closed in production; proxy IP validation uses the rightmost untrusted `X-Forwarded-For` hop
- [ ] Signing key validated at boot; queue DLQ and alerting configured
- [ ] Security headers/CSP validated against real frontend behavior
- [ ] Audit logs monitored; retention/purge policy implemented
- [ ] Dependency scanning/Dependabot alerts enabled
- [ ] External penetration test and threat model completed

## Compliance / Operations

- [ ] UU PDP/privacy review, consent, retention, DPA with providers
- [ ] Incident response runbook and on-call alerting
- [ ] Admin session revoke/password reset/MFA process
- [ ] Change management: PR review, CI required, protected `main`
