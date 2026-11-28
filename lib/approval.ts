/**
 * Approval manusia untuk pengiriman nyata.
 * Rekam approval disimpan sebagai baris audit_logs bertanda tangan HMAC,
 * sehingga peran historis dan identitas penyetuju tidak bisa dipalsukan
 * hanya dengan mengirim string `approvedBy` lewat payload antrean.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hasPermission, normalizeRole } from "@/lib/rbac";
import { signPayload, verifyPayloadSignature } from "@/lib/crypto";
import { requireHumanApproval } from "@/lib/env";

export const APPROVAL_ACTION = "OUTBOUND_APPROVAL";
export const APPROVAL_DENIAL_ACTION = "OUTBOUND_APPROVAL_DENIED_BY_APPROVER";
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
  /** Kanal yang benar-benar termuat dalam rekam approval bertanda tangan. */
  channels: string[];
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

/** Detail audit penolakan yang bisa dicocokkan oleh verifyApproval. */
export function approvalDenialDetail(
  scope: ApprovalScope,
  resourceId: string,
  reason: string
): string {
  return `${scope}|${resourceId}|${reason.replace(/\|/g, "/")}`;
}

export async function createApproval(input: {
  scope: ApprovalScope;
  resourceId: string;
  approverId: string;
  role: string;
  channels: string[];
}): Promise<ApprovalRecord> {
  const record: ApprovalRecord = {
    approvalId: `apr-${randomUUID()}`,
    scope: input.scope,
    resourceId: input.resourceId,
    approverId: input.approverId,
    role: normalizeRole(input.role),
    channels: [...input.channels],
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

/** Satu approval hanya mengizinkan kanal yang memang dipilih penyetuju. */
export function approvalAllowsChannel(
  verification: ApprovalVerification,
  channel: string
): boolean {
  return verification.ok && (!requireHumanApproval() || verification.channels.includes(channel));
}

export interface ApprovalConsumptionOptions {
  /** Tandai approval sebagai terpakai (sekali pakai per consumptionKey). */
  consume?: boolean;
  /** Kunci unik untuk satu aksi, mis. `urgent:<triageLogId>:<offset>`. */
  consumptionKey?: string;
  actorId?: string;
  action?: string;
}

export async function verifyApproval(
  approvalId: string | undefined,
  scope: ApprovalScope,
  resourceId: string,
  options: ApprovalConsumptionOptions = {}
): Promise<ApprovalVerification> {
  if (!requireHumanApproval()) {
    return {
      ok: true,
      reason: "Approval tidak diwajibkan di lingkungan pengembangan.",
      channels: []
    };
  }
  if (!approvalId) {
    return { ok: false, reason: "Approval manusia belum diberikan.", channels: [] };
  }

  const row = await prisma.auditLog.findFirst({
    where: { action: APPROVAL_ACTION, detail: { startsWith: `${approvalId}|` } },
    orderBy: { createdAt: "desc" }
  });
  if (!row) {
    return { ok: false, reason: "Approval tidak ditemukan.", channels: [] };
  }

  // Penolakan setelah approval diberikan mencabut sisa TTL approval tersebut.
  const denial = await prisma.auditLog.findFirst({
    where: {
      action: APPROVAL_DENIAL_ACTION,
      createdAt: { gte: row.createdAt },
      detail: { startsWith: `${scope}|${resourceId}|` }
    },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (denial) {
    return {
      ok: false,
      reason: "Approval telah dicabut oleh penolakan berikutnya.",
      channels: []
    };
  }

  // Kompatibel dengan baris lama yang menyisipkan tanda tangan di `detail`.
  const separator = row.detail.lastIndexOf("::");
  const canonical = separator >= 0 ? row.detail.slice(0, separator) : row.detail;
  const signature = row.signature ?? (separator >= 0 ? row.detail.slice(separator + 2) : "");
  if (!signature || !verifyPayloadSignature(canonical, signature)) {
    return { ok: false, reason: "Tanda tangan approval tidak cocok.", channels: [] };
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
    return { ok: false, reason: "Approval tidak sesuai dengan tindakan ini.", channels: [] };
  }
  if (Date.parse(record.expiresAt) < Date.now()) {
    return { ok: false, reason: "Approval kedaluwarsa.", channels: [] };
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
    return {
      ok: false,
      reason: "Penyetuju tidak berwenang atau sudah dinonaktifkan.",
      channels: []
    };
  }

  if (options.consume) {
    const consumptionKey = options.consumptionKey ?? `${scope}:${resourceId}`;
    try {
      await prisma.approvalUse.create({
        data: {
          approvalId: record.approvalId,
          consumptionKey,
          actorId: options.actorId ?? record.approverId,
          action: options.action ?? scope
        }
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        return { ok: false, reason: "Approval sudah dipakai untuk aksi ini.", channels: [] };
      }
      throw error;
    }
  }

  return {
    ok: true,
    reason: "Approval valid.",
    approverId: record.approverId,
    channels: record.channels
  };
}
