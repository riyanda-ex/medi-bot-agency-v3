import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { enqueueJob } from "@/lib/queue";
import { runAllAgents } from "@/agents/orchestrator";
import { enforceRateLimit, enforceSameOrigin, getClientIp } from "@/lib/requestGuard";

export async function POST(request: Request): Promise<NextResponse> {
  const originBlocked = enforceSameOrigin(request);
  if (originBlocked) return originBlocked;

  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? "TIDAK_AKTIF";

  if (!hasPermission(role, "agent:run") || session?.user.invalid) {
    await auditApiAccess({
      request,
      session,
      action: "AGENT_RUN_DENIED",
      detail: `Peran ${role} mencoba menjalankan agent.`
    });
    return NextResponse.json(
      { error: "Akses ditolak: hanya ADMIN yang bisa menjalankan agent." },
      { status: 403 }
    );
  }

  const limited = await enforceRateLimit(
    `orchestrator:${session?.user.id ?? getClientIp(request)}`,
    5,
    60_000
  );
  if (limited) return limited;

  const trigger = session?.user.id ?? "SYSTEM";
  const queued = await enqueueJob("orchestrator.run", { triggeredBy: trigger });
  await auditApiAccess({
    request,
    session,
    action: queued.mode === "redis" ? "AGENT_RUN_QUEUED" : "AGENT_RUN",
    detail: queued.detail
  });

  if (queued.mode === "redis") {
    return NextResponse.json(
      { queued: true, jobId: queued.jobId, detail: queued.detail },
      { status: 202 }
    );
  }

  const result = await runAllAgents();
  return NextResponse.json(result);
}
