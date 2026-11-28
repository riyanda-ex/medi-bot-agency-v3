import crypto from "node:crypto";
import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { isProxySessionValid } from "@/lib/sessionGuard";

function buildCsp(nonce: string, isDev: boolean): string {
  const script = [`'self'`, `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (isDev) script.push("'unsafe-eval'");
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"])
  ].join("; ");
}

function applySecurity(response: NextResponse, request: NextRequest, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=()"
  );
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  const httpsIntent =
    request.nextUrl.protocol === "https:" ||
    (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL)?.startsWith("https://") === true;
  if (httpsIntent) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
  }
  return response;
}

function sessionCookieName(request: NextRequest): string {
  if (request.cookies.get("__Secure-authjs.session-token")) return "__Secure-authjs.session-token";
  if (request.cookies.get("authjs.session-token")) return "authjs.session-token";
  return request.nextUrl.protocol === "https:"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}

function safeRequestId(request: NextRequest): string {
  const raw = request.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{1,64}$/.test(raw) ? raw : crypto.randomUUID();
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = crypto.randomBytes(16).toString("base64");
  const isDev = process.env.NODE_ENV !== "production";
  const csp = buildCsp(nonce, isDev);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const requestId = safeRequestId(request);
  requestHeaders.set("x-request-id", requestId);

  const { pathname } = request.nextUrl;
  const protectedPath = ["/dashboard", "/triage", "/reports", "/audit"].some((p) =>
    pathname.startsWith(p)
  );

  let response: NextResponse;
  if (protectedPath) {
    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
      cookieName: sessionCookieName(request)
    });
    if (!token || !(await isProxySessionValid(token))) {
      response = NextResponse.redirect(new URL("/login?error=sesi", request.url));
    } else {
      const role = String(token.role ?? "TIDAK_AKTIF");
      if (pathname.startsWith("/audit") && role !== "ADMIN") {
        response = NextResponse.redirect(new URL("/dashboard?error=akses", request.url));
      } else {
        response = NextResponse.next({ request: { headers: requestHeaders } });
      }
    }
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }
  response.headers.set("x-request-id", requestId);
  return applySecurity(response, request, csp);
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" }
      ]
    }
  ]
};
