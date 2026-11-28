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
import { DSR_SLA_HOURS, type DataSubjectRequestStatus } from "@/lib/privacy";

type RouteContext = { params: Promise<{ id: string }> };

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const updateSchema = z.object({
  status: z.enum(["IN_PROGRESS", "APPROVED", "COMPLETED", "REJECTED"]),
  notes: z.string().trim().min(5).max(500).optional()
});

const TERMINAL: readonly DataSubjectRequestStatus[] = ["COMPLETED", "REJECTED"];

/** ADMIN memverifikasi dan menutup tiket hak subjek data. */
export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/privacy-requests/[id]");
  if (ctx.role !== "ADMIN" || ctx.sessionInvalid) {
    return deny(ctx, 403, "Hanya ADMIN yang dapat memeriksa tiket.", "DSR_ADMIN_DENIED");
  }
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success)
    return deny(ctx, 400, "ID tiket tidak valid.", "DSR_INVALID_ID");

  const ticket = await prisma.dataSubjectRequest.findUnique({ where: { id } });
  if (!ticket) return deny(ctx, 404, "Tiket tidak ditemukan.", "DSR_NOT_FOUND");
  return ok(ctx, { ...ticket, slaHours: DSR_SLA_HOURS, requestId: ctx.requestId });
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/privacy-requests/[id]");
  if (ctx.role !== "ADMIN" || ctx.sessionInvalid) {
    return deny(ctx, 403, "Hanya ADMIN yang dapat memverifikasi tiket.", "DSR_ADMIN_DENIED");
  }
  const originBlocked = guardOrigin(ctx);
  if (originBlocked) return originBlocked;
  const bodyBlocked = await guardBodySize(ctx);
  if (bodyBlocked) return bodyBlocked;
  const limited = await guardRateLimit(ctx, `dsr-admin:${ctx.userId ?? ctx.ip}`, 60, 60_000);
  if (limited) return limited;

  const { id } = await context.params;
  if (!idSchema.safeParse(id).success)
    return deny(ctx, 400, "ID tiket tidak valid.", "DSR_INVALID_ID");
  const parsed = updateSchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return deny(ctx, 400, "Data tidak valid.", "DSR_INVALID_BODY");

  const existing = await prisma.dataSubjectRequest.findUnique({ where: { id } });
  if (!existing) return deny(ctx, 404, "Tiket tidak ditemukan.", "DSR_NOT_FOUND");
  if (TERMINAL.includes(existing.status as DataSubjectRequestStatus)) {
    return deny(ctx, 409, "Tiket sudah ditutup.", "DSR_ALREADY_CLOSED");
  }

  const terminal = TERMINAL.includes(parsed.data.status);
  if (parsed.data.status === "COMPLETED" && existing.type === "DELETION") {
    const patient = await prisma.patient.findUnique({
      where: { id: existing.patientId },
      select: { anonymizedAt: true }
    });
    if (!patient?.anonymizedAt) {
      return deny(
        ctx,
        409,
        "Tiket penghapusan hanya dapat ditutup setelah anonimisasi terverifikasi.",
        "DSR_DELETION_EVIDENCE_MISSING"
      );
    }
  }

  const updated = await prisma.dataSubjectRequest.update({
    where: { id },
    data: {
      status: parsed.data.status,
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
      ...(terminal ? { completedAt: new Date(), openKey: null } : {})
    }
  });

  await auditApiAccess({
    request: ctx.request,
    session: ctx.session,
    action: "DSR_STATUS_UPDATED",
    targetPatientId: updated.patientId,
    detail: `Tiket ${id} menjadi ${updated.status}; batas awal ${updated.dueAt.toISOString()}.`,
    requestId: ctx.requestId
  });

  return ok(ctx, { ...updated, requestId: ctx.requestId });
}
