# Threat Model (STRIDE Summary)

> Living document. Review before major releases and before any real clinical deployment.

## Assets

- Patient PII/PHI (NIK, phone, diagnosis, records, triage data).
- Credentials, sessions, API keys/tokens, encryption keys.
- Audit logs, approval records, queue jobs, generated reports.
- Availability of triage/report/orchestrator workflows.

## Trust Boundaries

1. Public browser/client -> Next.js routes/proxy.
2. Next.js app -> PostgreSQL/SQLite.
3. Next.js app/worker -> Redis/BullMQ.
4. Worker/app -> external providers (WhatsApp/phone/email) when enabled.
5. Admin/doctor/operator actions -> approval-gated outbound channels.

## STRIDE Mitigations

| Threat                 | Example                    | Mitigations                                                                                            | Residual Risk                                          |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Spoofing               | Stolen credentials/session | NextAuth, DB session revalidation, strong secrets, production HTTPS guard                              | MFA not yet enforced                                   |
| Tampering              | Forged queue job/approval  | HMAC-signed approvals/jobs, Zod validation, audit signatures, key rotation via `kid` + previous keys   | Key compromise impact                                  |
| Repudiation            | User denies action         | Signed audit logs with actor/role/IP/UA/path; WORM/SIEM sink documented                                | Centralized immutable log storage must be provisioned  |
| Information Disclosure | Diagnosis/PII leak         | RBAC fail-closed, redaction, AES-256-GCM, masking, no-store API, consent/deletion fields               | Data minimization/assignment model can be tightened    |
| Denial of Service      | Endpoint abuse             | Redis-backed rate limits, same-origin, body validation, queue separation                               | Multi-instance Redis HA must be provisioned            |
| Elevation of Privilege | Role bypass/IDOR           | RBAC checks, server-side session checks, approval checks                                               | Needs periodic pentest and authz tests                 |
| Destructive operations | Seed wipes production DB   | `assertDestructiveSeedAllowed()`: dev/test only + `ALLOW_DESTRUCTIVE_SEED=1`; production always throws | Operator error if flags copied to prod config          |
| Data loss              | Bad restore/expired keys   | Encrypted pg_dump backups, retention pruning, restore confirmation, key rotation with previous key     | Restore drills and KMS provisioning are operator tasks |

## Required Before Production

- External penetration test and remediation.
- Centralized monitoring/SIEM + WORM retention provisioned and alert rules tested.
- Redis-backed distributed rate limiting and HA/failover provisioned externally.
- MFA + session revocation/admin controls.
- Backup/restore drills (`npm run db:backup:pg`, `npm run db:restore:pg -- --dry-run`).
- KMS/secret manager integration and field-key rotation runbook (see `docs/EXTERNAL-INFRA.md`).
- Consent/retention/deletion workflow verified against UU PDP and medical retention rules.
- CI pinned to commit SHAs; production secrets never exposed to CI.
- Standalone container verified with non-root user, dumb-init, migration gate, and `/api/ready`.
