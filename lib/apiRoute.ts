import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { auth } from "@/auth";
import { hasPermission, type Role } from "@/lib/rbac";
import { assertSecureEnvironment } from "@/lib/env";
import { auditApiAccess } from "@/lib/audit";
import {
  enforceBodySize,
  enforceRateLimit,
  enforceSameOrigin,
  getClientIp
} from "@/lib/requestGuard";
import { getRequestId, jsonWithRequestId, withRequestId } from "@/lib/requestContext";
import { logApiRequest } from "@/lib/apiLog";

/**
 * ID dari parameter/body harus terlihat seperti cuid di produksi. Di dev/CI,
 * ID pendek ("p1", "t1") tetap diterima agar suite uji lama berjalan.
 */
const resourceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "ID mengandung karakter tidak diizinkan")
  .refine(
    (value) => process.env.NODE_ENV !== "production" || /^[a-z][a-z0-9]{19,29}$/i.test(value),
    "Format ID tidak valid"
  );

export const patientIdSchema = resourceIdSchema;
export const reportIdSchema = resourceIdSchema;
export const triageLogIdSchema = resourceIdSchema;
export const visitIdSchema = resourceIdSchema;
export const approvalIdSchema = resourceIdSchema;

export interface ApiContext {
  request: Request;
  requestId: string;
  startedAt: number;
  ip: string;
  path: string;
  session: Session | null;
  role: Role | "TIDAK_AKTIF";
  userId?: string;
  sessionInvalid?: boolean;
}

export async function createApiContext(request: Request, path: string): Promise<ApiContext> {
  // Fail-closed: produksi tanpa konfigurasi aman tidak boleh membuka endpoint API.
  if (process.env.NODE_ENV === "production") assertSecureEnvironment();
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  const ip = getClientIp(request);
  const session = (await auth()) as Session | null;
  const role = (session?.user.role ?? "TIDAK_AKTIF") as Role | "TIDAK_AKTIF";
  const userId = session?.user?.id;
  const sessionInvalid = session?.user?.invalid === true;
  return { request, requestId, startedAt, ip, path, session, role, userId, sessionInvalid };
}

export async function deny(
  ctx: ApiContext,
  status: number,
  error: string,
  action: string,
  detail?: string,
  extra?: Record<string, unknown>
): Promise<NextResponse> {
  await auditApiAccess({
    request: ctx.request,
    session: ctx.session,
    action,
    detail,
    requestId: ctx.requestId
  });
  void logApiRequest({
    requestId: ctx.requestId,
    method: ctx.request.method,
    path: ctx.path,
    statusCode: status,
    durationMs: Date.now() - ctx.startedAt,
    ip: ctx.ip,
    userId: ctx.userId,
    error
  });
  return jsonWithRequestId(
    ctx.requestId,
    { error, requestId: ctx.requestId, ...extra },
    { status }
  );
}

export async function ok(ctx: ApiContext, body: unknown, status = 200): Promise<NextResponse> {
  void logApiRequest({
    requestId: ctx.requestId,
    method: ctx.request.method,
    path: ctx.path,
    statusCode: status,
    durationMs: Date.now() - ctx.startedAt,
    ip: ctx.ip,
    userId: ctx.userId
  });
  return jsonWithRequestId(ctx.requestId, body, { status });
}

export function guardOrigin(ctx: ApiContext): NextResponse | null {
  const blocked = enforceSameOrigin(ctx.request);
  if (!blocked) return null;
  void logApiRequest({
    requestId: ctx.requestId,
    method: ctx.request.method,
    path: ctx.path,
    statusCode: 403,
    durationMs: Date.now() - ctx.startedAt,
    ip: ctx.ip,
    error: "origin"
  });
  return withRequestId(blocked, ctx.requestId);
}

export async function guardBodySize(
  ctx: ApiContext,
  maxBytes?: number
): Promise<NextResponse | null> {
  const guarded = await enforceBodySize(ctx.request, maxBytes);
  if (guarded.response) {
    void logApiRequest({
      requestId: ctx.requestId,
      method: ctx.request.method,
      path: ctx.path,
      statusCode: 413,
      durationMs: Date.now() - ctx.startedAt,
      ip: ctx.ip,
      userId: ctx.userId,
      error: "body_too_large"
    });
    return withRequestId(guarded.response, ctx.requestId);
  }
  ctx.request = guarded.request;
  return null;
}

export async function guardRateLimit(
  ctx: ApiContext,
  key: string,
  limit: number,
  windowMs: number
): Promise<NextResponse | null> {
  const limited = await enforceRateLimit(key, limit, windowMs);
  if (!limited) return null;
  void logApiRequest({
    requestId: ctx.requestId,
    method: ctx.request.method,
    path: ctx.path,
    statusCode: 429,
    durationMs: Date.now() - ctx.startedAt,
    ip: ctx.ip,
    userId: ctx.userId,
    error: "rate_limited"
  });
  return withRequestId(limited, ctx.requestId);
}

export function requirePermission(
  ctx: ApiContext,
  permission: Parameters<typeof hasPermission>[1]
): boolean {
  return hasPermission(ctx.role as Role, permission) && !ctx.sessionInvalid;
}
