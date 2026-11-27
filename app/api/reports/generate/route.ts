import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getRequestId, jsonWithRequestId } from "@/lib/requestContext";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { runReporter } from "@/agents/reporter";
import { enforceRateLimit, enforceSameOrigin, getClientIp } from "@/lib/requestGuard";

const bodySchema = z.object({
  approvalId: z.string().min(1).optional()
});

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  void startedAt;
  const originBlocked = enforceSameOrigin(request);
  if (originBlocked) return originBlocked;

  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? "TIDAK_AKTIF";

  if ((!hasPermission(role, "report:read") && !hasPermission(role, "agent:run")) || session?.user.invalid) {
    await auditApiAccess({ request, session, action: "REPORT_GENERATE_DENIED", detail: `Peran ${role} mencoba membuat laporan.` });
    return jsonWithRequestId(requestId, { error: "Akses ditolak." }, { status: 403 });
  }

  const limited = await enforceRateLimit(`report-generate:${session?.user.id ?? getClientIp(request)}`, 10, 60_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonWithRequestId(requestId, { error: "Data tidak valid." }, { status: 400 });
  }

  const result = await runReporter(new Date(), parsed.data.approvalId);
  await auditApiAccess({
    request,
    session,
    action: "REPORT_GENERATE",
    detail: `Laporan ${result.reportId} dibuat (PDF + Excel).`
  });

  return jsonWithRequestId(requestId, {
    reportId: result.reportId,
    date: result.data.date,
    summary: {
      newPatients: result.data.newPatients,
      controls: result.data.controls,
      cancelled: result.data.cancelled,
      urgent: result.data.urgent,
      pendingClaims: result.data.pendingClaims,
      visits7Days: result.data.visits7Days
    },
    files: result.files,
    email: result.email
  });
}