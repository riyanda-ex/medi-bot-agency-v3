import { NextResponse } from "next/server";
import { z } from "zod";
import { createApiContext, guardBodySize, guardOrigin, guardRateLimit, ok } from "@/lib/apiRoute";
import { auditApiAccess } from "@/lib/audit";
import { sendTransactionalEmail } from "@/lib/mailer";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiresAt,
  RESET_TOKEN_TTL_HOURS
} from "@/lib/passwordReset";

const bodySchema = z.object({ email: z.string().email().max(200) });

/** Selalu 200 agar tidak membocorkan keberadaan akun (anti user enumeration). */
export async function POST(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/auth/forgot-password");
  const originBlocked = guardOrigin(ctx);
  if (originBlocked) return originBlocked;
  const bodyBlocked = await guardBodySize(ctx);
  if (bodyBlocked) return bodyBlocked;
  const limited = await guardRateLimit(ctx, `forgot:${ctx.ip}`, 5, 15 * 60_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return ok(ctx, { status: "accepted", requestId: ctx.requestId });

  const email = parsed.data.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, status: true }
  });

  if (user && user.status === "AKTIF") {
    const token = generateResetToken();
    const now = new Date();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(token),
        expiresAt: resetTokenExpiresAt(now)
      }
    });
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const link = `${baseUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
    const mail = await sendTransactionalEmail({
      to: user.email,
      subject: "Tautan atur ulang kata sandi MediBot",
      text:
        `Gunakan tautan berikut dalam ${RESET_TOKEN_TTL_HOURS} jam: ${link}\n\n` +
        "Bila Anda tidak meminta ini, abaikan email ini."
    });
    if (!mail.sent && process.env.NODE_ENV !== "production") {
      // Jangan pernah menuliskan tautan bertoken ke log. SMTP wajib dikonfigurasi
      // agar tautan sampai ke pemilik akun, termasuk di staging.
      logger.warn("password_reset.dev_link_withheld", {
        tokenId: hashResetToken(token).slice(0, 12),
        detail: mail.detail
      });
    }
  } else {
    // Samakan kerja CPU agar respons tidak membedakan akun yang ada.
    hashResetToken(generateResetToken());
  }

  await auditApiAccess({
    request: ctx.request,
    session: ctx.session,
    action: "PASSWORD_RESET_REQUESTED",
    detail: "Permintaan tautan reset diterima; keberadaan akun tidak diungkapkan.",
    requestId: ctx.requestId
  });
  return ok(ctx, { status: "accepted", requestId: ctx.requestId });
}
