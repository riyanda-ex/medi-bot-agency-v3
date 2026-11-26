import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { enqueueJob } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import { executeUrgentFollowUp } from "@/agents/urgentCaller";

const bodySchema = z.object({
  patientId: z.string().min(1).optional(),
  visitId: z.string().min(1).optional(),
  triageLogId: z.string().min(1).optional()
});

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? "RESEPSIONIS";

  if (!hasPermission(role, "triage:write") && !hasPermission(role, "agent:run")) {
    await auditApiAccess({
      request,
      session,
      action: "URGENT_SIMULATE_DENIED",
      detail: `Peran ${role} mencoba simulasi panggilan urgent.`
    });
    return NextResponse.json({ error: "Akses ditolak." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
  }

  let patientId = parsed.data.patientId;
  if (!patientId && parsed.data.triageLogId) {
    const log = await prisma.triageLog.findUnique({ where: { id: parsed.data.triageLogId } });
    patientId = log?.patientId;
  }
  if (!patientId && parsed.data.visitId) {
    const visit = await prisma.visit.findUnique({ where: { id: parsed.data.visitId } });
    patientId = visit?.patientId;
  }
  if (!patientId) {
    const latest = await prisma.triageLog.findFirst({
      where: { level: "MERAH" },
      orderBy: { createdAt: "desc" }
    });
    patientId = latest?.patientId;
  }
  if (!patientId) {
    return NextResponse.json({ error: "Tidak ada pasien MERAH untuk disimulasikan." }, { status: 404 });
  }

  const queued = await enqueueJob(
    "urgent.followup",
    {
      patientId,
      visitId: parsed.data.visitId,
      triageLogId: parsed.data.triageLogId,
      actorId: session?.user.id,
      simulate: true
    },
    {
      jobId: parsed.data.triageLogId ? `urgent-sim-${parsed.data.triageLogId}` : undefined
    }
  );

  await auditApiAccess({
    request,
    session,
    action: queued.mode === "redis" ? "URGENT_SIMULATE_QUEUED" : "URGENT_SIMULATE",
    targetPatientId: patientId,
    detail: queued.detail
  });

  if (queued.mode === "redis") {
    return NextResponse.json(
      { patientId, queued: true, jobId: queued.jobId, stages: [], totalLogs: 0, detail: queued.detail },
      { status: 202 }
    );
  }

  const stages = await executeUrgentFollowUp({
    patientId,
    visitId: parsed.data.visitId,
    triageLogId: parsed.data.triageLogId,
    actorId: session?.user.id,
    simulate: true
  });

  return NextResponse.json({ patientId, stages, totalLogs: stages.length });
}
