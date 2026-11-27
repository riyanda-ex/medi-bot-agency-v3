# Incident Response Runbook

## Severity Levels

- **SEV-1**: confirmed data breach, auth bypass, active exploitation.
- **SEV-2**: high-risk vulnerability or suspicious access with potential data exposure.
- **SEV-3**: degraded security control, failed job/audit anomaly, no confirmed breach.

## Immediate Actions

1. **Contain**: disable affected endpoint/feature, rotate secrets/keys, revoke sessions (`tokenVersion` bump), block abusive IPs at edge.
2. **Preserve evidence**: collect app logs, audit logs, DB snapshots, queue/job metadata, CI/deploy history.
3. **Assess scope**: identify affected users/patients, data types, time window, and attack vector.
4. **Eradicate**: patch vulnerability, add tests, validate fix in staging.
5. **Recover**: restore safe service, monitor for recurrence, confirm backups/integrity.
6. **Notify**: follow legal/compliance obligations (UU PDP/regulatory/contractual).

## Communication

- Security contact per [SECURITY.md](../SECURITY.md).
- Maintain internal incident timeline and decision log.
- Do not disclose sensitive details publicly before remediation and legal review.

## Post-Incident

- Root cause analysis.
- Add regression tests and monitoring/alerts.
- Update threat model, checklist, and runbooks.
