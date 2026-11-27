import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { getRequestIp } from "@/lib/audit";

export function getClientIp(request: Request): string {
  return getRequestIp(request);
}

export async function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<NextResponse | null> {
  const result = await checkRateLimit(key, limit, windowMs);
  if (result.allowed) return null;
  return rateLimitResponse(result) as NextResponse;
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // Non-browser / same-origin server calls may omit Origin
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    if (originUrl.host === requestUrl.host) return true;
    const configured = process.env.NEXTAUTH_URL;
    if (configured) {
      const allowed = new URL(configured);
      return originUrl.host === allowed.host;
    }
    return false;
  } catch {
    return false;
  }
}

export function enforceSameOrigin(request: Request): NextResponse | null {
  if (isSameOrigin(request)) return null;
  return NextResponse.json({ error: "Origin tidak diizinkan." }, { status: 403 });
}
