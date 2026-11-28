# Production Checklist

Use this before exposing MediBot Clinical Operations Platform to real users or clinical data.

## Configuration

- [ ] `NODE_ENV=production`
- [ ] `NEXTAUTH_URL=https://<real-domain>`
- [ ] Strong random `NEXTAUTH_SECRET` (>= 32 bytes, not DEV/CI/placeholder)
- [ ] Strong random `FIELD_ENCRYPTION_KEY` (>= 32 bytes)
- [ ] Strong random `APP_SIGNING_KEY` (>= 32 bytes), distinct from auth/field keys (guard enforces)
- [ ] `METRICS_TOKEN` set from secret manager before enabling `/api/metrics` scraping
- [ ] `SYNC_MODE=false`
- [ ] `REQUIRE_HUMAN_APPROVAL=true`
- [ ] `ALLOW_REAL_OUTBOUND=false` unless explicitly approved
- [ ] Seed never run in production: `assertDestructiveSeedAllowed()` blocks it even if flags are set
- [ ] `ALLOW_DESTRUCTIVE_SEED` unset/`0` in production; seed limited to development/test
- [ ] `SEED_ADMIN_PASSWORD` supplied only for controlled test environments (never production)
- [ ] SMTP configured for password-reset email; raw reset links are never logged (dev/staging too)
- [ ] `TRUST_PROXY` set to trusted reverse proxy IPs only
- [ ] `RATE_LIMIT_MODE=redis` with shared Redis (production env guard enforces this)

## Network & Infrastructure

- [ ] HTTPS/TLS termination at trusted reverse proxy/load balancer
- [ ] App, PostgreSQL, Redis not exposed publicly; private network/firewall rules
- [ ] Redis password enabled; TLS/rediss for non-local/public paths
- [ ] PostgreSQL migrations deployed with `prisma/postgres.config.ts`; no `db push` on production data
- [ ] Backups encrypted with KMS-managed keys, retained per policy, restore drill recorded
- [ ] Secret manager/KMS used for secrets; `FIELD_ENCRYPTION_KEY_PREVIOUS` rotation runbook tested
- [ ] Docker image runs as non-root with dumb-init; `/api/ready` used for healthchecks
- [ ] `docker compose --profile app up -d` verified (migrate → app ready → worker)
- [ ] `ha` profile only enabled after external replication/failover is provisioned
- [ ] SIEM/WORM log sink configured with retention and alert rules

## Application Security

- [ ] RBAC reviewed for least privilege/data minimization
- [ ] Rate limiting backed by shared store (Redis) for multi-instance
- [ ] Security headers/CSP validated against real frontend behavior
- [ ] Audit signatures verified weekly with `npm run audit:verify`; failures alerted
- [ ] Retention/purge policy implemented; routine production retention does not bulk-delete signed
      audit rows (destructive dev/test seed excepted)
- [ ] BullMQ DLQ monitored; `npm run queue:replay -- --list` reviewed and replay runbook tested
- [ ] Dependency scanning/Dependabot alerts enabled
- [ ] External penetration test and threat model completed

## Compliance / Operations

- [ ] UU PDP/privacy review, consent (`PENDING/GRANTED/REVOKED`), 25-year retention, DPA with providers
- [ ] DSR tickets answered within 72 h; `npm run retention:sweep` scheduled and reviewed
- [ ] Deletion/anonymization workflow tested; clinical facts preserved and legal hold respected
- [ ] Report `sentAt`/`expiresAt` purge tested; backup expiry aligned with data lifecycle
- [ ] Incident response runbook and on-call alerting
- [ ] Admin session revoke/password reset/MFA process enforced for privileged accounts
- [ ] Clinic SOP signed and triage thresholds clinically validated (external sign-off)
- [ ] Change management: PR review, CI required, protected `main`
