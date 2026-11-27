import { NextResponse } from "next/server";
import { getRequestId, withRequestId } from "@/lib/requestContext";
import { logger } from "@/lib/logger";
import { logApiRequest } from "@/lib/apiLog";
import { getClientIp } from "@/lib/requestGuard";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  const res = NextResponse.json(
    {
      status: "ok",
      service: "medibot-clinical-ops",
      requestId,
      timestamp: new Date().toISOString()
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
  logger.info("health.ok", { requestId });
  void logApiRequest({
    requestId,
    method: "GET",
    path: "/api/health",
    statusCode: 200,
    durationMs: Date.now() - startedAt,
    ip: getClientIp(request)
  });
  return withRequestId(res, requestId);
}
