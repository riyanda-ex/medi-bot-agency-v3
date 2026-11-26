/**
 * AGENT 6 - SECURITY GUARD
 * Enkripsi, RBAC, masking NIK, audit log (siapa/kapan/target/IP), retensi 1 tahun.
 */

import { prisma } from "@/lib/prisma";
import { decryptField, maskNik, maskPhone } from "@/lib/crypto";
import { type Role, hasPermission, canViewDiagnosis } from "@/lib/rbac";
import { writeAgentLog } from "@/lib/agentLog";

export const AUDIT_RETENTION_DAYS = 365;

export interface AccessContext {
  actorId: string;
  role: Role;
  action: string;
  ip: string;
  targetPatientId?: string;
  detail?: string;
}

export async function auditAccess(context: AccessContext): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: context.actorId,
      action: context.action,
      ipAddress: context.ip,
      targetPatientId: context.targetPatientId,
      detail: context.detail ?? ""
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
    phone: privileged ? decryptField(patient.phoneEncrypted) : maskPhone(decryptField(patient.phoneEncrypted)),
    address: patient.address,
    distanceKm: patient.distanceKm
  };
}

export function redactRecordForRole<T extends { diagnosisIcd10: string | null; anamnesis: string | null }>(
  record: T,
  role: Role
): T | Omit<T, "diagnosisIcd10" | "anamnesis"> {
  if (canViewDiagnosis(role)) return record;
  const { diagnosisIcd10: _diagnosis, anamnesis: _anamnesis, ...safe } = record;
  return safe;
}

export function maskNikForRole(patient: { nikEncrypted: string; nikMasked: string }, role: Role): string {
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

/** Pemeriksaan konfigurasi keamanan. Tidak mengubah data kecuali pembersihan audit kedaluwarsa. */
export async function runSecurityGuard(): Promise<SecurityStatus> {
  const key = process.env.FIELD_ENCRYPTION_KEY ?? "";
  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86_400_000);
  const expired = await prisma.auditLog.count({ where: { createdAt: { lt: cutoff } } });

  if (expired > 0) {
    await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  }

  const status: SecurityStatus = {
    encryptionKeyConfigured: key.length > 0 && !key.includes("GANTI_"),
    syncMode: process.env.SYNC_MODE === "true",
    outboundAllowed: process.env.ALLOW_REAL_OUTBOUND === "true",
    auditRetentionDays: AUDIT_RETENTION_DAYS,
    auditOlderThanRetention: expired,
    checkedAt: new Date().toISOString()
  };

  await writeAgentLog({
    agentName: "SECURITY_GUARD",
    status: "SUCCESS",
    message: `Pemeriksaan keamanan: ${JSON.stringify(status)}`
  });

  return status;
}
