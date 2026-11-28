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

### Changed

- Docker image now uses Node 24, standalone output, non-root user, dumb-init, and ships worker scripts/`tsx`.
- Compose now checks `/api/ready`, gates app/worker on migrations and readiness, adds volumes and opt-in `ha` profile.
- CI pins actions to commit SHAs and uses Node 24 + npm 11.20.0 with CI-only throwaway values.
- Seed requires `ALLOW_DESTRUCTIVE_SEED=1` in dev/test and never runs in production; passwords come from `SEED_ADMIN_PASSWORD`.

### Security

- API hardening: rate limits, same-origin checks, trusted proxy handling, security headers/CSP.
- Data-at-rest hardening: consent/retention/deletion fields, documented key rotation, encrypted backup/restore drills.

## [0.1.0] - 2026-11-26

### Added

- Initial MediBot Clinical Operations Platform foundation: Next.js app, 7 agents, Prisma schema/seed, RBAC, audit, approval, queue, reports, tests, and CI.
