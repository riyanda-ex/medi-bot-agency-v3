/**
 * Pengaman path file laporan. Path dari DB tidak boleh keluar dari folder reports/.
 * Mencegah baris DB yang rusak/disusup mengembalikan file sensitif seperti .env.
 */

import path from "node:path";

const REPORTS_ROOT = path.resolve(process.cwd(), "reports");
const ALLOWED_EXTENSIONS = new Set([".pdf", ".xlsx"]);

export function resolveReportPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const relative = path.relative(REPORTS_ROOT, resolved);
  // `startsWith("..")` salah menolak nama sah seperti `..laporan.pdf`.
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Path laporan di luar direktori yang diizinkan.");
  }
  if (!ALLOWED_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw new Error("Ekstensi file laporan tidak diizinkan.");
  }
  return resolved;
}

export function publicReportName(filePath: string): string {
  return path.basename(resolveReportPath(filePath));
}
