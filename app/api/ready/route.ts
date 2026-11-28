import { NextResponse } from "next/server";
import { getRequestId, jsonWithRequestId } from "@/lib/requestContext";
import { logApiRequest } from "@/lib/apiLog";
import { prisma } from "@/lib/prisma";
import { isQueueEnabled } from "@/lib/queue";
import { getClientIp } from "@/lib/requestGuard";
import Redis from "ioredis";

export const dynamic = "force-dynamic";

async function checkRedis(): Promise<{ ok: boolean; detail: string }> {
  if (!isQueueEnabled()) return { ok: true, detail: "skipped (QUEUE_MODE!=redis)" };
  const url = process.env.REDIS_URL;
  if (!url) return { ok: false, detail: "REDIS_URL missing" };
  const client = new Redis(url, {
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

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
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
  const status = ready ? 200 : 503;
  void logApiRequest({
    requestId,
    method: "GET",
    path: "/api/ready",
    statusCode: status,
    durationMs: Date.now() - startedAt,
    ip: getClientIp(request),
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
