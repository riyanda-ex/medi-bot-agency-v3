import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { runUrgentTriage } from "@/agents/urgentCaller";
import { writeAgentLog } from "@/lib/agentLog";
import { enforceRateLimit, enforceSameOrigin, getClientIp } from "@/lib/requestGuard";

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
  patientId: z.string().min(1),
  complaint: z.string().max(500).optional(),
  approvalId: z.string().min(1).optional(),
  vitals: vitalsSchema
});

export async function POST(request: Request): Promise<NextResponse> {
  const originBlocked = enforceSameOrigin(request);
  if (originBlocked) return originBlocked;

  const startedAt = Date.now();
  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? "TIDAK_AKTIF";

  if (!hasPermission(role, "triage:write") || session?.user.invalid) {
    await auditApiAccess({
      request,
      session,
      action: "TRIAGE_DENIED",
      detail: `Peran ${role} mencoba melakukan triage.`
    });
    return NextResponse.json(
      { error: "Akses ditolak: peran Anda tidak boleh melakukan triage." },
      { status: 403 }
    );
  }

  const limited = await enforceRateLimit(
    `triage:${session?.user.id ?? getClientIp(request)}`,
    60,
    60_000
  );
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Data tidak valid.", detail: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const patient = await prisma.patient.findUnique({ where: { id: parsed.data.patientId } });
  if (!patient) {
    return NextResponse.json({ error: "Pasien tidak ditemukan." }, { status: 404 });
  }

  const { vitals } = parsed.data;
  const visit = await prisma.visit.create({
    data: {
      patientId: patient.id,
      doctorId: session?.user.doctorId ?? undefined,
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
    actorId: session?.user.id,
    approvalId: parsed.data.approvalId
  });

  await writeAgentLog({
    agentName: "TRIAGE_API",
    status: "SUCCESS",
    message: `Triage ${result.level} selesai dalam ${Date.now() - startedAt} ms`,
    runId: result.triageLogId,
    durationMs: Date.now() - startedAt
  });

  await auditApiAccess({
    request,
    session,
    action: "TRIAGE_SUBMIT",
    targetPatientId: patient.id,
    detail: `Level ${result.level}, triageLog ${result.triageLogId}, latensi ${Date.now() - startedAt} ms.`
  });

  return NextResponse.json({
    ...result,
    latencyMs: Date.now() - startedAt,
    visitId: visit.id,
    patientName: patient.name
  });
}
