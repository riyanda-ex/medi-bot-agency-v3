/**
 * Aturan retensi dan hak subjek data (UU No. 27/2022 + Permenkes 24/2022).
 *
 * Rekam medis tidak boleh dimusnahkan sebelum 25 tahun sejak kunjungan terakhir.
 * Penarikan consent menghentikan pemrosesan baru, bukan menghapus fakta klinis.
 */

export const CLINICAL_RETENTION_YEARS = 25;
export const DSR_SLA_HOURS = 72;
export const DSR_SLA_MS = DSR_SLA_HOURS * 60 * 60 * 1000;
/** Retensi hanya untuk data pendaftar yang belum pernah memiliki kunjungan. */
export const NO_VISIT_RETENTION_DAYS = 30;

export type DataSubjectRequestType =
  "ACCESS" | "COPY" | "RECTIFICATION" | "CONSENT_WITHDRAWAL" | "DELETION";

export type DataSubjectRequestStatus =
  "PENDING" | "IN_PROGRESS" | "APPROVED" | "COMPLETED" | "REJECTED";

/** Tambah tahun dengan penanganan 29 Februari yang aman. */
export function addYears(value: Date, years: number): Date {
  const result = new Date(value.getTime());
  const day = result.getUTCDate();
  result.setUTCFullYear(result.getUTCFullYear() + years);
  if (result.getUTCDate() !== day) result.setUTCDate(0);
  return result;
}

/**
 * Batas retensi rekam medis dihitung dari kunjungan terakhir, bukan dari
 * tanggal consent dicabut. Untuk pasien tanpa kunjungan tidak ada rekam medis
 * yang harus dipertahankan, sehingga pakai retensi administratif 30 hari.
 */
export function consentRetentionUntil(
  lastVisitAt: Date | null,
  now = new Date(),
  existingRetentionUntil?: Date | null
): Date {
  if (lastVisitAt && !Number.isNaN(lastVisitAt.getTime())) {
    return addYears(lastVisitAt, CLINICAL_RETENTION_YEARS);
  }
  // Retensi administratif pendaftar tanpa kunjungan dihitung sekali. Job sweep
  // harus mempertahankan nilai yang sudah ada agar tidak menunda erasure.
  if (existingRetentionUntil && !Number.isNaN(existingRetentionUntil.getTime())) {
    return existingRetentionUntil;
  }
  return new Date(now.getTime() + NO_VISIT_RETENTION_DAYS * 86_400_000);
}

export function dsrDueAt(now = new Date()): Date {
  return new Date(now.getTime() + DSR_SLA_MS);
}

export function latestVisitDate(visits: Array<{ visitDate: Date }>): Date | null {
  return visits.reduce<Date | null>((latest, visit) => {
    if (!latest || visit.visitDate > latest) return visit.visitDate;
    return latest;
  }, null);
}

/**
 * Penghapusan hanya boleh dilakukan bila tidak ada legal hold, consent dicabut,
 * dan masa retensi 25 tahun sudah berakhir.
 */
export function canAnonymizePatient(
  patient: {
    consentStatus: string;
    consentRevokedAt: Date | null;
    retentionUntil: Date | null;
    legalHold?: boolean;
    deletedAt?: Date | null;
  },
  now = new Date()
): boolean {
  if (patient.deletedAt) return false;
  if (patient.legalHold) return false;
  const revoked = patient.consentStatus === "REVOKED" || Boolean(patient.consentRevokedAt);
  const retentionExpired = Boolean(patient.retentionUntil && patient.retentionUntil <= now);
  return revoked && retentionExpired;
}

export function dsrIsOverdue(
  request: { dueAt: Date; completedAt: Date | null },
  now = new Date()
): boolean {
  return !request.completedAt && request.dueAt < now;
}
