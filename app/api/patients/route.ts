import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, getClientIp } from "@/lib/requestGuard";

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? "TIDAK_AKTIF";

  if (
    (!hasPermission(role, "patient:read") && !hasPermission(role, "triage:write")) ||
    session?.user.invalid
  ) {
    await auditApiAccess({
      request,
      session,
      action: "PATIENTS_LIST_DENIED",
      detail: `Peran ${role} mencoba membaca daftar pasien.`
    });
    return NextResponse.json({ error: "Akses ditolak." }, { status: 403 });
  }

  const limited = await enforceRateLimit(
    `patients:${session?.user.id ?? getClientIp(request)}`,
    120,
    60_000
  );
  if (limited) return limited;

  const patients = await prisma.patient.findMany({
    select: { id: true, name: true, nikMasked: true },
    orderBy: { name: "asc" },
    take: 100
  });

  await auditApiAccess({
    request,
    session,
    action: "PATIENTS_LIST",
    detail: `${patients.length} pasien dikembalikan dengan NIK termasker.`
  });

  return NextResponse.json({ patients });
}
