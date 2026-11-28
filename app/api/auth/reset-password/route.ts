import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
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
import { hashResetToken } from "@/lib/passwordReset";

const bodySchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: z.string().min(12).max(200)
});

/** Tukar token sekali pakai dengan kata sandi baru; semua sesi lama dicabut. */
export async function POST(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/auth/reset-password");
  const originBlocked = guardOrigin(ctx);
  if (originBlocked) return originBlocked;
  const bodyBlocked = await guardBodySize(ctx);
  if (bodyBlocked) return bodyBlocked;
  const limited = await guardRateLimit(ctx, `reset:${ctx.ip}`, 10, 15 * 60_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) {
    return deny(
      ctx,
      400,
      "Token atau kata sandi tidak valid (minimal 12 karakter).",
      "RESET_INVALID_BODY"
    );
  }

  const tokenHash = hashResetToken(parsed.data.token);
  const now = new Date();
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  // Klaim token dengan UPDATE kondisional: dua permintaan konkuren tidak bisa
  // memakai token yang sama, dan token lain milik user ikut dicabut.
  const claimedUserId = await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now }
    });
    if (claimed.count !== 1) return null;

    const record = await tx.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record) return null;
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, tokenVersion: { increment: 1 } }
    });
    await tx.passwordResetToken.updateMany({
      where: { userId: record.userId, tokenHash: { not: tokenHash }, usedAt: null },
      data: { usedAt: now }
    });
    return record.userId;
  });

  if (!claimedUserId) {
    await auditApiAccess({
      request: ctx.request,
      session: ctx.session,
      action: "PASSWORD_RESET_FAILED",
      detail: "Token tidak ditemukan, sudah dipakai, atau kedaluwarsa.",
      requestId: ctx.requestId
    });
    return deny(ctx, 400, "Tautan reset tidak sah atau kedaluwarsa.", "RESET_INVALID_TOKEN");
  }

  await auditApiAccess({
    request: ctx.request,
    session: ctx.session,
    action: "PASSWORD_RESET_COMPLETED",
    detail: `Kata sandi diatur ulang untuk akun ${claimedUserId}; sesi lama dicabut.`,
    requestId: ctx.requestId
  });
  return ok(ctx, { status: "ok", requestId: ctx.requestId });
}
