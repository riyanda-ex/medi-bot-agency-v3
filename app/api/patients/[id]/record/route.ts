import { NextResponse } from "next/server";
import { canViewDiagnosis, hasPermission } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { redactRecordForRole } from "@/agents/securityGuard";
import { guardRateLimit, ok, withApi } from "@/lib/apiRoute";
import { jsonWithRequestId } from "@/lib/requestContext";
import { logApiRequest } from "@/lib/apiLog";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Detail rekam medis dengan redaksi peran. Diagnosis/anamnesis hanya dikirim
 * ke DOKTER/ADMIN; peran lain menerima field non-diagnosis saja.
 */
export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const gate = await withApi(request, { path: "/api/patients/[id]/record" });
  if (gate.response) return gate.response;
  const { ctx } = gate;
  const { id } = await context.params;

  if (!hasPermission(ctx.role, "patient:read") || ctx.sessionInvalid) {
    await auditApiAccess({
      request,
      session: ctx.session,
      action: "RECORD_DENIED",
      targetPatientId: id,
      detail: `Peran ${ctx.role} mencoba membaca rekam medis.`,
      requestId: ctx.requestId
    });
    void logApiRequest({
      requestId: ctx.requestId,
      method: "GET",
      path: ctx.path,
      statusCode: 403,
      durationMs: Date.now() - ctx.startedAt,
      ip: ctx.ip,
      userId: ctx.userId,
      error: "forbidden"
    });
    return jsonWithRequestId(
      ctx.requestId,
      { error: "Akses ditolak.", requestId: ctx.requestId },
      { status: 403 }
    );
  }

  const limited = await guardRateLimit(ctx, `record:${ctx.userId ?? ctx.ip}`, 120, 60_000);
  if (limited) return limited;

  const records = await prisma.medicalRecord.findMany({
    where: { patientId: id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      diagnosisIcd10: true,
      anamnesis: true,
      actionIcd9: true,
      radiology: true,
      vitalSigns: true,
      completenessScore: true,
      createdAt: true,
      doctor: { select: { name: true, specialty: true } }
    }
  });

  const latestVisit = await prisma.visit.findFirst({
    where: { patientId: id },
    orderBy: { visitDate: "desc" },
    select: { diagnosis: true, icd10: true }
  });
  const visible = records.map((record) => redactRecordForRole(record, ctx.role));
  await auditApiAccess({
    request,
    session: ctx.session,
    action: canViewDiagnosis(ctx.role) ? "RECORD_READ_FULL" : "RECORD_READ_REDACTED",
    targetPatientId: id,
    detail: `${visible.length} rekam medis dikembalikan.`,
    requestId: ctx.requestId
  });

  return ok(ctx, {
    patientId: id,
    canViewDiagnosis: canViewDiagnosis(ctx.role),
    diagnosis: canViewDiagnosis(ctx.role) ? (latestVisit?.diagnosis ?? null) : null,
    icd10: canViewDiagnosis(ctx.role) ? (latestVisit?.icd10 ?? null) : null,
    records: visible,
    requestId: ctx.requestId
  });
}
