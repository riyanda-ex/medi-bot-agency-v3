import { NextResponse } from "next/server";
import { z } from "zod";
import { auditApiAccess } from "@/lib/audit";
import {
  createApiContext,
  deny,
  guardBodySize,
  guardOrigin,
  guardRateLimit,
  ok,
  patientIdSchema
} from "@/lib/apiRoute";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import {
  addYears,
  CLINICAL_RETENTION_YEARS,
  consentRetentionUntil,
  dsrDueAt,
  latestVisitDate,
  DSR_SLA_HOURS
} from "@/lib/privacy";

const consentBodySchema = z.object({
  patientId: patientIdSchema.optional(),
  consent: z.enum(["GRANTED", "REVOKED"])
});

function consentPayload(patient: {
  id: string;
  consentStatus: string;
  consentAt: Date | null;
  consentRevokedAt: Date | null;
  retentionUntil: Date | null;
  legalHold?: boolean;
}) {
  return {
    patientId: patient.id,
    consentStatus: patient.consentStatus,
    consentAt: patient.consentAt?.toISOString() ?? null,
    consentRevokedAt: patient.consentRevokedAt?.toISOString() ?? null,
    retentionUntil: patient.retentionUntil?.toISOString() ?? null,
    legalHold: patient.legalHold ?? false,
    dsrSlaHours: DSR_SLA_HOURS
  };
}

/** Hanya pasien yang bersangkutan, dokter yang merawat, atau ADMIN. */
function canManageConsent(
  role: string,
  sessionPatientId: string | undefined,
  sessionDoctorId: string | undefined,
  patientId: string,
  patientDoctorIds: string[]
): boolean {
  if (role === "ADMIN") return true;
  if (role === "PASIEN") return Boolean(sessionPatientId) && sessionPatientId === patientId;
  if (role === "DOKTER") {
    return Boolean(sessionDoctorId && patientDoctorIds.includes(sessionDoctorId));
  }
  return false;
}

async function findPatient(patientId: string) {
  return prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      id: true,
      consentStatus: true,
      consentAt: true,
      consentRevokedAt: true,
      retentionUntil: true,
      legalHold: true,
      visits: { select: { doctorId: true, visitDate: true } }
    }
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/me/consent");
  if (!hasPermission(ctx.role, "own:read") && !hasPermission(ctx.role, "patient:read")) {
    return deny(ctx, 403, "Akses ditolak.", "CONSENT_DENIED");
  }

  const limited = await guardRateLimit(ctx, `consent:${ctx.userId ?? ctx.ip}`, 30, 60_000);
  if (limited) return limited;

  const requested = new URL(request.url).searchParams.get("patientId");
  const parsed = patientIdSchema.safeParse(requested ?? ctx.session?.user.patientId ?? "");
  if (!parsed.success) return deny(ctx, 400, "ID pasien tidak valid.", "CONSENT_INVALID_ID");
  const patientId = parsed.data;

  const patient = await findPatient(patientId).catch(() => null);
  if (!patient || patient.id !== patientId) {
    return deny(ctx, 404, "Pasien tidak ditemukan.", "CONSENT_NOT_FOUND");
  }
  if (
    !canManageConsent(
      ctx.role,
      ctx.session?.user.patientId,
      ctx.session?.user.doctorId,
      patient.id,
      patient.visits.map((visit) => visit.doctorId).filter((id): id is string => Boolean(id))
    )
  ) {
    return deny(ctx, 403, "Akses ditolak: pasien di luar scope Anda.", "CONSENT_OBJECT_DENIED");
  }

  await auditApiAccess({
    request,
    session: ctx.session,
    action: "CONSENT_READ",
    targetPatientId: patientId,
    detail: "Status persetujuan dan retensi dibaca.",
    requestId: ctx.requestId
  });
  return ok(ctx, { ...consentPayload(patient), requestId: ctx.requestId });
}

