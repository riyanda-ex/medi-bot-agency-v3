/**
 * Pengaman path file laporan. Path dari DB tidak boleh keluar dari folder reports/.
 * Mencegah baris DB yang rusak/disusup mengembalikan file sensitif seperti .env.
 */

import path from "node:path";

const REPORTS_ROOT = path.resolve(process.cwd(), "reports");

export function resolveReportPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const relative = path.relative(REPORTS_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path laporan di luar direktori yang diizinkan.");
  }
  return resolved;
}

export function publicReportName(filePath: string): string {
  return path.basename(resolveReportPath(filePath));
}
