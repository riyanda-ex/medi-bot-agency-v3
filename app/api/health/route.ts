import { NextResponse } from "next/server";
import { getRequestId, withRequestId } from "@/lib/requestContext";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
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
  return withRequestId(res, requestId);
}
