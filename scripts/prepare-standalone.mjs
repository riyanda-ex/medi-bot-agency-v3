import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Next 16 dengan output: "standalone" tidak bisa dijalankan lewat `next start`.
 * Siapkan folder standalone dengan aset statis dan Prisma client yang dihasilkan,
 * lalu `npm start` menjalankan server.js minimal dari folder tersebut.
 * Lihat node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standalone = join(root, ".next", "standalone");
const server = join(standalone, "server.js");

if (!existsSync(server)) {
  throw new Error("Standalone build belum ada. Jalankan `npm run build` sebelum `npm start`.");
}

function copyInto(source, destination) {
  const from = join(root, source);
  if (!existsSync(from)) return;
  const to = join(standalone, destination);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, force: true });
}

// Next tidak menyalin public/, .next/static/, atau generated/ secara otomatis.
mkdirSync(join(root, "public"), { recursive: true });
copyInto("public", "public");
copyInto(".next/static", join(".next", "static"));
copyInto("generated", "generated");

console.log(`[start] standalone siap di ${standalone}`);
