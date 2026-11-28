import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { maskNik } from "@/lib/crypto";
import { deny, guardRateLimit, ok, requirePermission, withApi } from "@/lib/apiRoute";

export async function GET(request: Request): Promise<NextResponse> {
  const gate = await withApi(request, { path: "/api/patients" });
  if (gate.response) return gate.response;
  const { ctx } = gate;
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
      nik: canReadNik ? maskNik(p.nikEncrypted) : "************",
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
  return ok(ctx, { patients: rows, requestId: ctx.requestId });
}
