import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/rbac";
import { runAllAgents } from "@/agents/orchestrator";
import { createApiContext, deny, guardOrigin, guardRateLimit, ok } from "@/lib/apiRoute";
import { auditApiAccess } from "@/lib/audit";
import { enqueueJob } from "@/lib/queue";

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/orchestrator/run");
  const originBlocked = guardOrigin(ctx);
  if (originBlocked) return originBlocked;
  if (!hasPermission(ctx.role, "agent:run") || ctx.sessionInvalid) {
    return deny(
      ctx,
      403,
      "Akses ditolak: hanya ADMIN yang bisa menjalankan agent.",
      "AGENT_RUN_DENIED",
      `Peran ${ctx.role} mencoba menjalankan agent.`
    );
  }
  const limited = await guardRateLimit(ctx, `orchestrator:${ctx.userId ?? ctx.ip}`, 5, 60_000);
  if (limited) return limited;

  const trigger = ctx.userId ?? "SYSTEM";
  const queued = await enqueueJob("orchestrator.run", { triggeredBy: trigger });
  await auditApiAccess({
    request: ctx.request,
    session: ctx.session,
    action: queued.mode === "redis" ? "AGENT_RUN_QUEUED" : "AGENT_RUN",
    detail: queued.detail,
    requestId: ctx.requestId
  });

  if (queued.mode === "redis") {
    return ok(
      ctx,
      { queued: true, jobId: queued.jobId, detail: queued.detail, requestId: ctx.requestId },
      202
    );
  }

  const result = await runAllAgents();
  return ok(ctx, { ...result, requestId: ctx.requestId });
}
