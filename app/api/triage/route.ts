import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { runUrgentTriage } from "@/agents/urgentCaller";
import { assertPatientAccess, PatientAccessError, type Role } from "@/lib/rbac";
import { writeAgentLog } from "@/lib/agentLog";
import { auditApiAccess } from "@/lib/audit";
import { logger } from "@/lib/logger";
import {
  approvalIdSchema,
  createApiContext,
  deny,
  guardBodySize,
  guardOrigin,
  guardRateLimit,
  ok,
  patientIdSchema,
  requirePermission
} from "@/lib/apiRoute";

const vitalsSchema = z.object({
  systolic: z.number().int().min(0).max(300).nullable().optional(),
  diastolic: z.number().int().min(0).max(200).nullable().optional(),
  glucose: z.number().int().min(0).max(1000).nullable().optional(),
  saturation: z.number().int().min(0).max(100).nullable().optional(),
  pulse: z.number().int().min(0).max(250).nullable().optional(),
  temperature: z.number().min(30).max(45).nullable().optional(),
  potassium: z.number().min(0).max(15).nullable().optional(),
  hemoglobin: z.number().min(0).max(30).nullable().optional(),
  platelets: z.number().int().min(0).max(2000000).nullable().optional(),
  notes: z.string().max(1000).nullable().optional()
});

const bodySchema = z.object({
  patientId: patientIdSchema,
  complaint: z.string().max(500).optional(),
  approvalId: approvalIdSchema.optional(),
  vitals: vitalsSchema
});

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/triage");
  const originBlocked = guardOrigin(ctx);
  if (originBlocked) return originBlocked;

  if (!requirePermission(ctx, "triage:write")) {
    return deny(
      ctx,
      403,
      "Akses ditolak: peran Anda tidak boleh melakukan triage.",
      "TRIAGE_DENIED",
      `Peran ${ctx.role} mencoba melakukan triage.`
    );
  }

  const limited = await guardRateLimit(ctx, `triage:${ctx.userId ?? ctx.ip}`, 60, 60_000);
  if (limited) return limited;

  const tooLarge = await guardBodySize(ctx);
  if (tooLarge) return tooLarge;

  const parsed = bodySchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) {
    return deny(ctx, 400, "Data tidak valid.", "TRIAGE_INVALID", undefined, {
      detail: parsed.error.flatten()
    });
  }

  const patient = await prisma.patient.findUnique({ where: { id: parsed.data.patientId } });
  if (!patient) return deny(ctx, 404, "Pasien tidak ditemukan.", "TRIAGE_PATIENT_NOT_FOUND");

  let assignedDoctorId: string | null = null;
  if (ctx.role === "DOKTER") {
    try {
      const visit = await prisma.visit.findFirst({
        where: { patientId: patient.id },
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
      patient.id,
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
      "TRIAGE_OBJECT_DENIED",
      `Peran ${ctx.role} mencoba triase pasien ${patient.id}.`
    );
  }

  const { vitals } = parsed.data;
  const visit = await prisma.visit.create({
    data: {
      patientId: patient.id,
      doctorId: (ctx.session?.user as { doctorId?: string } | undefined)?.doctorId ?? undefined,
      visitDate: new Date(),
      status: "COMPLETED",
      complaint: parsed.data.complaint ?? "Input triage dashboard",
      vitalSystolic: vitals.systolic ?? null,
      vitalDiastolic: vitals.diastolic ?? null,
      glucose: vitals.glucose ?? null,
      saturation: vitals.saturation ?? null,
      pulse: vitals.pulse ?? null,
      temperature: vitals.temperature ?? null,
      potassium: vitals.potassium ?? null,
      hemoglobin: vitals.hemoglobin ?? null,
      platelets: vitals.platelets ?? null
    }
  });

  const result = await runUrgentTriage({
    patientId: patient.id,
    visitId: visit.id,
    source: "DASHBOARD_TRIAGE",
    actorId: ctx.userId,
    approvalId: parsed.data.approvalId
  });

  await writeAgentLog({
    agentName: "TRIAGE_API",
    status: "SUCCESS",
    message: `Triage ${result.level} selesai dalam ${Date.now() - ctx.startedAt} ms`,
    runId: result.triageLogId,
    durationMs: Date.now() - ctx.startedAt
  });

  await auditApiAccess({
    request: ctx.request,
    session: ctx.session,
    action: "TRIAGE_SUBMIT",
    targetPatientId: patient.id,
    detail: `Level ${result.level}, triageLog ${result.triageLogId}, latensi ${Date.now() - ctx.startedAt} ms.`,
    requestId: ctx.requestId
  });
  logger.info("triage.submit", {
    requestId: ctx.requestId,
    patientId: patient.id,
    level: result.level,
    latencyMs: Date.now() - ctx.startedAt,
    actorId: ctx.userId
  });

  return ok(ctx, {
    ...result,
    latencyMs: Date.now() - ctx.startedAt,
    visitId: visit.id,
    patientName: patient.name,
    requestId: ctx.requestId
  });
}
