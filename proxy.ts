import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-DNS-Prefetch-Control": "off"
};

function withSecurityHeaders(response: NextResponse, request: NextRequest): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(key, value);
  if (request.nextUrl.protocol === "https:") {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const { pathname } = request.nextUrl;

  if (!token || token.invalid === true) {
    return withSecurityHeaders(NextResponse.redirect(new URL("/login?error=sesi", request.url)), request);
  }

  const role = String(token.role ?? "TIDAK_AKTIF");
  if (pathname.startsWith("/audit") && role !== "ADMIN") {
    return withSecurityHeaders(NextResponse.redirect(new URL("/dashboard?error=akses", request.url)), request);
  }

  return withSecurityHeaders(NextResponse.next(), request);
}

export const config = {
  matcher: ["/dashboard/:path*", "/triage/:path*", "/reports/:path*", "/audit/:path*"]
};