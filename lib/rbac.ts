export const ROLES = ["ADMIN", "DOKTER", "PERAWAT", "RESEPSIONIS", "PASIEN"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS: Record<Role, readonly string[]> = {
  ADMIN: [
    "patient:read",
    "patient:write",
    "diagnosis:read",
    "triage:read",
    "triage:write",
    "report:read",
    "audit:read",
    "appointment:read",
    "appointment:write",
    "agent:run"
  ],
  DOKTER: [
    "patient:read",
    "diagnosis:read",
    "triage:read",
    "triage:write",
    "prescription:write",
    "report:read",
    "appointment:read"
  ],
  PERAWAT: ["patient:read", "triage:read", "triage:write", "appointment:read"],
  RESEPSIONIS: ["appointment:read", "appointment:write", "queue:read"],
  PASIEN: ["own:read", "own:appointment"]
};

export function normalizeRole(value: unknown): Role {
  return ROLES.includes(value as Role) ? (value as Role) : "RESEPSIONIS";
}

export function hasPermission(role: Role, permission: string): boolean {
  return PERMISSIONS[role].includes(permission);
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
