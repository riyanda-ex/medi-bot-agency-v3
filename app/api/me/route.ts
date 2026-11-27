import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getRequestId, jsonWithRequestId } from "@/lib/requestContext";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, getClientIp } from "@/lib/requestGuard";

/** Data diri pasien: hanya pasien yang bersangkutan yang bisa mengakses. */
export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  void startedAt;
  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? "TIDAK_AKTIF";
  const patientId = session?.user.patientId;

  if (!hasPermission(role, "own:read") || !patientId || session?.user.invalid) {
    await auditApiAccess({
      request,
      session,
      action: "OWN_DATA_DENIED",
      detail: `Peran ${role} mencoba mengakses data diri.`
    });
    return jsonWithRequestId(requestId, { error: "Akses ditolak." }, { status: 403 });
  }

  const limited = await enforceRateLimit(
    `me:${session?.user.id ?? getClientIp(request)}`,
    60,
    60_000
  );
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
    return jsonWithRequestId(requestId, { error: "Data pasien tidak ditemukan." }, { status: 404 });
  }

  await auditApiAccess({
    request,
    session,
    action: "OWN_DATA_READ",
    targetPatientId: patientId,
    detail: "Data diri dan appointment dikembalikan dengan NIK termasker."
  });

  return jsonWithRequestId(requestId, { patient });
}
