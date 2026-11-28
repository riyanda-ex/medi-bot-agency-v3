import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasPermission, type Role } from "@/lib/rbac";
import { auditApiAccess } from "@/lib/audit";
import { enforceRateLimit, enforceSameOrigin, getClientIp } from "@/lib/requestGuard";
import { getRequestId, jsonWithRequestId, withRequestId } from "@/lib/requestContext";
import { logApiRequest } from "@/lib/apiLog";

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
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  const ip = getClientIp(request);
  const session = (await getServerSession(authOptions)) as Session | null;
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

export interface WithApiOptions {
  path: string;
  permission?: Parameters<typeof hasPermission>[1];
  rateLimitKey?: string;
  limit?: number;
  windowMs?: number;
  denyError?: string;
  denyAction?: string;
  denyDetail?: string;
  skipOrigin?: boolean;
}

export type WithApiResult =
  { response: NextResponse; ctx: ApiContext } | { response: null; ctx: ApiContext };

export async function withApi(request: Request, options: WithApiOptions): Promise<WithApiResult> {
  const ctx = await createApiContext(request, options.path);
  if (!options.skipOrigin) {
    const originBlocked = guardOrigin(ctx);
    if (originBlocked) return { response: originBlocked, ctx };
  }

  if (options.permission && !requirePermission(ctx, options.permission)) {
    return {
      response: await deny(
        ctx,
        403,
        options.denyError ?? "Akses ditolak.",
        options.denyAction ?? "ACCESS_DENIED",
        options.denyDetail ?? `Peran ${ctx.role} tidak memiliki izin ${String(options.permission)}.`
      ),
      ctx
    };
  }

  if (options.rateLimitKey && options.limit !== undefined && options.windowMs !== undefined) {
    const limited = await guardRateLimit(
      ctx,
      options.rateLimitKey,
      options.limit,
      options.windowMs
    );
    if (limited) return { response: limited, ctx };
  }

  return { response: null, ctx };
}
