import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? "RESEPSIONIS";

  if (!hasPermission(role, "patient:read") && !hasPermission(role, "triage:write")) {
    return NextResponse.json({ error: "Akses ditolak." }, { status: 403 });
  }

  const patients = await prisma.patient.findMany({
    select: { id: true, name: true, nikMasked: true },
    orderBy: { name: "asc" },
    take: 100
  });

  return NextResponse.json({ patients });
}
