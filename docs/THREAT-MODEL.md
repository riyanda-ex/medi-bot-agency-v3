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

| Threat                 | Example                    | Mitigations                                                               | Residual Risk                                       |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------- |
| Spoofing               | Stolen credentials/session | NextAuth, DB session revalidation, strong secrets, production HTTPS guard | MFA not yet enforced                                |
| Tampering              | Forged queue job/approval  | HMAC-signed approvals/jobs, Zod validation, audit signatures              | Key compromise impact                               |
| Repudiation            | User denies action         | Signed audit logs with actor/role/IP/UA/path                              | Centralized immutable log storage recommended       |
| Information Disclosure | Diagnosis/PII leak         | RBAC fail-closed, redaction, AES-256-GCM, masking, no-store API           | Data minimization/assignment model can be tightened |
| Denial of Service      | Endpoint abuse             | Rate limits, same-origin, body validation, queue separation               | In-memory limiter not shared across instances       |
| Elevation of Privilege | Role bypass/IDOR           | RBAC checks, server-side session checks, approval checks                  | Needs periodic pentest and authz tests              |

## Required Before Production

- External penetration test and remediation.
- Centralized monitoring/SIEM alerting.
- Redis-backed distributed rate limiting.
- MFA + session revocation/admin controls.
- Backup/restore drills and key rotation runbook.
