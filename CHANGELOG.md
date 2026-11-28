# Changelog

All notable changes to this repository should be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows semantic versioning where practical.

## [Unreleased]

> Approved audit recommendations implemented on this branch, with regression tests and verified dev/production E2E runs.

### Security (approved audit)

- Validate secure environment configuration at boot via `instrumentation`; fail closed when the signing key is missing or unsafe.
- Validate `TRUST_PROXY` IPs and derive the client IP from the rightmost untrusted `X-Forwarded-For` hop.
- Make Redis rate limiting atomic and fail closed in production.
- Bind approvals to a channel and enforce single use per stage.
- Fix RBAC permission names and broaden PHI redaction.
- Store report files per `reportId` with a strict extension allowlist.

### Changed (approved audit)

- Use a shared WIB date helper, set `simulated` from provider results, and add a `PARTIAL` status.
- Add queue DLQ/alerting and avoid full-agent retry side effects.
- Consolidate API response wrappers/schemas and clean up dependencies/configuration.
- Sync documentation with code: both READMEs, API health/readiness endpoints, production startup, queue-check behavior, and no hardcoded test counts.
- Add regression tests for proxy IP spoofing, approval binding/replay, atomic rate limiting, MERAH dedupe, WIB dates, provider flags, report path containment, and PHI redaction.
- Keep the scoped `exceljs` → `uuid@11.1.1` override so `npm audit` reports zero known vulnerabilities.

### Fixed

- Earlier `f44a5ba`: empty `SEED_PASSWORD` falls back safely, and `queue:check` supports sync mode (HTTP 200 + `outcomes`/`totalLogs`) as well as Redis (HTTP 202 + `jobId`).

### Changed (repository presentation)

- Rebranded display name to **MediBot Clinical Operations Platform** for a more professional, international presentation.
- Added Indonesian README translation (`README.id.md`) and language switch links.

### Added

- Repository governance files: security policy, Dependabot, CODEOWNERS, issue/PR templates.
- Documentation: structure guide and production checklist.
- Professional repo metadata and community files.

### Security

- API hardening: rate limits, same-origin checks, trusted proxy handling, security headers/CSP.

## [0.1.0] - 2026-11-26

### Added

- Initial MediBot Clinical Operations Platform foundation: Next.js app, 7 agents, Prisma schema/seed, RBAC, audit, approval, queue, reports, tests, and CI.
