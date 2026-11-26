import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { buildUrgentJobId, enqueueJob } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import { executeUrgentFollowUp } from "@/agents/urgentCaller";

const bodySchema = z
  .object({
    patientId: z.string().min(1).optional(),
    visitId: z.string().min(1).optional(),
    triageLogId: z.string().min(1).optional()
  })
  .refine((data) => Boolean(data.patientId || data.visitId || data.triageLogId), {
    message: "Salah satu dari patientId, visitId, atau triageLogId wajib diisi."
  });

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? "TIDAK_AKTIF";

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
    return NextResponse.json(
      { error: "Data tidak valid.", detail: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Semua ID harus mengarah ke pasien yang sama; tidak ada fallback "MERAH terbaru".
  let patientId = parsed.data.patientId;
  if (parsed.data.triageLogId) {
    const log = await prisma.triageLog.findUnique({
      where: { id: parsed.data.triageLogId },
      select: { patientId: true, visitId: true }
    });
    if (!log) return NextResponse.json({ error: "Triage log tidak ditemukan." }, { status: 404 });
    if (patientId && patientId !== log.patientId) {
      return NextResponse.json({ error: "patientId tidak cocok dengan triageLogId." }, { status: 400 });
    }
    patientId = log.patientId;
    if (parsed.data.visitId && log.visitId && parsed.data.visitId !== log.visitId) {
      return NextResponse.json({ error: "visitId tidak cocok dengan triageLogId." }, { status: 400 });
    }
  }
  if (parsed.data.visitId) {
    const visit = await prisma.visit.findUnique({
      where: { id: parsed.data.visitId },
      select: { patientId: true }
    });
    if (!visit) return NextResponse.json({ error: "Kunjungan tidak ditemukan." }, { status: 404 });
    if (patientId && patientId !== visit.patientId) {
      return NextResponse.json({ error: "patientId tidak cocok dengan visitId." }, { status: 400 });
    }
    patientId = visit.patientId;
  }
  if (!patientId) {
    return NextResponse.json({ error: "Pasien tidak ditemukan dari ID yang diberikan." }, { status: 404 });
  }

  const context = {
    actor: session?.user.id ?? "SYSTEM",
    simulate: true,
    stage: 0,
    resource: parsed.data.triageLogId ?? parsed.data.visitId ?? patientId
  };
  const queued = await enqueueJob(
    "urgent.followup",
    {
      patientId,
      visitId: parsed.data.visitId,
      triageLogId: parsed.data.triageLogId,
      actorId: session?.user.id,
      simulate: true
    },
    { jobId: buildUrgentJobId("urgent-sim", patientId, context) }
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
