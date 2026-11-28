/**
 * Backup PostgreSQL dengan pg_dump (format custom, cocok untuk pg_restore).
 *
 * Contoh:
 *   DATABASE_URL=postgresql://user:pass@host:5432/medibot \
 *     BACKUP_DIR=./backups BACKUP_RETENTION_DAYS=14 npm run db:backup:pg
 *
 * Kata sandi tidak pernah ditulis ke argumen proses maupun log. Gunakan
 * BACKUP_PASSWORD (secret manager) atau kata sandi di DATABASE_URL.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";

const DAY_MS = 86_400_000;

function parseDatabaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL tidak valid.");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("Backup hanya mendukung DATABASE_URL PostgreSQL.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const username = decodeURIComponent(url.username);
  if (!database || !username || !url.hostname) {
    throw new Error("DATABASE_URL harus memuat username, host, dan nama database.");
  }
  return { url, database, username };
}

function run(command, args, childEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, ...childEnv }
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} gagal (${signal ?? `exit ${code}`}).`));
    });
  });
}

function backupFilePattern(prefix) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}-\\d{8}T\\d{6}Z\\.dump$`);
}

function timestampFromName(name, prefix) {
  const stamp = name.slice(prefix.length + 1, -".dump".length);
  const iso = stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z");
  return Date.parse(iso);
}

async function pruneOldBackups(directory, prefix, retentionDays, dryRun) {
  const pattern = backupFilePattern(prefix);
  const cutoff = Date.now() - retentionDays * DAY_MS;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !pattern.test(entry.name)) continue;
    const createdAt = timestampFromName(entry.name, prefix);
    if (!Number.isFinite(createdAt) || createdAt >= cutoff) continue;
    const target = path.join(directory, entry.name);
    if (dryRun) console.log(`[BACKUP] dry-run: hapus ${target}`);
    else {
      await unlink(target);
      console.log(`[BACKUP] Backup lama dihapus: ${target}`);
    }
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const prefix = process.env.BACKUP_PREFIX ?? "medibot";
  if (!/^[A-Za-z0-9_-]+$/.test(prefix)) {
    throw new Error("BACKUP_PREFIX hanya boleh memuat huruf, angka, _, dan -.");
  }
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? "14");
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error("BACKUP_RETENTION_DAYS harus bilangan bulat >= 1.");
  }

  const { url, database, username } = parseDatabaseUrl(process.env.DATABASE_URL);
  const password = process.env.BACKUP_PASSWORD ?? decodeURIComponent(url.password);
  const directory = path.resolve(process.env.BACKUP_DIR ?? "./backups");
  await mkdir(directory, { recursive: true });

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const file = path.join(directory, `${prefix}-${stamp}.dump`);
  const args = [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--file",
    file,
    "--host",
    url.hostname,
    "--port",
    url.port || "5432",
    "--username",
    username,
    "--dbname",
    database
  ];

  console.log(`[BACKUP] Database ${database} -> ${file}`);
  if (dryRun) {
    console.log(`[BACKUP] dry-run: ${process.env.PG_DUMP_BIN ?? "pg_dump"} ${args.join(" ")}`);
    await pruneOldBackups(directory, prefix, retentionDays, true);
    return;
  }

  await run(process.env.PG_DUMP_BIN ?? "pg_dump", args, password ? { PGPASSWORD: password } : {});
  await pruneOldBackups(directory, prefix, retentionDays, false);
  console.log(`[BACKUP] Selesai. Retensi ${retentionDays} hari.`);
}

main().catch((error) => {
  console.error("[BACKUP] Gagal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
