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
    "patient:read_nik",
    "patient:read_diagnosis",
    "patient:read_contact",
    "patient:write",
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
  // Perawat menangani kontak/triase, bukan NIK atau diagnosis.
  PERAWAT: [
    "patient:read",
    "patient:read_contact",
    "triage:read",
    "triage:write",
    "appointment:read"
  ],
  RESEPSIONIS: ["appointment:read", "appointment:write", "queue:read"],
  PASIEN: ["own:read", "own:appointment"],
  TIDAK_AKTIF: []
};

/** Izin yang membuka data PHI sensitif dalam daftar pasien. */
export const PATIENT_PHI_PERMISSIONS = [
  "patient:read_nik",
  "patient:read_diagnosis",
  "patient:read_contact"
] as const;

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

export function canReadPatientNik(role: Role): boolean {
  return hasPermission(role, "patient:read_nik");
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

export class PatientAccessError extends Error {
  constructor(message = "Akses ke data pasien ditolak.") {
    super(message);
    this.name = "PatientAccessError";
  }
}

/**
 * Pemeriksaan object-level: izin peran saja tidak cukup.
 *
 * `assignedPatientId` dan `assignedDoctorId` adalah relasi pasien yang diminta
 * (mis. user.patientId / visit.doctorId), sedangkan `sessionDoctorId` adalah
 * profil dokter milik sesi. Pasien hanya boleh mengakses ID miliknya sendiri.
 */
export function canAccessPatient(
  role: Role,
  sessionUserId: string | undefined,
  patientId: string,
  assignedPatientId?: string | null,
  assignedDoctorId?: string | null,
  sessionDoctorId?: string | null
): boolean {
  const normalized = normalizeRole(role);
  if (!sessionUserId || !patientId) return false;

  if (normalized === "ADMIN") return true;
  if (normalized === "PASIEN") {
    return Boolean(assignedPatientId) && assignedPatientId === patientId;
  }
  if (normalized === "DOKTER") {
    return Boolean(
      (sessionDoctorId && assignedDoctorId && sessionDoctorId === assignedDoctorId) ||
      (assignedPatientId && assignedPatientId === patientId)
    );
  }
  if (normalized === "PERAWAT") return true;
  return false;
}

/** Lempar PatientAccessError bila sesi tidak boleh mengakses pasien tersebut. */
export function assertPatientAccess(
  role: Role,
  sessionUserId: string | undefined,
  patientId: string,
  assignedPatientId?: string | null,
  assignedDoctorId?: string | null,
  sessionDoctorId?: string | null
): void {
  if (
    !canAccessPatient(
      role,
      sessionUserId,
      patientId,
      assignedPatientId,
      assignedDoctorId,
      sessionDoctorId
    )
  ) {
    throw new PatientAccessError();
  }
}
