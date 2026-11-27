import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getRequestId, jsonWithRequestId } from "@/lib/requestContext";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { canApproveOutbound } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { createApproval, type ApprovalScope } from "@/lib/approval";
import { enforceRateLimit, enforceSameOrigin, getClientIp } from "@/lib/requestGuard";

const bodySchema = z.object({
  scope: z.enum(["URGENT", "REPORT"]),
  resourceId: z.string().min(1),
  channels: z
    .array(z.enum(["WHATSAPP", "CALL", "EMAIL", "ESCALATION"]))
    .min(1)
    .max(4)
});

/** Approval nyata: hanya DOKTER/ADMIN, tercatat di audit, berlaku 30 menit. */
export async function POST(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  void startedAt;
  const originBlocked = enforceSameOrigin(request);
  if (originBlocked) return originBlocked;

  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? "TIDAK_AKTIF";

  if (!canApproveOutbound(role) || session?.user.invalid) {
    await auditApiAccess({
      request,
      session,
      action: "OUTBOUND_APPROVAL_DENIED",
      detail: `Peran ${role} mencoba memberikan approval outbound.`
    });
    return jsonWithRequestId(
      requestId,
      { error: "Akses ditolak: approval hanya untuk DOKTER/ADMIN." },
      { status: 403 }
    );
  }

  const limited = await enforceRateLimit(
    `approve:${session?.user.id ?? getClientIp(request)}`,
    30,
    60_000
  );
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonWithRequestId(requestId, { error: "Data tidak valid." }, { status: 400 });
  }

  const { scope, resourceId, channels } = parsed.data as {
    scope: ApprovalScope;
    resourceId: string;
    channels: string[];
  };

  if (scope === "URGENT") {
    const log = await prisma.triageLog.findUnique({
      where: { id: resourceId },
      select: { id: true }
    });
    if (!log)
      return jsonWithRequestId(
        requestId,
        { error: "Triage log tidak ditemukan." },
        { status: 404 }
      );
  }

  const approval = await createApproval({
    scope,
    resourceId,
    approverId: session!.user.id,
    role,
    channels
  });

  await auditApiAccess({
    request,
    session,
    action: "OUTBOUND_APPROVAL_GRANTED",
    detail: `${approval.approvalId} untuk ${scope}/${resourceId} berlaku sampai ${approval.expiresAt}.`
  });

  return jsonWithRequestId(requestId, {
    approvalId: approval.approvalId,
    scope: approval.scope,
    resourceId: approval.resourceId,
    expiresAt: approval.expiresAt
  });
}
