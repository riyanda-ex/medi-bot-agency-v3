import { NextResponse } from "next/server";
import { z } from "zod";
import {
  assertPatientAccess,
  canApproveOutbound,
  hasPermission,
  PatientAccessError,
  type Role
} from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { createApproval, type ApprovalScope } from "@/lib/approval";
import {
  createApiContext,
  deny,
  guardBodySize,
  guardOrigin,
  guardRateLimit,
  ok,
  reportIdSchema,
  triageLogIdSchema
} from "@/lib/apiRoute";
import { auditApiAccess } from "@/lib/audit";

const bodySchema = z.object({
  scope: z.enum(["URGENT", "REPORT"]),
  resourceId: z.union([triageLogIdSchema, reportIdSchema]),
  channels: z
    .array(z.enum(["WHATSAPP", "CALL", "EMAIL", "ESCALATION"]))
    .min(1)
    .max(4)
});

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/urgent/approve");
  const originBlocked = guardOrigin(ctx);
  if (originBlocked) return originBlocked;
  if (!canApproveOutbound(ctx.role) || ctx.sessionInvalid) {
    return deny(
      ctx,
      403,
      "Akses ditolak: approval hanya untuk DOKTER/ADMIN.",
      "OUTBOUND_APPROVAL_DENIED",
      `Peran ${ctx.role} mencoba memberikan approval outbound.`
    );
  }
  const limited = await guardRateLimit(ctx, `approve:${ctx.userId ?? ctx.ip}`, 30, 60_000);
  if (limited) return limited;
  const tooLarge = await guardBodySize(ctx);
  if (tooLarge) return tooLarge;
  const parsed = bodySchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return deny(ctx, 400, "Data tidak valid.", "OUTBOUND_APPROVAL_INVALID");
  const { scope, resourceId, channels } = parsed.data as {
    scope: ApprovalScope;
    resourceId: string;
    channels: string[];
  };
  if (scope === "URGENT") {
    const log = await prisma.triageLog.findUnique({
      where: { id: resourceId },
      select: { id: true, patientId: true }
    });
    if (!log) return deny(ctx, 404, "Triage log tidak ditemukan.", "OUTBOUND_APPROVAL_NOT_FOUND");
    const sessionDoctorId = ctx.session?.user.doctorId;
    try {
      assertPatientAccess(
        ctx.role as Role,
        ctx.userId,
        log.patientId,
        ctx.session?.user.patientId,
        sessionDoctorId ?? (ctx.role === "DOKTER" ? ctx.userId : null),
        sessionDoctorId ?? (ctx.role === "DOKTER" ? ctx.userId : null)
      );
    } catch (error) {
      if (!(error instanceof PatientAccessError)) throw error;
      return deny(
        ctx,
        403,
        "Akses ditolak: resource di luar scope Anda.",
        "OUTBOUND_APPROVAL_OBJECT_DENIED"
      );
    }
  } else if (!hasPermission(ctx.role, "report:read")) {
    return deny(
      ctx,
      403,
      "Akses ditolak: approval laporan butuh izin report:read.",
      "OUTBOUND_APPROVAL_DENIED"
    );
  }

  const approval = await createApproval({
    scope,
    resourceId,
    approverId: ctx.userId!,
    role: ctx.role,
    channels
  });
  await auditApiAccess({
    request: ctx.request,
    session: ctx.session,
    action: "OUTBOUND_APPROVAL_GRANTED",
    detail: `${approval.approvalId} untuk ${scope}/${resourceId} berlaku sampai ${approval.expiresAt}.`,
    requestId: ctx.requestId
  });
  return ok(ctx, {
    approvalId: approval.approvalId,
    scope: approval.scope,
    resourceId: approval.resourceId,
    expiresAt: approval.expiresAt,
    requestId: ctx.requestId
  });
}
