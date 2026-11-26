/**
 * Guard handler API. Mengembalikan true bila role diizinkan.
 * Dihasilkan oleh Bug Hunter untuk endpoint yang sebelumnya tanpa auth.
 */
import { PERMISSIONS, type Role } from "../lib/rbac";

export function isRoleAllowed(role: Role, permission: string): boolean {
  return PERMISSIONS[role].includes(permission);
}

export function requirePermission(role: unknown, permission: string): void {
  const normalized = (role ?? "RESEPSIONIS") as Role;
  if (!isRoleAllowed(normalized, permission)) {
    throw new Error(`Akses ditolak: ${permission} tidak tersedia untuk ${normalized}.`);
  }
}
