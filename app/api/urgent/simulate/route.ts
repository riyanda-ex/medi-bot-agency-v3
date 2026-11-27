import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canApproveOutbound } from "@/lib/rbac";
import { createApiContext, deny, guardOrigin, guardRateLimit, ok } from "@/lib/apiRoute";
import { auditApiAccess } from "@/lib/audit";

const bodySchema = z.object({ patientId: z.string().min(1), response: z.enum(["YES", "NO"]) });

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/urgent/simulate");
  const originBlocked = guardOrigin(ctx);
  if (originBlocked) return originBlocked;
  if (!canApproveOutbound(ctx.role) || ctx.sessionInvalid) {
    return deny(
      ctx,
      403,
      "Akses ditolak: simulasi respons hanya untuk DOKTER/ADMIN.",
      "URGENT_SIMULATE_DENIED",
      `Peran ${ctx.role} mencoba simulasi respons.`
    );
  }
  const limited = await guardRateLimit(ctx, `urgent-simulate:${ctx.userId ?? ctx.ip}`, 30, 60_000);
  if (limited) return limited;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return deny(ctx, 400, "Data tidak valid.", "URGENT_SIMULATE_INVALID");
  const patient = await prisma.patient.findUnique({
    where: { id: parsed.data.patientId },
    select: { id: true }
  });
  if (!patient) return deny(ctx, 404, "Pasien tidak ditemukan.", "URGENT_SIMULATE_NOT_FOUND");
  await prisma.urgentCall.create({
    data: {
      patientId: parsed.data.patientId,
      channel: "WHATSAPP",
      attempt: 99,
      status: "SIMULATED",
      provider: "mock",
      simulated: true,
      message: `Simulasi respons pasien: ${parsed.data.response}`,
      triggeredBy: ctx.userId ?? "SYSTEM"
    }
  });
  const result = { ok: true, response: parsed.data.response };
  await auditApiAccess({
    request: ctx.request,
    session: ctx.session,
    action: "URGENT_SIMULATE_RESPONSE",
    targetPatientId: parsed.data.patientId,
    detail: `Respons simulasi: ${parsed.data.response}`,
    requestId: ctx.requestId
  });
  return ok(ctx, { ...result, requestId: ctx.requestId });
}
