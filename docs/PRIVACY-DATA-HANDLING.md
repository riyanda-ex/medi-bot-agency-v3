# Privacy & Data Handling

## Data Classification

- **Restricted/PHI-PII**: NIK, phone, diagnosis, anamnesis, medical records, triage details.
- **Confidential**: audit logs, approval records, user accounts, operational logs.
- **Internal**: aggregated reports/metrics without direct identifiers where possible.

## Controls

- **Encryption**: AES-256-GCM for selected sensitive fields; NIK hash for dedup.
- **Masking**: NIK/phone masked in low-privilege views/APIs.
- **Access control**: fail-closed RBAC; diagnosis redacted by role.
- **Audit**: access and sensitive actions logged with integrity signature.
- **Outbound safety**: mock by default; real outbound requires env gate + human approval.

## Retention & Deletion (Production Requirement)

Define and implement before real deployment:

- Audit/agent/operational log retention period (e.g., 1 year or legal requirement).
- Medical record retention per clinic policy/regulation.
- Secure deletion/anonymization workflow and audit trail for deletion.
- Backup retention and encrypted restore testing.

## Compliance Checklist

- UU PDP No. 27/2022 legal basis, consent, purpose limitation, and data subject rights process.
- Data Processing Agreements (DPA) with WhatsApp/phone/email/infra providers.
- Incident breach notification process and contact points.
- Access reviews, least privilege, and staff security training.
