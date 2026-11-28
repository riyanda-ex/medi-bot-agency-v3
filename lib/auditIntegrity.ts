/**
 * Verifikasi integritas audit log bertanda tangan.
 *
 * Audit log adalah bukti forensik: baris yang ditandatangani tidak boleh dihapus
 * oleh job retensi biasa. Fungsi di sini dipakai oleh script `npm run audit:verify`
 * dan dapat dipanggil dari monitoring/SIEM.
 */

import { verifyPayloadSignature } from "@/lib/crypto";

/** Disalin sengaja agar verifier tidak mengimpor modul yang membuka Prisma. */
const APPROVAL_ACTION = "OUTBOUND_APPROVAL";

export interface AuditRowForVerification {
  id: string;
  actorId: string;
  role: string | null;
  action: string;
  ipAddress: string;
  targetPatientId: string | null;
  detail: string;
  signature: string | null;
}

export interface AuditVerificationResult {
  checked: number;
  valid: number;
  unsigned: number;
  invalid: number;
  invalidIds: string[];
}

/** Rekonstruksi canonical payload persis seperti saat audit ditulis. */
export function auditCanonicalPayload(row: AuditRowForVerification): string {
  if (row.action === APPROVAL_ACTION) {
    // Approval ditandatangani menggunakan canonical payload approval yang
    // memang sudah tersimpan utuh di `detail`.
    const separator = row.detail.lastIndexOf("::");
    return separator >= 0 ? row.detail.slice(0, separator) : row.detail;
  }

  return [
    row.actorId,
    row.role ?? "ANONYMOUS",
    row.action,
    row.ipAddress,
    row.targetPatientId ?? "-",
    row.detail
  ].join("|");
}

export function verifyAuditRows(rows: AuditRowForVerification[]): AuditVerificationResult {
  const result: AuditVerificationResult = {
    checked: rows.length,
    valid: 0,
    unsigned: 0,
    invalid: 0,
    invalidIds: []
  };

  for (const row of rows) {
    if (!row.signature) {
      result.unsigned += 1;
      result.invalidIds.push(row.id);
      continue;
    }

    const canonical = auditCanonicalPayload(row);
    const signature =
      row.action === APPROVAL_ACTION &&
      row.detail.lastIndexOf("::") >= 0 &&
      !verifyPayloadSignature(canonical, row.signature)
        ? row.detail.slice(row.detail.lastIndexOf("::") + 2)
        : row.signature;

    if (verifyPayloadSignature(canonical, signature)) {
      result.valid += 1;
    } else {
      result.invalid += 1;
      result.invalidIds.push(row.id);
    }
  }

  return result;
}
