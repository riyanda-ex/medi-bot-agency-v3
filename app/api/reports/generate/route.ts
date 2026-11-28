import { NextResponse } from "next/server";
import { z } from "zod";
import { hasPermission } from "@/lib/rbac";
import { runReporter } from "@/agents/reporter";
import {
  approvalIdSchema,
  createApiContext,
  deny,
  guardBodySize,
  guardOrigin,
  guardRateLimit,
  ok
} from "@/lib/apiRoute";
import { auditApiAccess } from "@/lib/audit";

const bodySchema = z.object({ approvalId: approvalIdSchema.optional() });

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/reports/generate");
  const originBlocked = guardOrigin(ctx);
  if (originBlocked) return originBlocked;
  if ((!hasPermission(ctx.role, "report:read") && !hasPermission(ctx.role, "agent:run")) || ctx.sessionInvalid) {
    return deny(ctx, 403, "Akses ditolak.", "REPORT_GENERATE_DENIED", `Peran ${ctx.role} mencoba membuat laporan.`);
  }
  const limited = await guardRateLimit(ctx, `report-generate:${ctx.userId ?? ctx.ip}`, 10, 60_000);
  if (limited) return limited;
  const tooLarge = await guardBodySize(ctx);
  if (tooLarge) return tooLarge;
  const parsed = bodySchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return deny(ctx, 400, "Data tidak valid.", "REPORT_GENERATE_INVALID");
  const result = await runReporter(new Date(), parsed.data.approvalId);
  await auditApiAccess({ request: ctx.request, session: ctx.session, action: "REPORT_GENERATE", detail: `Laporan ${result.reportId} dibuat (PDF + Excel).`, requestId: ctx.requestId });
  return ok(ctx, {
    reportId: result.reportId, date: result.data.date,
    summary: { newPatients: result.data.newPatients, controls: result.data.controls, cancelled: result.data.cancelled, urgent: result.data.urgent, pendingClaims: result.data.pendingClaims, visits7Days: result.data.visits7Days },
    files: result.files, email: result.email, requestId: ctx.requestId
  });
}
