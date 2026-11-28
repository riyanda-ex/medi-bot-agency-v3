import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/rbac";
import { runAllAgents } from "@/agents/orchestrator";
import { deny, guardRateLimit, ok, withApi } from "@/lib/apiRoute";
import { auditApiAccess } from "@/lib/audit";
import { enqueueJob } from "@/lib/queue";

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await withApi(request, { path: "/api/orchestrator/run" });
  if (gate.response) return gate.response;
  const { ctx } = gate;
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
