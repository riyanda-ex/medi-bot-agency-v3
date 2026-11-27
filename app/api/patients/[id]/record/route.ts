import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { canViewDiagnosis, hasPermission } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { redactRecordForRole } from "@/agents/securityGuard";
import { enforceRateLimit, getClientIp } from "@/lib/requestGuard";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Detail rekam medis dengan redaksi peran. Diagnosis/anamnesis hanya dikirim
 * ke DOKTER/ADMIN; peran lain menerima field non-diagnosis saja.
 */
export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? "TIDAK_AKTIF";
  const { id } = await context.params;

  if (!hasPermission(role, "patient:read") || session?.user.invalid) {
    await auditApiAccess({
      request,
      session,
      action: "RECORD_DENIED",
      targetPatientId: id,
      detail: `Peran ${role} mencoba membaca rekam medis.`
    });
    return NextResponse.json({ error: "Akses ditolak." }, { status: 403 });
  }

  const limited = await enforceRateLimit(
    `record:${session?.user.id ?? getClientIp(request)}`,
    120,
    60_000
  );
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
  const visible = records.map((record) => redactRecordForRole(record, role));
  await auditApiAccess({
    request,
    session,
    action: canViewDiagnosis(role) ? "RECORD_READ_FULL" : "RECORD_READ_REDACTED",
    targetPatientId: id,
    detail: `${visible.length} rekam medis dikembalikan.`
  });

  return NextResponse.json({
    patientId: id,
    canViewDiagnosis: canViewDiagnosis(role),
    diagnosis: canViewDiagnosis(role) ? (latestVisit?.diagnosis ?? null) : null,
    icd10: canViewDiagnosis(role) ? (latestVisit?.icd10 ?? null) : null,
    records: visible
  });
}
