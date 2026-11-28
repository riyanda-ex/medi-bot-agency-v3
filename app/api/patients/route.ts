import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditApiAccess } from "@/lib/audit";
import { createApiContext, deny, guardRateLimit, ok, requirePermission } from "@/lib/apiRoute";

export async function GET(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/patients");
  if (!requirePermission(ctx, "patient:read"))
    return deny(ctx, 403, "Akses ditolak.", "PATIENT_LIST_DENIED");
  const limited = await guardRateLimit(
    ctx,
    `patients:${ctx.session?.user.id ?? ctx.ip}`,
    120,
    60_000
  );
  if (limited) return limited;
  const canReadNik = requirePermission(ctx, "patient:read_nik");
  const canReadDiagnosis = requirePermission(ctx, "patient:read_diagnosis");
  const canReadContact = requirePermission(ctx, "patient:read_contact");
  const patients = await prisma.patient.findMany({
    include: {
      visits: {
        orderBy: { visitDate: "desc" },
        take: 1,
        include: { triageLogs: { orderBy: { createdAt: "desc" }, take: 1 } }
      }
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  const rows = patients.map((p) => {
    const lastVisit = p.visits[0];
    const lastTriage = lastVisit?.triageLogs[0];
    return {
      id: p.id,
      name: p.name,
      // nikMasked sudah disimpan saat import; jangan pernah mask ciphertext.
      nik: canReadNik ? p.nikMasked : "************",
      birthDate: p.birthDate.toISOString(),
      gender: "-",
      phone: canReadContact ? "********" : "********",
      address: canReadContact ? p.address : "Dibatasi",
      bpjsNo: null,
      insuranceType: null,
      allergies: p.allergies,
      chronicDiseases: null,
      lastVisit: lastVisit
        ? {
            date: lastVisit.visitDate.toISOString(),
            complaint: lastVisit.complaint,
            diagnosis: canReadDiagnosis
              ? lastVisit.diagnosis
              : "Hanya dokter dapat melihat diagnosis",
            icd10: canReadDiagnosis ? lastVisit.icd10 : null,
            status: lastVisit.status,
            triage: lastTriage
              ? { level: lastTriage.level, reasons: JSON.parse(lastTriage.reasons) }
              : null
          }
        : null
    };
  });
  const phiFields = [
    canReadNik ? "nik" : null,
    canReadDiagnosis ? "diagnosis" : null,
    canReadContact ? "contact" : null
  ].filter((field): field is string => Boolean(field));
  await auditApiAccess({
    request,
    session: ctx.session,
    action: phiFields.length > 0 ? "PATIENT_PHI_BULK_READ" : "PATIENT_LIST_READ",
    detail: `${rows.length} pasien dikembalikan; field=${phiFields.join(",") || "none"}.`,
    requestId: ctx.requestId
  });

  return ok(ctx, { patients: rows, requestId: ctx.requestId });
}
