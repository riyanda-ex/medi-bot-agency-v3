# Privacy & Data Handling

MediBot processes Indonesian patient data. Treat every patient record as
**Restricted/PHI-PII** even when a value is masked in the UI.

## Data Classification

- **Restricted/PHI-PII**: NIK, phone, name/address, diagnosis, anamnesis, medical records, triage details.
- **Confidential**: audit logs, approval records, user accounts, operational logs, queue jobs.
- **Internal**: aggregated reports/metrics without direct identifiers where possible.

## UU PDP No. 27/2022 (Personal Data Protection)

- **Legal basis & purpose**: consent (`consentStatus`) for treatment/reminders/outbound contact;
  record the time of grant/revocation. Do not broaden purpose without a new notice.
- **Data minimization**: collect only fields required for triage/reporting; mask NIK/phone for
  low-privilege roles; never place diagnosis or vital numbers in outbound messages.
- **Data subject rights**: access, correction, revocation, and deletion are handled through the
  privacy routes (see `docs/API.md`) with an audit trail and actor identity.
- **DPA**: written agreements with WhatsApp/phone/email/cloud providers before real outbound use.
- **Breach response**: follow `docs/INCIDENT-RESPONSE.md`; notify the controller/authority per
  the applicable PDP timeline.

## Consent Lifecycle

`Patient` fields are the source of truth:

| Field                                   | Values / meaning                                          |
| --------------------------------------- | --------------------------------------------------------- |
| `consentStatus`                         | `PENDING` (default), `GRANTED`, `REVOKED`                 |
| `consentAt`                             | When the patient/granted party consented                  |
| `consentRevokedAt`                      | When consent was withdrawn                                |
| `retentionUntil`                        | Per-record retention deadline (nullable = clinic policy)  |
| `deletionRequestedAt`, `deletionReason` | Data subject deletion request and its reason              |
| `deletedAt`                             | Soft-delete timestamp; record is no longer active         |
| `anonymizedAt`                          | Identifiers irreversibly replaced after retention expires |

Rules enforced by the application/hardening layer:

1. No real outbound WhatsApp/phone/email without `GRANTED` consent **and** human approval.
2. `REVOKED` blocks new outbound jobs immediately; already queued jobs must re-check consent.
3. Revocation and deletion requests are written to signed audit logs (actor, role, IP, path).
4. Medical record retention overrides a quick deletion request where law requires retention:
   anonymize identifiers instead of erasing the clinical record.

## Retention & Deletion

- Audit/agent/API logs: target 1 year (configurable via `API_LOG_RETENTION_DAYS`); audit records
  with integrity signatures are not silently rewritten.
- Medical records: follow clinic policy/regulation; use `retentionUntil` and anonymization when
  the statutory period has not expired.
- Reports: `Report.sentAt` records delivery, `Report.expiresAt` records when generated files must
  be purged from `reports/`.
- Backups: default `BACKUP_RETENTION_DAYS=14`; encrypted at rest; restore drills must be logged.
- Deletion workflow: request → verify identity/authority → decide retain vs anonymize → apply →
  record `deletedAt`/`anonymizedAt` → keep audit evidence → verify backups expire on schedule.

## Encryption & Key Rotation

- Field encryption: AES-256-GCM, `v2:<kid>:<iv>:<tag>:<ciphertext>`; NIK is also HMAC-hashed for
  duplicate detection and masked in low-privilege views.
- `FIELD_ENCRYPTION_KEY` is the active key. `APP_SIGNING_KEY` is an independent HMAC key for
  approvals/queue payloads; it must never be derived from auth secrets.
- Rotation: set `FIELD_ENCRYPTION_KEY_PREVIOUS` (aliases: `_OLD`, `_V1`) to the retired key. Old
  values are accepted for decryption only; new writes always use the active key and `kid`.
- Re-encrypt stored fields during a maintenance window; keep old keys available until the rewrite
  completes. In production, keys come from a KMS/secret manager, never from repository files.
- Production rejects placeholder, `DEV-ONLY`, and CI-default secrets (`lib/env.ts`).

## Access Control & Outbound Safety

- Fail-closed RBAC; diagnosis redacted by role; every sensitive read/denial is audited.
- Mock providers by default. `ALLOW_REAL_OUTBOUND=false` and `REQUIRE_HUMAN_APPROVAL=true` are
  mandatory unless explicitly approved; production forces approval.
- Approval tokens are HMAC-signed with a short TTL and re-validated by the worker/provider.

## Compliance Checklist

- [ ] Consent notices and PDP legal basis approved by clinic/legal owner.
- [ ] DPA signed with every provider that receives personal data.
- [ ] Retention/anonymization schedule configured and tested.
- [ ] Key rotation and backup restore drills documented with evidence.
- [ ] Access reviews, least privilege, and staff security training completed.
