import { NextResponse } from "next/server";
import { z } from "zod";
import { auditApiAccess } from "@/lib/audit";
import { createApiContext, deny, guardRateLimit, ok, patientIdSchema } from "@/lib/apiRoute";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  patientId: patientIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional()
});

/** Detail audit tidak boleh membocorkan NIK, HP, atau email mentah. */
function redactDetail(detail: string): string {
  return detail
    .replace(/\b\d{16}\b/g, "[NIK]")
    .replace(/\b0\d{8,13}\b/g, "[HP]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]");
}

/** Lacak pembacaan audit PHI: ADMIN saja, hasil sudah diredaksi. */
export async function GET(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/audit/phi");
  if (!["ADMIN"].includes(ctx.role) || ctx.sessionInvalid) {
    return deny(ctx, 403, "Hanya ADMIN yang dapat membaca audit PHI.", "PHI_AUDIT_DENIED");
  }

  const limited = await guardRateLimit(ctx, `phi-audit:${ctx.userId ?? ctx.ip}`, 60, 60_000);
  if (limited) return limited;

  const raw = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return deny(ctx, 400, "Parameter tidak valid.", "PHI_AUDIT_INVALID_QUERY");
  }

  const fetched = await prisma.auditLog
    .findMany({
      where: {
        ...(parsed.data.patientId ? { targetPatientId: parsed.data.patientId } : {}),
        OR: [
          { action: { startsWith: "PHI_" } },
          { action: "RECORD_READ_FULL" },
          { action: "OWN_DATA_READ" },
          { action: "PATIENT_ANONYMIZED" },
          { action: "CONSENT_READ" },
          { action: "CONSENT_GRANTED" },
          { action: "CONSENT_REVOKED" },
          { action: { startsWith: "PATIENT_" } }
        ]
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: parsed.data.limit + 1,
      ...(parsed.data.cursor ? { skip: 1, cursor: { id: parsed.data.cursor } } : {}),
      select: {
        id: true,
        actorId: true,
        action: true,
        role: true,
        targetPatientId: true,
        ipAddress: true,
        method: true,
        path: true,
        detail: true,
        createdAt: true
      }
    })
    .catch(() => null);
  if (!fetched) {
    return deny(
      ctx,
      503,
      "Audit sementara tidak tersedia; hasil tidak ditampilkan.",
      "PHI_AUDIT_UNAVAILABLE"
    );
  }
  const nextCursor =
    fetched.length > parsed.data.limit ? (fetched[parsed.data.limit - 1]?.id ?? null) : null;
  const entries = fetched.slice(0, parsed.data.limit);

  await auditApiAccess({
    request,
    session: ctx.session,
    action: "PHI_AUDIT_READ",
    targetPatientId: parsed.data.patientId,
    detail: `${entries.length} entri audit PHI dibaca.`,
    requestId: ctx.requestId
  });

  return ok(ctx, {
    entries: entries.map((entry) => ({ ...entry, detail: redactDetail(entry.detail) })),
    limit: parsed.data.limit,
    nextCursor,
    requestId: ctx.requestId
  });
}
