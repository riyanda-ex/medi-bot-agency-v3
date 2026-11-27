# Repository Structure

This document describes the intended structure of MediBot Clinical Operations Platform.

## Top-Level

| Path          | Purpose                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `app/`        | Next.js App Router UI and API routes.                                         |
| `agents/`     | Domain/agent logic (analyzer, orchestrator, triage caller, reporter, etc.).   |
| `lib/`        | Shared runtime infrastructure: auth, RBAC, env, crypto, audit, queue, guards. |
| `components/` | Reusable UI components.                                                       |
| `prisma/`     | Prisma schema, migrations/DB push target, seed.                               |
| `scripts/`    | Operational scripts (worker, E2E, queue check, schema sync).                  |
| `tests/`      | Vitest tests.                                                                 |
| `fixes/`      | Bug-hunter artifacts/helpers and their tests.                                 |
| `reports/`    | Generated report outputs (gitignored).                                        |
| `docs/`       | Project documentation.                                                        |
| `.github/`    | CI, Dependabot, CODEOWNERS, templates.                                        |

## Placement Rules

- **HTTP boundary concerns** (auth check, RBAC, rate limit, origin, audit request) live in `app/api/**/route.ts`.
- **Reusable security/runtime logic** lives in `lib/` (no route-specific UI).
- **Clinical/business rules** live in `agents/` or `lib/triageRules.ts` as appropriate.
- **Secrets/config validation** lives in `lib/env.ts` and `.env.example`; never hardcode secrets.
- **Tests**: `tests/*.test.ts` for core; `fixes/*.test.ts` for bug-hunter helper artifacts.
- **Generated artifacts** (`reports/`, DB files, build output) must not be committed.

## Security-Sensitive Files

Changes to these require careful review:

- `lib/auth.ts`, `lib/rbac.ts`, `lib/approval.ts`, `lib/audit.ts`
- `lib/crypto.ts`, `lib/env.ts`, `lib/requestGuard.ts`, `lib/rateLimit.ts`
- `lib/queue.ts`, `scripts/queue-worker.ts`
- `proxy.ts`, `next.config.mjs`, `.github/workflows/ci.yml`
