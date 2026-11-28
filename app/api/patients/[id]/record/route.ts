import { NextResponse } from "next/server";
import {
  assertPatientAccess,
  canViewDiagnosis,
  hasPermission,
  PatientAccessError
} from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { redactRecordForRole } from "@/agents/securityGuard";
import { createApiContext, deny, guardRateLimit, ok, patientIdSchema } from "@/lib/apiRoute";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Detail rekam medis dengan redaksi peran. Diagnosis/anamnesis hanya dikirim
 * ke DOKTER/ADMIN; peran lain menerima field non-diagnosis saja.
 */
export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/patients/[id]/record");
  const { id: rawId } = await context.params;
  const parsedId = patientIdSchema.safeParse(rawId);
  if (!parsedId.success) {
    return deny(ctx, 400, "ID pasien tidak valid.", "RECORD_INVALID_ID");
  }
  const id = parsedId.data;

  if (!hasPermission(ctx.role, "patient:read") || ctx.sessionInvalid) {
    return deny(
      ctx,
      403,
      "Akses ditolak.",
      "RECORD_DENIED",
      `Peran ${ctx.role} mencoba membaca rekam medis ${id}.`
    );
  }

  const limited = await guardRateLimit(ctx, `record:${ctx.userId ?? ctx.ip}`, 120, 60_000);
  if (limited) return limited;

  // Object-level access: peran saja tidak cukup, pasien harus masih dalam scope sesi.
  const scope = await prisma.patient
    .findUnique({
      where: { id },
      select: {
        id: true,
        users: { where: { id: ctx.userId ?? "" }, select: { id: true } },
        visits: {
          orderBy: { visitDate: "desc" },
          take: 1,
          select: { doctorId: true }
        }
      }
    })
    .catch(() => null);
  if (!scope) return deny(ctx, 404, "Pasien tidak ditemukan.", "RECORD_NOT_FOUND");
  try {
    assertPatientAccess(
      ctx.role,
      ctx.userId,
      id,
      ctx.session?.user.patientId ?? scope.users[0]?.id,
      scope.visits[0]?.doctorId,
      ctx.session?.user.doctorId
    );
  } catch (error) {
    if (!(error instanceof PatientAccessError)) throw error;
    return deny(
      ctx,
      403,
      "Akses ditolak: pasien di luar scope Anda.",
      "RECORD_OBJECT_DENIED",
      `Peran ${ctx.role} mencoba membaca rekam medis ${id}.`
    );
  }

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
