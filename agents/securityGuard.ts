/**
 * AGENT 6 - SECURITY GUARD
 * Enkripsi, RBAC, masking NIK, audit log (siapa/kapan/target/IP), retensi 1 tahun.
 */

import { prisma } from "@/lib/prisma";
import { decryptField, maskNik, maskPhone, signPayload } from "@/lib/crypto";
import { type Role, hasPermission, canViewDiagnosis } from "@/lib/rbac";
import { isPlaceholderSecret } from "@/lib/env";
import { writeAgentLog } from "@/lib/agentLog";

export const AUDIT_RETENTION_DAYS = 365;

export interface AccessContext {
  actorId: string;
  role: Role | "ANONYMOUS";
  action: string;
  ip: string;
  targetPatientId?: string;
  detail?: string;
  method?: string;
  path?: string;
  userAgent?: string;
}

/** Tulis audit dengan tanda tangan HMAC agar perubahan diam-diam terdeteksi. */
export async function auditAccess(context: AccessContext): Promise<void> {
  const detail = context.detail ?? "";
  const canonical = [
    context.actorId,
    context.role,
    context.action,
    context.ip,
    context.targetPatientId ?? "-",
    detail
  ].join("|");

  await prisma.auditLog.create({
    data: {
      actorId: context.actorId,
      role: context.role,
      action: context.action,
      ipAddress: context.ip,
      targetPatientId: context.targetPatientId,
      method: context.method ?? "-",
      path: context.path ?? "-",
      userAgent: context.userAgent ?? "-",
      detail,
      signature: signPayload(canonical)
    }
  });
}

export function assertPermission(role: Role, permission: string): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Akses ditolak: peran ${role} tidak memiliki izin ${permission}.`);
  }
}

export interface PatientView {
  id: string;
  name: string;
  nik: string;
  phone: string;
  address: string;
  distanceKm: number;
}

/** Seluruh tampilan patient melewati fungsi ini. Role rendah hanya melihat NIK/HP termasker. */
export function redactPatientForRole(
  patient: {
    id: string;
    name: string;
    nikEncrypted: string;
    nikMasked: string;
    phoneEncrypted: string;
    address: string;
    distanceKm: number;
  },
  role: Role
): PatientView {
  const privileged = hasPermission(role, "patient:read") || canViewDiagnosis(role);
  return {
    id: patient.id,
    name: patient.name,
    nik: privileged ? decryptField(patient.nikEncrypted) : patient.nikMasked,
    phone: privileged
      ? decryptField(patient.phoneEncrypted)
      : maskPhone(decryptField(patient.phoneEncrypted)),
    address: patient.address,
    distanceKm: patient.distanceKm
  };
}

export function redactRecordForRole<
  T extends { diagnosisIcd10: string | null; anamnesis: string | null }
>(record: T, role: Role): T | Omit<T, "diagnosisIcd10" | "anamnesis"> {
  if (canViewDiagnosis(role)) return record;
  const { diagnosisIcd10: _diagnosis, anamnesis: _anamnesis, ...safe } = record;
  return safe;
}

export function maskNikForRole(
  patient: { nikEncrypted: string; nikMasked: string },
  role: Role
): string {
  return hasPermission(role, "patient:read") || canViewDiagnosis(role)
    ? decryptField(patient.nikEncrypted)
    : maskNik(decryptField(patient.nikEncrypted));
}

export interface SecurityStatus {
  encryptionKeyConfigured: boolean;
  syncMode: boolean;
  outboundAllowed: boolean;
  auditRetentionDays: number;
  auditOlderThanRetention: number;
  checkedAt: string;
}

/** Pemeriksaan konfigurasi keamanan. Bersifat read-only: audit bukan untuk dihapus rutin. */
export async function runSecurityGuard(): Promise<SecurityStatus> {
  const key = process.env.FIELD_ENCRYPTION_KEY ?? "";
  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86_400_000);
  const expired = await prisma.auditLog.count({ where: { createdAt: { lt: cutoff } } });

  // Audit log adalah bukti forensik: tidak dihapus oleh job rutin. Baris yang
  // melewati retensi wajib diarsipkan ke WORM/SIEM oleh operator terlebih dahulu
  // (lihat docs/EXTERNAL-INFRA.md), baru bisa dihapus lewat prosedur resmi.

  const status: SecurityStatus = {
    encryptionKeyConfigured: !isPlaceholderSecret(key) && key.length >= 32,
    syncMode: process.env.SYNC_MODE === "true",
    outboundAllowed: process.env.ALLOW_REAL_OUTBOUND === "true",
    auditRetentionDays: AUDIT_RETENTION_DAYS,
    auditOlderThanRetention: expired,
    checkedAt: new Date().toISOString()
  };

  await writeAgentLog({
    agentName: "SECURITY_GUARD",
    status: "SUCCESS",
    message: `Pemeriksaan keamanan: ${JSON.stringify({
      ...status,
      encryptionKeyConfigured: status.encryptionKeyConfigured,
      auditRetentionDays: status.auditRetentionDays
    })}`
  });

  return status;
}
