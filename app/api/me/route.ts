import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { deny, guardRateLimit, ok, withApi } from "@/lib/apiRoute";

/** Data diri pasien: hanya pasien yang bersangkutan yang bisa mengakses. */
export async function GET(request: Request): Promise<NextResponse> {
  const gate = await withApi(request, { path: "/api/me", skipOrigin: true });
  if (gate.response) return gate.response;
  const { ctx } = gate;
  const patientId = ctx.session?.user.patientId;

  if (!hasPermission(ctx.role, "own:read") || !patientId || ctx.sessionInvalid) {
    return deny(
      ctx,
      403,
      "Akses ditolak.",
      "OWN_DATA_DENIED",
      `Peran ${ctx.role} mencoba mengakses data diri.`
    );
  }

  const limited = await guardRateLimit(ctx, `me:${ctx.userId ?? ctx.ip}`, 60, 60_000);
  if (limited) return limited;

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      id: true,
      name: true,
      nikMasked: true,
      birthDate: true,
      address: true,
      appointments: {
        select: { id: true, scheduledAt: true, status: true, queueNumber: true },
        orderBy: { scheduledAt: "desc" },
        take: 20
      }
    }
  });

  if (!patient) {
    return deny(ctx, 404, "Data pasien tidak ditemukan.", "OWN_DATA_NOT_FOUND");
  }

  await auditApiAccess({
    request: ctx.request,
    session: ctx.session,
    action: "OWN_DATA_READ",
    targetPatientId: patientId,
    detail: "Data diri dan appointment dikembalikan dengan NIK termasker.",
    requestId: ctx.requestId
  });
  return ok(ctx, { patient, requestId: ctx.requestId });
}
