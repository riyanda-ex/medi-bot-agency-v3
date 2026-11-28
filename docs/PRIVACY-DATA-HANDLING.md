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
- **Data subject rights**: `POST /api/me/privacy-requests` opens a ticket with a **3×24 h (72 h)** SLA,
  `GET /api/me/privacy-requests` lists only the patient's own tickets, and `PATCH /api/privacy-requests/[id]`
  is ADMIN-only verification. Deletion/anonymisation additionally requires an approved ticket, consent
  `REVOKED` (or non-null `consentRevokedAt`), expiry of the 25-year clinical retention window, and no
  legal hold. Consent withdrawal creates a completed 72 h SLA record immediately because
  patient-directed outbound processing stops at once.
- **Retention**: `retentionUntil` is derived from the **last visit + 25 years** (Permenkes 24/2022), not from
  the revocation date; a patient with no visit uses a 30-day administrative window. `npm run retention:sweep`
  realigns this weekly and reports overdue tickets; it never destroys clinical facts.
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

1. Patient-directed WhatsApp/phone follow-up requires `GRANTED` consent **and** signed human approval
   at execution (`agents/urgentCaller.ts`).
2. `REVOKED` blocks patient-directed WhatsApp/phone jobs at call time, including jobs already queued.
   Staff report email (`agents/reporter.ts`) is gated by approval only and does not re-check consent.
3. Revocation and deletion requests are written to signed audit logs (actor, role, IP, path).
4. Medical record retention overrides a quick deletion request where law requires retention:
   anonymize identifiers instead of erasing the clinical record.

## Retention & Deletion

- API logs: default 30 days via `API_LOG_RETENTION_DAYS` (max 365); agent logs follow their own settings.
- Audit rows: 365-day review target; signed rows are append-only in routine production, not silently
  rewritten or bulk-deleted (destructive dev/test seed excepted). Archive to WORM/SIEM before any
  formal deletion.
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
- Production requires a distinct random `APP_SIGNING_KEY` and rejects placeholder, `DEV-ONLY`,
  and CI-default secrets (`lib/env.ts`). A missing signing key is a startup error, not a silent
  fallback to legacy derived keys.

## Access Control & Outbound Safety

- Fail-closed RBAC; diagnosis redacted by role; every sensitive read/denial is audited.
- Mock providers by default. `ALLOW_REAL_OUTBOUND=false` and `REQUIRE_HUMAN_APPROVAL=true` are
  mandatory unless explicitly approved; production forces approval.
- Approval tokens are HMAC-signed with a short TTL and re-validated by the worker/provider.
- `APP_SIGNING_KEY` is mandatory in production; deliver single-use password-reset links only via
  configured SMTP and never log raw links (dev/staging included).

## Compliance Checklist

- [ ] Consent notices and PDP legal basis approved by clinic/legal owner.
- [ ] DPA signed with every provider that receives personal data.
- [ ] Retention/anonymization schedule configured and tested.
- [ ] Key rotation and backup restore drills documented with evidence.
- [ ] Access reviews, least privilege, and staff security training completed.
