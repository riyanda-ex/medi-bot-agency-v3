# Architecture

## Overview

MediBot Clinical Operations Platform is a Next.js App Router application for Indonesian clinic workflows. It combines UI routes, API routes, domain agents, and infrastructure guards.

## Layers

```text
UI (app/*, components/*)
  -> API Routes (app/api/*)
    -> Guards (auth, RBAC, rate limit, origin, env)
      -> Domain Agents (agents/*)
        -> Shared Infra (lib/*)
          -> Prisma / DB / Queue / External Providers
```

## Key Components

- **Auth & Session**: NextAuth credentials + JWT, DB revalidation in `lib/auth.ts`.
- **RBAC**: fail-closed roles/permissions in `lib/rbac.ts`.
- **Request Guard**: origin and rate limiting in `lib/requestGuard.ts`.
- **Audit**: signed API/audit records in `lib/audit.ts` and `agents/securityGuard.ts`.
- **Approval**: HMAC-signed human approval for real outbound actions in `lib/approval.ts`.
- **Queue**: signed/Zod-validated jobs; sync default, BullMQ+Redis optional in `lib/queue.ts`.
- **Agents**: analyzer, orchestrator, bug hunter, reporter, urgent caller, security guard, engagement.

## Data Flow (Sensitive)

1. Request enters API route.
2. Route checks auth/session, RBAC, same-origin (mutations), and rate limit.
3. Input validated with Zod.
4. Agent/lib performs action; sensitive fields encrypted/masked as needed.
5. Audit event recorded with actor, role, path, IP, UA, signature.
6. Outbound real actions require `ALLOW_REAL_OUTBOUND=true` and valid human approval.

## Runtime Modes

- **Dev/Test default**: SQLite, `SYNC_MODE=true`, mock providers, no Docker required.
- **Production**: PostgreSQL, Redis/BullMQ worker, strong secrets, HTTPS, `SYNC_MODE=false`, approvals enforced.
