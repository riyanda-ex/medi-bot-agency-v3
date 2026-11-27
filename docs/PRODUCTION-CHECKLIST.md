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
- [ ] `ALLOW_SEED=false` (seed only controlled test env)
- [ ] `TRUST_PROXY` set to trusted reverse proxy IPs only

## Network & Infrastructure

- [ ] HTTPS/TLS termination at trusted reverse proxy/load balancer
- [ ] App, PostgreSQL, Redis not exposed publicly; private network/firewall rules
- [ ] Redis password enabled; TLS/rediss for non-local/public paths
- [ ] Database backups encrypted; restore tested regularly
- [ ] Secret manager/KMS used for secrets and key rotation plan

## Application Security

- [ ] RBAC reviewed for least privilege/data minimization
- [ ] Rate limiting backed by shared store (Redis) for multi-instance
- [ ] Security headers/CSP validated against real frontend behavior
- [ ] Audit logs monitored; retention/purge policy implemented
- [ ] Dependency scanning/Dependabot alerts enabled
- [ ] External penetration test and threat model completed

## Compliance / Operations

- [ ] UU PDP/privacy review, consent, retention, DPA with providers
- [ ] Incident response runbook and on-call alerting
- [ ] Admin session revoke/password reset/MFA process
- [ ] Change management: PR review, CI required, protected `main`
