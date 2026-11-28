import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createApiContext,
  deny,
  guardBodySize,
  guardOrigin,
  guardRateLimit,
  ok
} from "@/lib/apiRoute";
import { auditApiAccess } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { dsrDueAt, DSR_SLA_HOURS } from "@/lib/privacy";

const createSchema = z.object({
  type: z.enum(["ACCESS", "COPY", "RECTIFICATION", "DELETION"]),
  notes: z.string().trim().min(5).max(500).optional()
});

const OPEN_STATUSES = ["PENDING", "IN_PROGRESS", "APPROVED"] as const;

/** Tiket hak subjek data: pasien mengajukan, ADMIN memverifikasi, SLA 3x24 jam. */
export async function GET(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/me/privacy-requests");
  const patientId = ctx.session?.user.patientId;
  if (!patientId || ctx.sessionInvalid) {
    return deny(ctx, 403, "Hanya pasien yang dapat melihat tiket sendiri.", "DSR_DENIED");
  }
  const limited = await guardRateLimit(ctx, `dsr-read:${ctx.userId ?? ctx.ip}`, 30, 60_000);
  if (limited) return limited;

  const requests = await prisma.dataSubjectRequest.findMany({
    where: { patientId },
    orderBy: { requestedAt: "desc" },
    take: 50,
    select: {
      id: true,
      type: true,
      status: true,
      requestedAt: true,
      dueAt: true,
      completedAt: true,
      notes: true
    }
  });

  return ok(ctx, {
    requests: requests.map((item) => ({ ...item, slaHours: DSR_SLA_HOURS })),
    requestId: ctx.requestId
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/me/privacy-requests");
  const patientId = ctx.session?.user.patientId;
  if (!patientId || ctx.sessionInvalid) {
    return deny(ctx, 403, "Hanya pasien yang dapat mengajukan tiket.", "DSR_DENIED");
  }
  const originBlocked = guardOrigin(ctx);
  if (originBlocked) return originBlocked;
  const bodyBlocked = await guardBodySize(ctx);
  if (bodyBlocked) return bodyBlocked;
  const limited = await guardRateLimit(ctx, `dsr-write:${ctx.userId ?? ctx.ip}`, 10, 60_000);
  if (limited) return limited;

  const parsed = createSchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return deny(ctx, 400, "Data tiket tidak valid.", "DSR_INVALID_BODY");

  const duplicate = await prisma.dataSubjectRequest.findFirst({
    where: { patientId, type: parsed.data.type, status: { in: [...OPEN_STATUSES] } },
    select: { id: true }
  });
  if (duplicate) {
    return deny(ctx, 409, "Masih ada tiket sejenis yang diproses.", "DSR_DUPLICATE");
  }

  const now = new Date();
  let created;
  try {
    created = await prisma.dataSubjectRequest.create({
      data: {
        patientId,
        type: parsed.data.type,
        status: "PENDING",
        requestedBy: ctx.userId ?? patientId,
        requestedAt: now,
        dueAt: dsrDueAt(now),
        notes: parsed.data.notes ?? null,
        // Unique index menutup race dua POST konkuren; review awal hanya
        // memakai findFirst lalu create sehingga masih bisa duplikat.
        openKey: `${patientId}:${parsed.data.type}`
      }
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return deny(ctx, 409, "Masih ada tiket sejenis yang diproses.", "DSR_DUPLICATE");
    }
    throw error;
  }

  if (parsed.data.type === "DELETION") {
    await prisma.patient.update({
      where: { id: patientId },
      data: {
        deletionRequestedAt: now,
        deletionReason: parsed.data.notes ?? "Permintaan penghapusan/penganonimisasian."
      }
    });
  }

  await auditApiAccess({
    request: ctx.request,
    session: ctx.session,
    action: "DSR_SUBMITTED",
    targetPatientId: patientId,
    detail: `Tiket ${created.id} (${parsed.data.type}) diajukan; batas ${DSR_SLA_HOURS} jam.`,
    requestId: ctx.requestId
  });

  return ok(
    ctx,
    {
      id: created.id,
      type: created.type,
      status: created.status,
      requestedAt: created.requestedAt.toISOString(),
      dueAt: created.dueAt.toISOString(),
      slaHours: DSR_SLA_HOURS,
      requestId: ctx.requestId
    },
    201
  );
}
