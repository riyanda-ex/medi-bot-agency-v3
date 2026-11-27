# ADR 0002: Next.js App Router and Proxy

- Status: Accepted
- Date: 2026-11-27

## Context

The app needs modern React/Next security updates and server-side route controls.

## Decision

Use Next.js 16 App Router. Use `proxy.ts` for protected-route session/role checks and security headers on matched routes.

## Consequences

- Aligns with current Next.js security patches.
- Requires following Next.js 16 proxy conventions; `middleware.ts` is not used.
