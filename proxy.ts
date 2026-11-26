import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const { pathname } = request.nextUrl;

  if (!token || token.invalid === true) {
    return NextResponse.redirect(new URL("/login?error=sesi", request.url));
  }

  const role = String(token.role ?? "TIDAK_AKTIF");
  if (pathname.startsWith("/audit") && role !== "ADMIN") {
    return NextResponse.redirect(new URL("/dashboard?error=akses", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/triage/:path*", "/reports/:path*", "/audit/:path*"]
};
