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
  const canReadNik = hasPermission(role, "patient:read_nik");
  const canReadContact = hasPermission(role, "patient:read_contact");
  return {
    id: patient.id,
    name: patient.name,
    nik: canReadNik ? decryptField(patient.nikEncrypted) : patient.nikMasked,
    phone: canReadContact
      ? decryptField(patient.phoneEncrypted)
      : maskPhone(decryptField(patient.phoneEncrypted)),
    address: patient.address,
    distanceKm: patient.distanceKm
  };
}

/** Field rekam medis yang berisi PHI dan tidak boleh dikirim ke peran rendah. */
export const SENSITIVE_RECORD_FIELDS = [
  "diagnosisIcd10",
  "anamnesis",
  "actionIcd9",
  "radiology",
  "vitalSigns",
  "note"
] as const;
type SensitiveRecordField = (typeof SENSITIVE_RECORD_FIELDS)[number];

export function redactRecordForRole<T extends Partial<Record<SensitiveRecordField, unknown>>>(
  record: T,
  role: Role
): T | Omit<T, SensitiveRecordField> {
  if (canViewDiagnosis(role)) return record;
  const safe = { ...record } as Record<string, unknown>;
  for (const field of SENSITIVE_RECORD_FIELDS) delete safe[field];
  return safe as Omit<T, SensitiveRecordField>;
}

export function maskNikForRole(
  patient: { nikEncrypted: string; nikMasked: string },
  role: Role
): string {
  return hasPermission(role, "patient:read_nik")
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
