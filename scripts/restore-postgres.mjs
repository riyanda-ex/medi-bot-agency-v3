/**
 * Restore PostgreSQL dari dump pg_dump format custom.
 *
 * Contoh (RESTORE_CONFIRM WAJIB sesuai nama database):
 *   DATABASE_URL=postgresql://user:pass@host:5432/medibot \
 *     RESTORE_FILE=./backups/medibot-20260101T000000Z.dump \
 *     RESTORE_CONFIRM=RESTORE:medibot RESTORE_ALLOW_DATA_LOSS=1 \
 *     npm run db:restore:pg
 *
 * Flag: --dry-run, --no-clean (tanpa DROP objects).
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import path from "node:path";

function parseDatabaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL tidak valid.");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("Restore hanya mendukung DATABASE_URL PostgreSQL.");
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

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const clean = !argv.includes("--no-clean");
  const fileArgument = process.env.RESTORE_FILE ?? argv.find((arg) => !arg.startsWith("--"));
  if (!fileArgument) {
    throw new Error("RESTORE_FILE wajib diisi (atau berikan path dump sebagai argumen).");
  }

  const backupDirectory = path.resolve(process.env.BACKUP_DIR ?? "./backups");
  const file = path.resolve(fileArgument);
  const relative = path.relative(backupDirectory, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("RESTORE_FILE harus berada di dalam BACKUP_DIR.");
  }
  await access(file);
  const info = await stat(file);
  if (!info.isFile()) throw new Error("RESTORE_FILE bukan file biasa.");

  const { url, database, username } = parseDatabaseUrl(process.env.DATABASE_URL);
  const expectedConfirmation = `RESTORE:${database}`;
  if (process.env.RESTORE_CONFIRM !== expectedConfirmation) {
    throw new Error(
      `Restore memerlukan konfirmasi eksplisit: RESTORE_CONFIRM=${expectedConfirmation}`
    );
  }
  if (clean && process.env.RESTORE_ALLOW_DATA_LOSS !== "1") {
    throw new Error(
      "Restore --clean dapat menghapus data. Set RESTORE_ALLOW_DATA_LOSS=1 atau pakai --no-clean."
    );
  }

  const password = process.env.BACKUP_PASSWORD ?? decodeURIComponent(url.password);
  const args = [
    "--format=custom",
    "--exit-on-error",
    "--no-owner",
    "--no-privileges",
    "--host",
    url.hostname,
    "--port",
    url.port || "5432",
    "--username",
    username,
    "--dbname",
    database,
    ...(clean ? ["--clean", "--if-exists"] : []),
    file
  ];

  console.log(`[RESTORE] ${file} -> database ${database} (clean=${clean ? "yes" : "no"})`);
  if (dryRun) {
    console.log(
      `[RESTORE] dry-run: ${process.env.PG_RESTORE_BIN ?? "pg_restore"} ${args.join(" ")}`
    );
    return;
  }

  await run(
    process.env.PG_RESTORE_BIN ?? "pg_restore",
    args,
    password ? { PGPASSWORD: password } : {}
  );
  console.log("[RESTORE] Selesai. Verifikasi dengan query RBAC/PHI sebelum membuka layanan.");
}

main().catch((error) => {
  console.error("[RESTORE] Gagal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
