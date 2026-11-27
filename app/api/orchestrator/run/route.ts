import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/rbac";
import { runAllAgents } from "@/agents/orchestrator";
import { createApiContext, deny, guardOrigin, guardRateLimit, ok } from "@/lib/apiRoute";
import { auditApiAccess } from "@/lib/audit";

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/orchestrator/run");
  const originBlocked = guardOrigin(ctx);
  if (originBlocked) return originBlocked;
  if (!hasPermission(ctx.role, "agent:run") || ctx.sessionInvalid) {
    return deny(
      ctx,
      403,
      "Akses ditolak.",
      "ORCHESTRATOR_DENIED",
      `Peran ${ctx.role} mencoba menjalankan orchestrator.`
    );
  }
  const limited = await guardRateLimit(ctx, `orchestrator:${ctx.userId ?? ctx.ip}`, 5, 60_000);
  if (limited) return limited;
  const result = await runAllAgents();
  void ctx.userId;
  await auditApiAccess({
    request: ctx.request,
    session: ctx.session,
    action: "ORCHESTRATOR_RUN",
    detail: `Run ${result.runId} selesai, outcomes ${result.outcomes.length}`,
    requestId: ctx.requestId
  });
  return ok(ctx, { ...result, requestId: ctx.requestId });
}
