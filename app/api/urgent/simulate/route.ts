import { NextResponse } from "next/server";
import { z } from "zod";
import { assertPatientAccess, hasPermission, PatientAccessError, type Role } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { buildUrgentJobId, enqueueJob } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import { executeUrgentFollowUp } from "@/agents/urgentCaller";
import {
  createApiContext,
  deny,
  guardBodySize,
  guardOrigin,
  guardRateLimit,
  ok,
  patientIdSchema,
  triageLogIdSchema,
  visitIdSchema
} from "@/lib/apiRoute";

const bodySchema = z
  .object({
    patientId: patientIdSchema.optional(),
    visitId: visitIdSchema.optional(),
    triageLogId: triageLogIdSchema.optional()
  })
  .refine((data) => Boolean(data.patientId || data.visitId || data.triageLogId), {
    message: "Salah satu dari patientId, visitId, atau triageLogId wajib diisi."
  });

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/urgent/simulate");
  const originBlocked = guardOrigin(ctx);
  if (originBlocked) return originBlocked;
  if (
    (!hasPermission(ctx.role, "triage:write") && !hasPermission(ctx.role, "agent:run")) ||
    ctx.sessionInvalid
  ) {
    return deny(
      ctx,
      403,
      "Akses ditolak.",
      "URGENT_SIMULATE_DENIED",
      `Peran ${ctx.role} mencoba simulasi panggilan urgent.`
    );
  }
  const limited = await guardRateLimit(ctx, `urgent-sim:${ctx.userId ?? ctx.ip}`, 20, 60_000);
  if (limited) return limited;
  const tooLarge = await guardBodySize(ctx);
  if (tooLarge) return tooLarge;
  const parsed = bodySchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success)
    return deny(ctx, 400, "Data tidak valid.", "URGENT_SIMULATE_INVALID", undefined, {
      detail: parsed.error.flatten()
    });

  let patientId = parsed.data.patientId;
  if (parsed.data.triageLogId) {
    const log = await prisma.triageLog.findUnique({
      where: { id: parsed.data.triageLogId },
      select: { patientId: true, visitId: true }
    });
    if (!log) return deny(ctx, 404, "Triage log tidak ditemukan.", "URGENT_SIMULATE_NOT_FOUND");
    if (patientId && patientId !== log.patientId)
      return deny(ctx, 400, "patientId tidak cocok dengan triageLogId.", "URGENT_SIMULATE_INVALID");
    patientId = log.patientId;
    if (parsed.data.visitId && log.visitId && parsed.data.visitId !== log.visitId)
      return deny(ctx, 400, "visitId tidak cocok dengan triageLogId.", "URGENT_SIMULATE_INVALID");
  }
  if (parsed.data.visitId) {
    const visit = await prisma.visit.findUnique({
      where: { id: parsed.data.visitId },
      select: { patientId: true }
    });
    if (!visit) return deny(ctx, 404, "Kunjungan tidak ditemukan.", "URGENT_SIMULATE_NOT_FOUND");
    if (patientId && patientId !== visit.patientId)
      return deny(ctx, 400, "patientId tidak cocok dengan visitId.", "URGENT_SIMULATE_INVALID");
    patientId = visit.patientId;
  }
  if (!patientId)
    return deny(
      ctx,
      404,
      "Pasien tidak ditemukan dari ID yang diberikan.",
      "URGENT_SIMULATE_NOT_FOUND"
    );

  let assignedDoctorId: string | null = null;
  if (ctx.role === "DOKTER") {
    try {
      const visit = await prisma.visit.findFirst({
        where: { patientId },
        orderBy: { visitDate: "desc" },
        select: { doctorId: true }
      });
      assignedDoctorId = visit?.doctorId ?? null;
    } catch {
      assignedDoctorId = null;
    }
  }
  try {
    assertPatientAccess(
      ctx.role as Role,
      ctx.userId,
      patientId,
      ctx.session?.user.patientId,
      assignedDoctorId,
      ctx.session?.user.doctorId
    );
  } catch (error) {
    if (!(error instanceof PatientAccessError)) throw error;
    return deny(
      ctx,
      403,
      "Akses ditolak: pasien di luar scope Anda.",
      "URGENT_SIMULATE_OBJECT_DENIED"
    );
  }

  const context = {
    actor: ctx.userId ?? "SYSTEM",
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
      actorId: ctx.userId,
      simulate: true
    },
    { jobId: buildUrgentJobId("urgent-sim", patientId, context) }
  );
  await auditApiAccess({
    request: ctx.request,
    session: ctx.session,
    action: queued.mode === "redis" ? "URGENT_SIMULATE_QUEUED" : "URGENT_SIMULATE",
    targetPatientId: patientId,
    detail: queued.detail,
    requestId: ctx.requestId
  });

  if (queued.mode === "redis") {
    return ok(
      ctx,
      {
        patientId,
        queued: true,
        jobId: queued.jobId,
        stages: [],
        totalLogs: 0,
        detail: queued.detail,
        requestId: ctx.requestId
      },
      202
    );
  }

  const stages = await executeUrgentFollowUp({
    patientId,
    visitId: parsed.data.visitId,
    triageLogId: parsed.data.triageLogId,
    actorId: ctx.userId,
    simulate: true
  });
  return ok(ctx, { patientId, stages, totalLogs: stages.length, requestId: ctx.requestId });
}
