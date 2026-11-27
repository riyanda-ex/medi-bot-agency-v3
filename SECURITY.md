# Security Policy

## Supported Version

| Version         | Supported |
| --------------- | --------- |
| `main` / latest | Yes       |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report vulnerabilities privately to the repository owner:

- GitHub: [@riyanda-ex](https://github.com/riyanda-ex)
- Preferred: use GitHub Private Vulnerability Reporting if enabled for this repository.

Include:

- A clear description of the issue and affected component/file.
- Reproduction steps or proof of concept.
- Impact assessment (data exposure, auth bypass, RCE, etc.).
- Suggested fix, if available.

## Response Targets

- **Acknowledgement:** within 3 business days.
- **Initial triage:** within 7 business days.
- **Fix timeline:** based on severity and complexity; critical issues are prioritized.

## Scope Notes

This project handles sensitive clinical data patterns. Reports related to the following are in scope:

- Authentication/session bypass, RBAC bypass, IDOR/data exposure.
- Secret/key exposure, cryptography misuse, audit/log integrity issues.
- Injection, SSRF, path traversal, unsafe file access, insecure deserialization.
- Outbound approval bypass, queue/job signature bypass, rate-limit bypass.
- Deployment/configuration weaknesses that can lead to data compromise.

Out of scope:

- Social engineering, physical attacks, DDoS against third-party infrastructure.
- Issues requiring compromised endpoint/device or already-compromised admin credentials.
- Vulnerabilities only in unsupported dependencies without a project impact path.

## Secure Deployment Checklist

Before production use with real patient data:

- Set strong random `NEXTAUTH_SECRET` and `FIELD_ENCRYPTION_KEY` (>= 32 bytes).
- Set `NEXTAUTH_URL=https://...`, `SYNC_MODE=false`, `REQUIRE_HUMAN_APPROVAL=true`.
- Keep `ALLOW_REAL_OUTBOUND=false` unless explicitly approved and audited.
- Run DB/Redis on private networks; use Redis password/TLS as configured.
- Configure `TRUST_PROXY` only to trusted reverse proxy IPs.
- Enable backups, encrypted restore tests, log monitoring, and incident response.
- Perform external security review/penetration test and legal/compliance review (UU PDP).
