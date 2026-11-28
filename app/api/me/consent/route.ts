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

const consentBodySchema = z.object({
  patientId: patientIdSchema.optional(),
  consent: z.enum(["GRANTED", "REVOKED"])
});

/** Retensi default setelah pencabutan persetujuan (hari). */
const RETENTION_DAYS = 30;

function consentPayload(patient: {
  id: string;
  consentStatus: string;
  consentAt: Date | null;
  consentRevokedAt: Date | null;
  retentionUntil: Date | null;
}) {
  return {
    patientId: patient.id,
    consentStatus: patient.consentStatus,
    consentAt: patient.consentAt?.toISOString() ?? null,
    consentRevokedAt: patient.consentRevokedAt?.toISOString() ?? null,
    retentionUntil: patient.retentionUntil?.toISOString() ?? null
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
      visits: { select: { doctorId: true } }
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
  const updated = await prisma.patient.update({
    where: { id: patient.id },
    data:
      consent === "GRANTED"
        ? {
            consentStatus: "GRANTED",
            consentAt: now,
            consentRevokedAt: null,
            retentionUntil: null,
            deletionRequestedAt: null
          }
        : {
            consentStatus: "REVOKED",
            consentRevokedAt: now,
            retentionUntil: new Date(now.getTime() + RETENTION_DAYS * 86_400_000)
          },
    select: {
      id: true,
      consentStatus: true,
      consentAt: true,
      consentRevokedAt: true,
      retentionUntil: true
    }
  });

  await auditApiAccess({
    request,
    session: ctx.session,
    action: consent === "GRANTED" ? "CONSENT_GRANTED" : "CONSENT_REVOKED",
    targetPatientId: updated.id,
    detail:
      consent === "GRANTED"
        ? "Persetujuan pemrosesan data diberikan."
        : `Persetujuan dicabut; retensi ${RETENTION_DAYS} hari dijadwalkan.`,
    requestId: ctx.requestId
  });

  return ok(ctx, { ...consentPayload(updated), requestId: ctx.requestId });
}
