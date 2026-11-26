import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { executeUrgentFollowUp } from "@/agents/urgentCaller";

const bodySchema = z.object({
  patientId: z.string().min(1).optional(),
  visitId: z.string().min(1).optional(),
  triageLogId: z.string().min(1).optional()
});

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? "RESEPSIONIS";

  if (!hasPermission(role, "triage:write") && !hasPermission(role, "agent:run")) {
    return NextResponse.json({ error: "Akses ditolak." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
  }

  let patientId = parsed.data.patientId;
  if (!patientId && parsed.data.triageLogId) {
    const log = await prisma.triageLog.findUnique({ where: { id: parsed.data.triageLogId } });
    patientId = log?.patientId;
  }
  if (!patientId && parsed.data.visitId) {
    const visit = await prisma.visit.findUnique({ where: { id: parsed.data.visitId } });
    patientId = visit?.patientId;
  }
  if (!patientId) {
    const latest = await prisma.triageLog.findFirst({
      where: { level: "MERAH" },
      orderBy: { createdAt: "desc" }
    });
    patientId = latest?.patientId;
  }
  if (!patientId) {
    return NextResponse.json({ error: "Tidak ada pasien MERAH untuk disimulasikan." }, { status: 404 });
  }

  const stages = await executeUrgentFollowUp({
    patientId,
    visitId: parsed.data.visitId,
    triageLogId: parsed.data.triageLogId,
    actorId: session?.user.id,
    simulate: true
  });

  return NextResponse.json({ patientId, stages, totalLogs: stages.length });
}
