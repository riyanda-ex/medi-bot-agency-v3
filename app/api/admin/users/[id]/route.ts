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
import { prisma } from "@/lib/prisma";
import { hasPermission, type Role } from "@/lib/rbac";

type RouteContext = { params: Promise<{ id: string }> };

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const bodySchema = z
  .object({
    status: z.enum(["AKTIF", "TIDAK_AKTIF"]).optional(),
    revokeSessions: z.boolean().optional()
  })
  .refine((value) => value.status !== undefined || value.revokeSessions === true, {
    message: "Minimal satu perubahan wajib diisi."
  });

/**
 * Kontrol admin: nonaktifkan akun/cabut sesi tanpa menghapus audit.
 * MFA tidak bisa diaktifkan admin karena secret harus dibuat pemilik akun.
 */
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const ctx = await createApiContext(request, "/api/admin/users/[id]");
  if (!hasPermission(ctx.role as Role, "user:manage") || ctx.sessionInvalid) {
    return deny(ctx, 403, "Hanya ADMIN yang dapat mengelola akun.", "USER_ADMIN_DENIED");
  }
  const originBlocked = guardOrigin(ctx);
  if (originBlocked) return originBlocked;
  const bodyBlocked = await guardBodySize(ctx);
  if (bodyBlocked) return bodyBlocked;
  const limited = await guardRateLimit(ctx, `user-admin:${ctx.userId ?? ctx.ip}`, 30, 60_000);
  if (limited) return limited;

  const { id } = await context.params;
  if (!idSchema.safeParse(id).success)
    return deny(ctx, 400, "ID akun tidak valid.", "USER_INVALID_ID");
  const parsed = bodySchema.safeParse(await ctx.request.json().catch(() => null));
  if (!parsed.success) return deny(ctx, 400, "Data perubahan tidak valid.", "USER_INVALID_BODY");

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true }
  });
  if (!target) return deny(ctx, 404, "Akun tidak ditemukan.", "USER_NOT_FOUND");
  if (id === ctx.userId && parsed.data.status === "TIDAK_AKTIF") {
    return deny(ctx, 400, "Admin tidak boleh menonaktifkan akunnya sendiri.", "USER_SELF_LOCKOUT");
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.revokeSessions ? { tokenVersion: { increment: 1 } } : {})
    },
    select: { id: true, status: true, tokenVersion: true, mfaEnabled: true }
  });

  await auditApiAccess({
    request: ctx.request,
    session: ctx.session,
    action: "USER_ADMIN_UPDATED",
    detail: `Akun ${id}: status=${updated.status}, tokenVersion=${updated.tokenVersion}.`,
    requestId: ctx.requestId
  });
  return ok(ctx, { ...updated, requestId: ctx.requestId });
}
