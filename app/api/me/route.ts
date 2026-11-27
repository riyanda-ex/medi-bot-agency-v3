import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getRequestId, jsonWithRequestId } from "@/lib/requestContext";
import { logApiRequest } from "@/lib/apiLog";
import { getClientIp } from "@/lib/requestGuard";

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  const session = await getServerSession(authOptions);
  if (!session || session.user.invalid) {
    void logApiRequest({
      requestId,
      method: "GET",
      path: "/api/me",
      statusCode: 401,
      durationMs: Date.now() - startedAt,
      ip: getClientIp(request)
    });
    return jsonWithRequestId(requestId, { error: "Unauthorized", requestId }, { status: 401 });
  }
  void logApiRequest({
    requestId,
    method: "GET",
    path: "/api/me",
    statusCode: 200,
    durationMs: Date.now() - startedAt,
    ip: getClientIp(request),
    userId: session.user.id
  });
  return jsonWithRequestId(requestId, { user: session.user, requestId });
}
