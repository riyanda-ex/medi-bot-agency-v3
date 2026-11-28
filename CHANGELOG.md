# Changelog

All notable changes to this repository should be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows semantic versioning where practical.

## [Unreleased]

### Changed

- Rebranded display name to **MediBot Clinical Operations Platform** for a more professional, international presentation.
- Added Indonesian README translation (`README.id.md`) and language switch links.

### Added

- Repository governance files: security policy, Dependabot, CODEOWNERS, issue/PR templates.
- Documentation: structure guide and production checklist.
- Professional repo metadata and community files.
- Initial SQLite/PostgreSQL migrations and `prisma/postgres.config.ts` for migration deploys.
- `scripts/backup-postgres.mjs` / `scripts/restore-postgres.mjs` with retention and restore confirmation.
- Privacy lifecycle docs: `DATA-LIFECYCLE.md`, `EXTERNAL-INFRA.md`, expanded privacy/checklist/threat model.
- `tests/data-lifecycle.test.ts` for seed guards and migration field sanity.
- TOTP MFA with single-use recovery codes, self-service password reset, and admin session revocation.
- Data-subject request tickets with a 72 h SLA, 25-year clinical retention derived from the last
  visit, legal hold, and a weekly `npm run retention:sweep`.
- Audit signature verification (`npm run audit:verify`), metrics endpoint, smoke load check with
  p95 SLO, cursor pagination, streaming report downloads, and BullMQ DLQ inspection/replay.
- Non-technical `docs/STAFF-GUIDE.md` and signable `docs/SOP-KLINIK.md` draft.

### Changed — Operations

- Docker image now uses Node 24, standalone output, non-root user, dumb-init, and ships worker scripts/`tsx`.
- Compose now checks `/api/ready`, gates app/worker on migrations and readiness, adds volumes and opt-in `ha` profile.
- CI pins actions to commit SHAs and uses Node 24 + npm 11.20.0 with CI-only throwaway values.
- Seed requires `ALLOW_DESTRUCTIVE_SEED=1` in dev/test and never runs in production; passwords come from `SEED_ADMIN_PASSWORD`.
- Node baseline raised to 24 (`package.json`, `.nvmrc`, badges); 21 Prisma models and 148 tests.
- CI coverage baseline: 53.60% statements, 49.88% branches, 65.63% functions, 54.97% lines.

### Security

- API hardening: rate limits, same-origin checks, trusted proxy handling, security headers/CSP.
- Data-at-rest hardening: consent/retention/deletion fields, documented key rotation, encrypted backup/restore drills.
- Real outbound now re-checks consent at call time; approvals are single-use and denials are audited.
- `APP_SIGNING_KEY` is required in production; audit/approval/queue signing no longer silently falls
  back to a key derived from authentication secrets.
- Signed audit rows are verified rather than only written, and routine retention no longer deletes them.
- DLQ replay revalidates HMAC signatures and Zod schemas before requeueing a failed job.
- Clinical facts are preserved during identity anonymisation; medical-record e-signature fields added.

## [0.1.0] - 2026-11-26

### Added

- Initial MediBot Clinical Operations Platform foundation: Next.js app, 7 agents, Prisma schema/seed, RBAC, audit, approval, queue, reports, tests, and CI.
