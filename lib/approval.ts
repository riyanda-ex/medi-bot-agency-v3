/**
 * Approval manusia untuk pengiriman nyata.
 * Rekam approval disimpan sebagai baris audit_logs bertanda tangan HMAC,
 * sehingga peran historis dan identitas penyetuju tidak bisa dipalsukan
 * hanya dengan mengirim string `approvedBy` lewat payload antrean.
 */

import { prisma } from "@/lib/prisma";
import { hasPermission, normalizeRole } from "@/lib/rbac";
import { signPayload, verifyPayloadSignature } from "@/lib/crypto";
import { requireHumanApproval } from "@/lib/env";

export const APPROVAL_ACTION = "OUTBOUND_APPROVAL";
export const APPROVAL_TTL_MS = 30 * 60_000;

export type ApprovalScope = "URGENT" | "REPORT";

export interface ApprovalRecord {
  approvalId: string;
  scope: ApprovalScope;
  resourceId: string;
  approverId: string;
  role: string;
  channels: string[];
  expiresAt: string;
}

export interface ApprovalVerification {
  ok: boolean;
  reason: string;
  approverId?: string;
}

export function approvalCanonicalPayload(record: ApprovalRecord): string {
  return [
    record.approvalId,
    record.scope,
    record.resourceId,
    record.approverId,
    record.role,
    record.channels.join(","),
    record.expiresAt
  ].join("|");
}

export async function createApproval(input: {
  scope: ApprovalScope;
  resourceId: string;
  approverId: string;
  role: string;
  channels: string[];
}): Promise<ApprovalRecord> {
  const record: ApprovalRecord = {
    approvalId: `apr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    scope: input.scope,
    resourceId: input.resourceId,
    approverId: input.approverId,
    role: normalizeRole(input.role),
    channels: input.channels,
    expiresAt: new Date(Date.now() + APPROVAL_TTL_MS).toISOString()
  };

  const canonical = approvalCanonicalPayload(record);
  // HMAC disimpan terpisah dari payload. DB saja tidak cukup untuk memalsukan
  // approval karena penyerang tidak memiliki kunci HMAC server.
  await prisma.auditLog.create({
    data: {
      actorId: input.approverId,
      role: record.role,
      action: APPROVAL_ACTION,
      ipAddress: "-",
      detail: canonical,
      signature: signPayload(canonical)
    }
  });

  return record;
}

export async function verifyApproval(
  approvalId: string | undefined,
  scope: ApprovalScope,
  resourceId: string
): Promise<ApprovalVerification> {
  if (!requireHumanApproval()) {
    return { ok: true, reason: "Approval tidak diwajibkan di lingkungan pengembangan." };
  }
  if (!approvalId) {
    return { ok: false, reason: "Approval manusia belum diberikan." };
  }

  const row = await prisma.auditLog.findFirst({
    where: { action: APPROVAL_ACTION, detail: { startsWith: `${approvalId}|` } },
    orderBy: { createdAt: "desc" }
  });
  if (!row) {
    return { ok: false, reason: "Approval tidak ditemukan." };
  }

  // Kompatibel dengan baris lama yang menyisipkan tanda tangan di `detail`.
  const separator = row.detail.lastIndexOf("::");
  const canonical = separator >= 0 ? row.detail.slice(0, separator) : row.detail;
  const signature = row.signature ?? (separator >= 0 ? row.detail.slice(separator + 2) : "");
  if (!signature || !verifyPayloadSignature(canonical, signature)) {
    return { ok: false, reason: "Tanda tangan approval tidak cocok." };
  }

  const parts = canonical.split("|");
  const record: ApprovalRecord = {
    approvalId: parts[0] ?? "",
    scope: parts[1] as ApprovalScope,
    resourceId: parts[2] ?? "",
    approverId: parts[3] ?? "",
    role: parts[4] ?? "",
    channels: (parts[5] ?? "").split(",").filter(Boolean),
    expiresAt: parts[6] ?? ""
  };

  if (record.scope !== scope || record.resourceId !== resourceId) {
    return { ok: false, reason: "Approval tidak sesuai dengan tindakan ini." };
  }
  if (Date.parse(record.expiresAt) < Date.now()) {
    return { ok: false, reason: "Approval kedaluwarsa." };
  }

  const approver = await prisma.user.findUnique({
    where: { id: record.approverId },
    select: { role: true, status: true }
  });
  if (
    !approver ||
    approver.status !== "AKTIF" ||
    !hasPermission(normalizeRole(approver.role), "outbound:approve")
  ) {
    return { ok: false, reason: "Penyetuju tidak berwenang atau sudah dinonaktifkan." };
  }

  return { ok: true, reason: "Approval valid.", approverId: record.approverId };
}
