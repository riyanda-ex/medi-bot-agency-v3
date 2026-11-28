export const ROLES = [
  "ADMIN",
  "DOKTER",
  "PERAWAT",
  "RESEPSIONIS",
  "PASIEN",
  "TIDAK_AKTIF"
] as const;
export type Role = (typeof ROLES)[number];

/** Peran fail-closed untuk sesi tidak sah atau peran yang tidak dikenal. */
export const TIDAK_AKTIF: Role = "TIDAK_AKTIF";

export const PERMISSIONS: Record<Role, readonly string[]> = {
  ADMIN: [
    "patient:read",
    "patient:write",
    "patient:read_nik",
    "patient:read_diagnosis",
    "patient:read_contact",
    "diagnosis:read",
    "triage:read",
    "triage:write",
    "report:read",
    "audit:read",
    "appointment:read",
    "appointment:write",
    "agent:run",
    "outbound:approve"
  ],
  DOKTER: [
    "patient:read",
    "patient:read_nik",
    "patient:read_diagnosis",
    "patient:read_contact",
    "diagnosis:read",
    "triage:read",
    "triage:write",
    "prescription:write",
    "report:read",
    "appointment:read",
    "outbound:approve"
  ],
  PERAWAT: ["patient:read", "triage:read", "triage:write", "appointment:read"],
  RESEPSIONIS: ["appointment:read", "appointment:write", "queue:read"],
  PASIEN: ["own:read", "own:appointment"],
  TIDAK_AKTIF: []
};

/**
 * Fail-closed: peran yang tidak dikenal tidak mendapat izin apa pun.
 * Tidak jatuh ke RESEPSIONIS karena peran itu memiliki izin appointment/queue.
 */
export function normalizeRole(value: unknown): Role {
  return ROLES.includes(value as Role) ? (value as Role) : "TIDAK_AKTIF";
}

export function hasPermission(role: Role, permission: string): boolean {
  return PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canViewDiagnosis(role: Role): boolean {
  return hasPermission(role, "diagnosis:read");
}

export function canViewTriage(role: Role): boolean {
  return hasPermission(role, "triage:read");
}

export function canAccessAudit(role: Role): boolean {
  return hasPermission(role, "audit:read");
}

export function canApproveOutbound(role: Role): boolean {
  return hasPermission(role, "outbound:approve");
}
