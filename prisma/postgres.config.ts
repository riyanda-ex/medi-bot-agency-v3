/**
 * Konfigurasi Prisma khusus PostgreSQL.
 *
 * Schema PostgreSQL dibuat oleh scripts/sync-postgres-schema.mjs dan sengaja
 * berada di luar prisma/migrations (yang dikunci untuk SQLite). Pakai config ini
 * untuk migrate deploy, misalnya:
 *   npx prisma migrate deploy --config prisma/postgres.config.ts
 */
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  // Path relatif terhadap file config ini (prisma/), bukan root repository.
  schema: "schema.postgres.prisma",
  migrations: {
    path: "migrations-postgres"
  },
  datasource: {
    url: env("DATABASE_URL")
  }
});
