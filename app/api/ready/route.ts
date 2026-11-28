import { NextResponse } from "next/server";
import { getRequestId, jsonWithRequestId } from "@/lib/requestContext";
import { logApiRequest } from "@/lib/apiLog";
import { prisma } from "@/lib/prisma";
import { isQueueEnabled } from "@/lib/queue";
import { isProductionRuntime } from "@/lib/env";
import { getRequestIp } from "@/lib/audit";

export const dynamic = "force-dynamic";

async function checkRedis(): Promise<{ ok: boolean; detail: string }> {
  if (!isQueueEnabled()) return { ok: true, detail: "skipped (QUEUE_MODE!=redis)" };
  const url = process.env.REDIS_URL;
  if (!url) return { ok: false, detail: "REDIS_URL missing" };
  const { default: RedisClient } = await import("ioredis");
  const client = new RedisClient(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
    lazyConnect: true,
    ...(process.env.REDIS_TLS === "true" ? { tls: {} } : {})
  });
  try {
    await client.connect();
    const pong = await client.ping();
    return { ok: pong === "PONG", detail: pong === "PONG" ? "pong" : "unexpected response" };
  } catch {
    return { ok: false, detail: "unreachable" };
  } finally {
    client.disconnect();
  }
}

function authorized(request: Request): boolean {
  const token = process.env.READY_TOKEN;
  if (!token) return !isProductionRuntime();
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-ready-token");
  return provided === token;
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  const guard = (status: number, error: string, detail: string) => {
    void logApiRequest({
      requestId,
      method: "GET",
      path: "/api/ready",
      statusCode: status,
      durationMs: Date.now() - startedAt,
      ip: getRequestIp(request),
      error
    });
    return jsonWithRequestId(
      requestId,
      { error: detail, requestId },
      { status, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  };

  // Endpoint infra tidak boleh terbuka publik di produksi.
  if (!authorized(request)) {
    return guard(403, "forbidden", "Akses readiness tidak diizinkan.");
  }

  const checks: Record<string, { ok: boolean; detail: string }> = {
    database: { ok: false, detail: "unknown" },
    redis: { ok: false, detail: "unknown" }
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true, detail: "connected" };
  } catch {
    checks.database = { ok: false, detail: "unreachable" };
  }

  checks.redis = await checkRedis();

  const ready = Object.values(checks).every((c) => c.ok);
  void logApiRequest({
    requestId,
    method: "GET",
    path: "/api/ready",
    statusCode: ready ? 200 : 503,
    durationMs: Date.now() - startedAt,
    ip: getRequestIp(request),
    error: ready ? null : "not_ready"
  });
  return jsonWithRequestId(
    requestId,
    {
      status: ready ? "ready" : "not_ready",
      timestamp: new Date().toISOString(),
      checks
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
