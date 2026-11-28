/**
 * Guard handler API. Mengembalikan true bila role diizinkan.
 * Peran tidak dikenal dinormalisasi menjadi TIDAK_AKTIF (tanpa izin).
 */
import { hasPermission, normalizeRole, type Role } from "../lib/rbac";

export function isRoleAllowed(role: Role, permission: string): boolean {
  return hasPermission(role, permission);
}

export function requirePermission(role: unknown, permission: string): void {
  const normalized = normalizeRole(role);
  if (!isRoleAllowed(normalized, permission)) {
    throw new Error(`Akses ditolak: ${permission} tidak tersedia untuk ${normalized}.`);
  }
}