export async function PUT(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/me/consent");
  if (ctx.sessionInvalid || ctx.role === "TIDAK_AKTIF") {
    return deny(ctx, 403, "Sesi tidak sah.", "CONSENT_DENIED");
  }
  const originBlocked = guardOrigin(ctx);
  if (originBlocked) return originBlocked;
  const bodyBlocked = await guardBodySize(ctx);
  if (bodyBlocked) return bodyBlocked;
  const limited = await guardRateLimit(ctx, `consent:write:${ctx.userId ?? ctx.ip}`, 10, 60_000);
  if (limited) return limited;

  const parsedBody = consentBodySchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsedBody.success) {
    return deny(ctx, 400, "Body tidak valid.", "CONSENT_INVALID_BODY");
  }
  const { consent } = parsedBody.data;
  const patientId = parsedBody.data.patientId ?? ctx.session?.user.patientId ?? "";
  const parsedId = patientIdSchema.safeParse(patientId);
  if (!parsedId.success) return deny(ctx, 400, "ID pasien tidak valid.", "CONSENT_INVALID_ID");

  const patient = await findPatient(parsedId.data).catch(() => null);
  if (!patient || patient.id !== parsedId.data) {
    return deny(ctx, 404, "Pasien tidak ditemukan.", "CONSENT_NOT_FOUND");
  }
  if (
    !canManageConsent(
      ctx.role,
      ctx.session?.user.patientId,
      ctx.session?.user.doctorId,
      patient.id,
      patient.visits.map((visit) => visit.doctorId).filter((id): id is string => Boolean(id))
    )
  ) {
    return deny(ctx, 403, "Akses ditolak: pasien di luar scope Anda.", "CONSENT_OBJECT_DENIED");
  }

  const now = new Date();
  // Retensi mengikuti kunjungan terakhir (25 tahun), bukan tanggal pencabutan.
  // Pemberian ulang consent menghapus baseline 30 hari lama agar siklus
  // cabut→grant→cabut tidak mewarisi tenggat erasure yang sudah terlewat.
  const lastVisitAt = latestVisitDate(patient.visits);
  const retentionUntil =
    consent === "GRANTED"
      ? lastVisitAt
        ? addYears(lastVisitAt, CLINICAL_RETENTION_YEARS)
        : null
      : consentRetentionUntil(lastVisitAt, now, patient.retentionUntil);
  const updated = await prisma.patient.update({
    where: { id: patient.id },
    data:
      consent === "GRANTED"
        ? {
            consentStatus: "GRANTED",
            consentAt: now,
            consentRevokedAt: null,
            retentionUntil,
            deletionRequestedAt: null,
            deletionReason: null
          }
        : {
            consentStatus: "REVOKED",
            consentRevokedAt: now,
            retentionUntil
          },
    select: {
      id: true,
      consentStatus: true,
      consentAt: true,
      consentRevokedAt: true,
      retentionUntil: true,
      legalHold: true
    }
  });

  if (consent === "REVOKED") {
    // Penarikan consent adalah hak subjek data. Tiket SLA 3x24 jam dicatat
    // walaupun eksekusi penghentian outbound terjadi segera.
    await prisma.dataSubjectRequest.create({
      data: {
        patientId: patient.id,
        type: "CONSENT_WITHDRAWAL",
        status: "COMPLETED",
        requestedBy: ctx.userId ?? "SYSTEM",
        requestedAt: now,
        dueAt: dsrDueAt(now),
        completedAt: now,
        notes: lastVisitAt
          ? `Consent dicabut; retensi klinis sampai ${retentionUntil?.toISOString() ?? "-"}.`
          : "Consent dicabut; tidak ada kunjungan tercatat."
      }
    });
  }

  await auditApiAccess({
    request,
    session: ctx.session,
    action: consent === "GRANTED" ? "CONSENT_GRANTED" : "CONSENT_REVOKED",
    targetPatientId: updated.id,
    detail:
      consent === "GRANTED"
        ? "Persetujuan pemrosesan data diberikan."
        : `Persetujuan dicabut; retensi klinis sampai ${retentionUntil?.toISOString() ?? "-"}; SLA hak ${DSR_SLA_HOURS} jam tercatat.`,
    requestId: ctx.requestId
  });

  return ok(ctx, { ...consentPayload(updated), requestId: ctx.requestId });
}
