# Contributing

Thank you for your interest in MEDI-BOT AGENCY v3. This repository is proprietary; contributions are accepted only with explicit written authorization from the owner (`riyanda-ex`).

## Before Contributing

- Read [`LICENSE`](LICENSE) and [`SECURITY.md`](SECURITY.md).
- Do **not** report vulnerabilities in public issues. Use the private security reporting path.
- Do **not** include real patient data, secrets, API keys, or PHI/PII in issues, PRs, logs, or tests.

## Development Setup

```powershell
Copy-Item .env.example .env
npm install
npm run db:setup
npm run dev
```

## Quality Checks

Run before opening a PR:

```powershell
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

For API/queue changes, also run relevant checks:

```powershell
npm run e2e
npm run queue:check
```

## Pull Request Guidelines

- Keep changes focused and explain security/data impact.
- Follow existing structure: `app/` for routes/UI, `lib/` for shared runtime, `agents/` for domain logic.
- Add or update tests for behavior/security changes.
- Update docs (`README.md`, `docs/*`, `.env.example`) when configuration or behavior changes.
- Never weaken auth, RBAC, audit, approval, encryption, or outbound guards without explicit owner approval.

## Commit Style

Use clear, imperative commit messages, e.g.:

- `Harden API rate limiting for triage endpoint`
- `Add production checklist documentation`
