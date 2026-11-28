# Production Checklist

Use this before exposing MediBot Clinical Operations Platform to real users or clinical data.

## Configuration

- [ ] `NODE_ENV=production`
- [ ] `NEXTAUTH_URL=https://<real-domain>`
- [ ] Strong random `NEXTAUTH_SECRET` (>= 32 bytes, not DEV/CI/placeholder)
- [ ] Strong random `FIELD_ENCRYPTION_KEY` (>= 32 bytes)
- [ ] `SYNC_MODE=false`
- [ ] `REQUIRE_HUMAN_APPROVAL=true`
- [ ] `ALLOW_REAL_OUTBOUND=false` unless explicitly approved
- [ ] Seed never run in production: `assertDestructiveSeedAllowed()` blocks it even if flags are set
- [ ] `ALLOW_DESTRUCTIVE_SEED` unset/`0` in production; seed limited to development/test
- [ ] `SEED_ADMIN_PASSWORD` supplied only for controlled test environments (never production)
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
- [ ] Audit logs monitored; retention/purge policy implemented
- [ ] Dependency scanning/Dependabot alerts enabled
- [ ] External penetration test and threat model completed

## Compliance / Operations

- [ ] UU PDP/privacy review, consent (`PENDING/GRANTED/REVOKED`), retention, DPA with providers
- [ ] Deletion/anonymization workflow tested; `deletedAt`/`anonymizedAt` and audit evidence verified
- [ ] Report `sentAt`/`expiresAt` purge tested; backup expiry aligned with data lifecycle
- [ ] Incident response runbook and on-call alerting
- [ ] Admin session revoke/password reset/MFA process
- [ ] Change management: PR review, CI required, protected `main`
