# ADR 0003: Sync and Redis Queue Modes

- Status: Accepted
- Date: 2026-11-27

## Context

Local development must be simple on Windows; production needs durable async processing.

## Decision

Support `QUEUE_MODE=sync` for dev/test and `QUEUE_MODE=redis` for BullMQ worker-based production. Queue payloads are HMAC-signed and Zod-validated.

## Consequences

- Easy local setup with no Docker dependency.
- Production requires separate worker process and secure Redis configuration.
