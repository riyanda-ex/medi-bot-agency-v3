import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "prisma", "schema.prisma");
const target = join(root, "prisma", "schema.postgres.prisma");

const original = await readFile(source, "utf8");
if (!original.includes('provider = "sqlite"')) {
  throw new Error("Tidak menemukan provider sqlite di prisma/schema.prisma.");
}

const postgresSchema = original.replace('provider = "sqlite"', 'provider = "postgresql"');
await writeFile(target, postgresSchema, "utf8");
console.log("[SYNC] prisma/schema.postgres.prisma dibuat dari schema.prisma.");
console.log("[SYNC] Pastikan DATABASE_URL mengarah ke PostgreSQL sebelum generate.");
