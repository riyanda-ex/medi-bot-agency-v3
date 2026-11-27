import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, getClientIp } from "@/lib/requestGuard";
import { getRequestId, jsonWithRequestId, withRequestId } from "@/lib/requestContext";
import { logApiRequest } from "@/lib/apiLog";

/** Data diri pasien: hanya pasien yang bersangkutan yang bisa mengakses. */
export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? "TIDAK_AKTIF";
  const patientId = session?.user.patientId;
  const ip = getClientIp(request);
  const log = (statusCode: number, error?: string) =>
    void logApiRequest({ requestId, method: "GET", path: "/api/me", statusCode, durationMs: Date.now() - startedAt, ip, userId: session?.user.id, error });

  if (!hasPermission(role, "own:read") || !patientId || session?.user.invalid) {
    await auditApiAccess({ request, session, action: "OWN_DATA_DENIED", detail: `Peran ${role} mencoba mengakses data diri.`, requestId });
    log(403, "forbidden");
    return jsonWithRequestId(requestId, { error: "Akses ditolak.", requestId }, { status: 403 });
  }

  const limited = await enforceRateLimit(`me:${session?.user.id ?? ip}`, 60, 60_000);
  if (limited) { log(429, "rate_limited"); return withRequestId(limited, requestId); }

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      id: true, name: true, nikMasked: true, birthDate: true, address: true,
      appointments: { select: { id: true, scheduledAt: true, status: true, queueNumber: true }, orderBy: { scheduledAt: "desc" }, take: 20 }
    }
  });

  if (!patient) {
    log(404, "not_found");
    return jsonWithRequestId(requestId, { error: "Data pasien tidak ditemukan.", requestId }, { status: 404 });
  }

  await auditApiAccess({ request, session, action: "OWN_DATA_READ", targetPatientId: patientId, detail: "Data diri dan appointment dikembalikan dengan NIK termasker.", requestId });
  log(200);
  return jsonWithRequestId(requestId, { patient, requestId });
}
