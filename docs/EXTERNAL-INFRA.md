# External Infrastructure (code/config reference only)

This repository contains **configuration and runbooks, not provisioned
infrastructure**. No cloud account, KMS key, SIEM tenant, or managed database is
created by this project. The owner must provision and approve each item below.

## 1. Secret manager + KMS

- Store `NEXTAUTH_SECRET`, `FIELD_ENCRYPTION_KEY`, `APP_SIGNING_KEY`,
  `FIELD_ENCRYPTION_KEY_PREVIOUS`, SMTP/provider tokens, and database passwords in a secret
  manager. Inject them at container start; never commit `.env` or secret files.
- `docker-compose.yml` shows optional `*_FILE` variables for the official PostgreSQL/Redis
  images. Mount files from the secret manager (or a Docker secret) at runtime.
- Use a KMS/HSM key to encrypt backup objects and volume snapshots. Rotate the KMS key independently
  of application field keys; record both rotations.
- Key rotation order: create new KMS/key version → set new `FIELD_ENCRYPTION_KEY` plus
  `FIELD_ENCRYPTION_KEY_PREVIOUS` → restart app/worker → re-encrypt fields → retire old key.

## 2. PostgreSQL

- Production uses PostgreSQL (`DATABASE_URL=postgresql://...`), not SQLite.
- `docker-compose.yml` defines local PostgreSQL with a loopback-only port and named volume.
  `docker compose --profile app up -d` also starts a one-shot `migrate` service and a `worker`.
- Deploy migrations with:
  `npx prisma migrate deploy --config prisma/postgres.config.ts`.
  SQLite and PostgreSQL migration directories are intentionally separate.
- `--profile ha` adds a **template** standby service. It fails closed unless `standby.signal`
  exists (bootstrap with `pg_basebackup` or use a managed replica). This is not automated failover.
- Point-in-time recovery and encrypted backups are operator responsibilities. Test with
  `npm run db:backup:pg` and `npm run db:restore:pg -- --dry-run`.

## 3. Redis

- Redis is required for distributed rate limits and BullMQ (`QUEUE_MODE=redis`,
  `RATE_LIMIT_MODE=redis`). Use `rediss://` with TLS on any non-private path.
- `redis-ha` under the `ha` profile is a read-replica template (`--replicaof`). It improves read
  availability but does not replace Sentinel/Cluster or a managed failover service.
- Monitor `used_memory`, eviction policy, blocked clients, and queue depth.

## 4. SIEM / WORM logging

- Ship signed audit logs, API logs, worker logs, and health-check failures to a SIEM.
- Configure retention according to clinic policy; write audit evidence to WORM/object-lock storage
  so it cannot be altered by app administrators.
- Alert on: repeated 401/403, approval denials, consent revocation followed by outbound attempts,
  restore operations, seed-guard failures, and `/api/ready` 503s.
- Log shipping credentials are secrets; prefer a sidecar/agent with its own role.

## 5. Runtime hardening in this repo

- `Dockerfile` uses Node 24 Alpine, standalone Next output, a non-root user, and `dumb-init` so
  `SIGTERM` reaches the server/worker. Runtime contains no dev dependencies beyond traced files
  plus `tsx`/`esbuild` needed by the worker.
- `docker-compose.yml` gates `app`/`worker` on migration completion and app readiness
  (`/api/ready`), gives both a 30-second graceful-stop window, drops Linux capabilities, and keeps
  ports on loopback.
- CI pins actions to commit SHAs, uses Node 24/npm 11.20.0, and never receives production secrets.

## 6. What is intentionally NOT implemented here

- Cloud provisioning, IAM policies, TLS certificates, network peering, DNS, and firewall rules.
- Automated database/Redis failover, PITR orchestration, or SIEM ingestion pipelines.
- Real WhatsApp/phone/email delivery; providers remain mocked unless explicitly enabled with
  approval and signed DPAs.

See [`PRODUCTION-CHECKLIST.md`](PRODUCTION-CHECKLIST.md) before exposing the service to real data.
