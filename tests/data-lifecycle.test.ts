import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertDestructiveSeedAllowed, resolveSeedAdminPassword } from "../prisma/seed-guard";

const root = fileURLToPath(new URL("..", import.meta.url));
const lifecycleFields = [
  "consentStatus",
  "consentAt",
  "consentRevokedAt",
  "retentionUntil",
  "deletionRequestedAt",
  "deletionReason",
  "deletedAt",
  "anonymizedAt"
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("seed destruktif", () => {
  it("menolak produksi walaupun flag konfirmasi diset", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("ALLOW_DESTRUCTIVE_SEED", "1");
    expect(() => assertDestructiveSeedAllowed()).toThrow(/diblokir di produksi/);
  });

  it("menolak development/test tanpa ALLOW_DESTRUCTIVE_SEED=1", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("ALLOW_DESTRUCTIVE_SEED", "0");
    expect(() => assertDestructiveSeedAllowed()).toThrow(/ALLOW_DESTRUCTIVE_SEED=1/);
  });

  it("mengizinkan penghapusan hanya di test dengan konfirmasi eksplisit", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("ALLOW_DESTRUCTIVE_SEED", "1");
    expect(() => assertDestructiveSeedAllowed()).not.toThrow();
  });

  it("memakai kata sandi dari environment dan menolak nilai pendek", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("SEED_ADMIN_PASSWORD", "local-test-password");
    expect(resolveSeedAdminPassword()).toBe("local-test-password");

    vi.stubEnv("SEED_ADMIN_PASSWORD", "short");
    expect(() => resolveSeedAdminPassword()).toThrow(/minimal 12 byte/);
  });

  it("membuat kata sandi acak bila environment kosong", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("SEED_ADMIN_PASSWORD", "");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const first = resolveSeedAdminPassword();
    const second = resolveSeedAdminPassword();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThan(20);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("dibuat acak"));
  });

  it("tidak memuat kata sandi hardcoded dan memanggil guard sebelum deleteMany", async () => {
    const source = await readFile(`${root}prisma/seed.ts`, "utf8");
    expect(source).not.toContain("password123");
    expect(source).not.toContain("SEED_PASSWORD");
    const guardIndex = source.indexOf("assertDestructiveSeedAllowed()");
    const firstDelete = source.indexOf("deleteMany()");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(firstDelete).toBeGreaterThan(guardIndex);
  });
});

describe("migrasi data lifecycle", () => {
  it.each([
    "prisma/schema.prisma",
    "prisma/schema.postgres.prisma",
    "prisma/migrations/20261127000000_init/migration.sql",
    "prisma/migrations-postgres/20261127000000_init/migration.sql"
  ])("memuat semua field privasi di %s", async (relativePath) => {
    const content = await readFile(`${root}${relativePath}`, "utf8");
    for (const field of lifecycleFields) {
      expect(content, `${relativePath} missing ${field}`).toContain(field);
    }
    expect(content).toContain("sentAt");
    expect(content).toContain("expiresAt");
  });

  it("mengunci provider migrasi secara terpisah untuk SQLite dan PostgreSQL", async () => {
    const sqliteLock = await readFile(`${root}prisma/migrations/migration_lock.toml`, "utf8");
    const postgresLock = await readFile(
      `${root}prisma/migrations-postgres/migration_lock.toml`,
      "utf8"
    );
    expect(sqliteLock).toContain('provider = "sqlite"');
    expect(postgresLock).toContain('provider = "postgresql"');
  });
});
