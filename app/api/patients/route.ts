import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditApiAccess } from "@/lib/audit";
import { createApiContext, deny, guardRateLimit, ok, requirePermission } from "@/lib/apiRoute";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional()
});

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
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );
  if (!parsed.success)
    return deny(ctx, 400, "Parameter pagination tidak valid.", "PATIENT_INVALID_QUERY");
  const { limit, cursor } = parsed.data;

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
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
  });
  const nextCursor = patients.length > limit ? (patients[limit - 1]?.id ?? null) : null;
  const page = patients.slice(0, limit);
  const rows = page.map((p) => {
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

  return ok(ctx, { patients: rows, limit, nextCursor, requestId: ctx.requestId });
}
