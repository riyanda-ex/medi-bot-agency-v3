import { randomUUID } from "node:crypto";
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
import { encryptPhi, fieldHash } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { canAnonymizePatient } from "@/lib/privacy";

type RouteContext = { params: Promise<{ id: string }> };

const deleteSchema = z.object({
  reason: z.string().trim().min(5).max(200)
});

/**
 * Penghapusan data pasien (right to erasure) bersifat soft-delete + anonimisasi.
 * Audit log sengaja dipertahankan sebagai bukti kepatuhan, tetapi tidak lagi
 * berisi PHI yang dapat dihubungkan ke individu.
 */
export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/patients/[id]/privacy");
  if (ctx.role !== "ADMIN" || ctx.sessionInvalid) {
    return deny(ctx, 403, "Hanya ADMIN yang dapat menghapus data pasien.", "PRIVACY_DELETE_DENIED");
  }

  const originBlocked = guardOrigin(ctx);
  if (originBlocked) return originBlocked;
  const bodyBlocked = await guardBodySize(ctx);
  if (bodyBlocked) return bodyBlocked;

  const { id: rawId } = await context.params;
  const parsedId = patientIdSchema.safeParse(rawId);
  if (!parsedId.success) {
    return deny(ctx, 400, "ID pasien tidak valid.", "PRIVACY_INVALID_ID");
  }
  const patientId = parsedId.data;

  const confirmation = request.headers.get("x-confirm-privacy-delete")?.trim();
  if (confirmation !== patientId) {
    return deny(ctx, 400, "Konfirmasi penghapusan tidak cocok.", "PRIVACY_CONFIRMATION_MISMATCH");
  }

  const parsedBody = deleteSchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsedBody.success) {
    return deny(
      ctx,
      400,
      "Alasan penghapusan wajib diisi (5-200 karakter).",
      "PRIVACY_INVALID_BODY"
    );
  }

  const limited = await guardRateLimit(ctx, `privacy:delete:${ctx.userId ?? ctx.ip}`, 5, 60_000);
  if (limited) return limited;

  const patient = await prisma.patient
    .findUnique({
      where: { id: patientId },
      select: {
        id: true,
        consentStatus: true,
        consentRevokedAt: true,
        retentionUntil: true,
        legalHold: true,
        deletedAt: true
      }
    })
    .catch(() => null);
  if (!patient) return deny(ctx, 404, "Pasien tidak ditemukan.", "PRIVACY_NOT_FOUND");
  if (patient.deletedAt) {
    return deny(ctx, 409, "Data pasien sudah dianonimisasi.", "PRIVACY_ALREADY_DELETED");
  }
  if (!canAnonymizePatient(patient)) {
    return deny(
      ctx,
      400,
      "Legal hold aktif, consent belum dicabut, atau retensi klinis 25 tahun belum berakhir.",
      "PRIVACY_PRECONDITION_FAILED"
    );
  }

  // Pemusnahan tanpa tiket terverifikasi tidak boleh terjadi. Tiket dibuat oleh
  // pasien, diverifikasi ADMIN, lalu dieksekusi di sini.
  const ticket = await prisma.dataSubjectRequest
    .findFirst({
      where: {
        patientId,
        type: "DELETION",
        status: "APPROVED"
      },
      orderBy: { requestedAt: "desc" }
    })
    .catch(() => null);
  if (!ticket || ticket.status !== "APPROVED") {
    return deny(
      ctx,
      409,
      "Tiket permintaan penghapusan belum diverifikasi ADMIN.",
      "PRIVACY_TICKET_MISSING"
    );
  }

  const now = new Date();
  const anonymizedNik = randomUUID().replace(/-/g, "").slice(0, 16);
  const tag = randomUUID().replace(/-/g, "").slice(0, 8);

  await prisma.$transaction([
    prisma.patient.update({
      where: { id: patientId },
      data: {
        nikEncrypted: encryptPhi(anonymizedNik),
        nikHash: fieldHash(anonymizedNik),
        nikMasked: "****",
        name: `Pasien Anonim-${tag}`,
        birthDate: new Date("1900-01-01T00:00:00.000Z"),
        address: "[DIHAPUS]",
        phoneEncrypted: encryptPhi("[DIHAPUS]"),
        allergies: "[DIHAPUS]",
        consentStatus: "REVOKED",
        deletedAt: now,
        anonymizedAt: now
      }
    }),
    // Fakta klinis sengaja dipertahankan sesuai Permenkes: yang dihapus adalah
    // identitas penghubung, bukan anamnesis/diagnosis/laboratorium/resep.
    prisma.dataSubjectRequest.updateMany({
      where: { patientId, type: "DELETION", status: "APPROVED" },
      data: {
        status: "COMPLETED",
        completedAt: now,
        openKey: null,
        notes: "Anonimisasi identitas selesai."
      }
    })
  ]);

  await auditApiAccess({
    request,
    session: ctx.session,
    action: "PATIENT_ANONYMIZED",
    targetPatientId: patientId,
    detail: `Anonimisasi dilakukan. Alasan: ${parsedBody.data.reason}`,
    requestId: ctx.requestId
  });

  return ok(ctx, {
    patientId,
    deletedAt: now.toISOString(),
    anonymizedAt: now.toISOString(),
    requestId: ctx.requestId
  });
}
