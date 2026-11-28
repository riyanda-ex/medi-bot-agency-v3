import { NextResponse } from "next/server";
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
import { decryptField, encryptField } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import {
  consumeRecoveryCode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCodes,
  otpAuthUri,
  recoveryCodesRemaining,
  verifyTotp
} from "@/lib/mfa";

const MFA_SETUP_TTL_MS = 10 * 60_000;

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("BEGIN") }),
  z.object({
    action: z.literal("ENABLE"),
    code: z.string().regex(/^\d{6}$/)
  }),
  z.object({
    action: z.literal("DISABLE"),
    code: z.string().trim().min(6).max(64)
  })
]);

/** MFA/TOTP mandiri: secret dan kode pemulihan dibuat/disimpan di server. */
export async function GET(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/me/mfa");
  if (!ctx.userId || ctx.sessionInvalid) return deny(ctx, 403, "Sesi tidak sah.", "MFA_DENIED");
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { mfaEnabled: true, mfaRecoveryHash: true }
  });
  if (!user) return deny(ctx, 404, "Akun tidak ditemukan.", "MFA_NOT_FOUND");
  return ok(ctx, {
    mfaEnabled: user.mfaEnabled,
    recoveryCodesRemaining: recoveryCodesRemaining(user.mfaRecoveryHash),
    requestId: ctx.requestId
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/me/mfa");
  if (!ctx.userId || ctx.sessionInvalid) return deny(ctx, 403, "Sesi tidak sah.", "MFA_DENIED");
  const originBlocked = guardOrigin(ctx);
  if (originBlocked) return originBlocked;
  const bodyBlocked = await guardBodySize(ctx);
  if (bodyBlocked) return bodyBlocked;
  const limited = await guardRateLimit(ctx, `mfa:${ctx.userId}`, 10, 60_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return deny(ctx, 400, "Data MFA tidak valid.", "MFA_INVALID_BODY");
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: {
      mfaEnabled: true,
      mfaSecret: true,
      mfaRecoveryHash: true,
      mfaPendingSecret: true,
      mfaPendingRecoveryHash: true,
      mfaPendingExpiresAt: true,
      email: true
    }
  });
  if (!user) return deny(ctx, 404, "Akun tidak ditemukan.", "MFA_NOT_FOUND");

  if (parsed.data.action === "BEGIN") {
    if (user.mfaEnabled) {
      return deny(ctx, 409, "Nonaktifkan MFA terlebih dahulu.", "MFA_ALREADY_ENABLED");
    }
    const secret = generateTotpSecret();
    const recoveryCodes = generateRecoveryCodes();
    const setupExpiresAt = new Date(Date.now() + MFA_SETUP_TTL_MS);
    await prisma.user.update({
      where: { id: ctx.userId },
      data: {
        mfaPendingSecret: encryptField(secret),
        mfaPendingRecoveryHash: hashRecoveryCodes(recoveryCodes),
        mfaPendingExpiresAt: setupExpiresAt
      }
    });
    await auditApiAccess({
      request: ctx.request,
      session: ctx.session,
      action: "MFA_SETUP_STARTED",
      detail: "Secret TOTP sementara dibuat dan disimpan server-side.",
      requestId: ctx.requestId
    });
    return ok(ctx, {
      secret,
      otpAuthUri: otpAuthUri(secret, "MediBot Clinical Operations", user.email),
      recoveryCodes,
      setupExpiresAt: setupExpiresAt.toISOString(),
      requestId: ctx.requestId
    });
  }

  if (parsed.data.action === "ENABLE") {
    if (user.mfaEnabled) {
      return deny(ctx, 409, "MFA sudah aktif.", "MFA_ALREADY_ENABLED");
    }
    const pendingSecret = user.mfaPendingSecret;
    const pendingRecoveryHash = user.mfaPendingRecoveryHash;
    if (
      !pendingSecret ||
      !pendingRecoveryHash ||
      !user.mfaPendingExpiresAt ||
      user.mfaPendingExpiresAt <= new Date()
    ) {
      await auditApiAccess({
        request: ctx.request,
        session: ctx.session,
        action: "MFA_ENABLE_FAILED",
        detail: "Pendaftaran MFA tidak ada atau kedaluwarsa.",
        requestId: ctx.requestId
      });
      return deny(ctx, 409, "Pendaftaran MFA kedaluwarsa. Mulai lagi.", "MFA_SETUP_EXPIRED");
    }

    let totpValid = false;
    try {
      totpValid = verifyTotp(decryptField(pendingSecret), parsed.data.code);
    } catch {
      totpValid = false;
    }
    if (!totpValid) {
      await auditApiAccess({
        request: ctx.request,
        session: ctx.session,
        action: "MFA_ENABLE_FAILED",
        detail: "Kode TOTP tidak cocok saat aktivasi.",
        requestId: ctx.requestId
      });
      return deny(ctx, 400, "Kode TOTP tidak cocok.", "MFA_INVALID_CODE");
    }

    // Klaim pendaftaran secara kondisional: dua permintaan konkuren tidak boleh
    // mengaktifkan secret yang sama atau memakai ulang setup yang sudah dipakai.
    const claimed = await prisma.user.updateMany({
      where: {
        id: ctx.userId,
        mfaEnabled: false,
        mfaPendingSecret: pendingSecret,
        mfaPendingExpiresAt: { gt: new Date() }
      },
      data: {
        mfaEnabled: true,
        mfaSecret: pendingSecret,
        mfaRecoveryHash: pendingRecoveryHash,
        mfaPendingSecret: null,
        mfaPendingRecoveryHash: null,
        mfaPendingExpiresAt: null,
        tokenVersion: { increment: 1 }
      }
    });
    if (claimed.count !== 1) {
      return deny(ctx, 409, "Pendaftaran MFA berubah. Mulai lagi.", "MFA_SETUP_CONFLICT");
    }
    await auditApiAccess({
      request: ctx.request,
      session: ctx.session,
      action: "MFA_ENABLED",
      detail: "TOTP diaktifkan; kode pemulihan dibuat server-side.",
      requestId: ctx.requestId
    });
    return ok(ctx, { mfaEnabled: true, requestId: ctx.requestId });
  }

  if (!user.mfaEnabled || !user.mfaSecret) {
    return deny(ctx, 400, "MFA belum aktif.", "MFA_NOT_ENABLED");
  }

  const disabledData = {
    mfaEnabled: false,
    mfaSecret: null,
    mfaRecoveryHash: null,
    mfaPendingSecret: null,
    mfaPendingRecoveryHash: null,
    mfaPendingExpiresAt: null,
    tokenVersion: { increment: 1 }
  };
  const baseWhere = { id: ctx.userId, mfaEnabled: true, mfaSecret: user.mfaSecret };
  let claimed = { count: 0 };
  let totpValid = false;
  try {
    totpValid = verifyTotp(decryptField(user.mfaSecret), parsed.data.code);
  } catch {
    totpValid = false;
  }
  if (totpValid) {
    claimed = await prisma.user.updateMany({ where: baseWhere, data: disabledData });
  } else {
    const recovery = consumeRecoveryCode(user.mfaRecoveryHash ?? null, parsed.data.code);
    if (recovery.ok) {
      claimed = await prisma.user.updateMany({
        where: { ...baseWhere, mfaRecoveryHash: user.mfaRecoveryHash },
        data: { ...disabledData, mfaRecoveryHash: recovery.remaining || null }
      });
    }
  }
  if (claimed.count !== 1) {
    return deny(ctx, 400, "Kode MFA tidak cocok atau sudah dipakai.", "MFA_INVALID_CODE");
  }

  await auditApiAccess({
    request: ctx.request,
    session: ctx.session,
    action: "MFA_DISABLED",
    detail: "TOTP dinonaktifkan; semua sesi lama dicabut.",
    requestId: ctx.requestId
  });
  return ok(ctx, { mfaEnabled: false, requestId: ctx.requestId });
}
