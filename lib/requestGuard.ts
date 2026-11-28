import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { getRequestIp } from "@/lib/audit";

export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SESSION_COOKIE_PATTERN =
  /(?:^|;\s*)(?:__Secure-)?(?:authjs|next-auth)\.session-token(?:\.\d+)?=/i;

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

/** Permintaan membawa cookie sesi NextAuth (artinya browser bisa kena CSRF). */
export function isCookieAuthenticated(request: Request): boolean {
  return SESSION_COOKIE_PATTERN.test(request.headers.get("cookie") ?? "");
}

export function hasCsrfHeader(request: Request): boolean {
  for (const name of ["x-csrf-token", "x-xsrf-token"]) {
    const value = request.headers.get(name)?.trim() ?? "";
    if (value.length > 0 && value.length <= 256) return true;
  }
  return false;
}

/**
 * Same-origin untuk request dengan Origin. Request tanpa Origin hanya aman
 * bila bukan klien cookie-authenticated; klien cookie wajib menyertakan Origin
 * atau header CSRF untuk method yang mengubah data.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
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

  const mutating = MUTATING_METHODS.has(request.method.toUpperCase());
  if (mutating && isCookieAuthenticated(request)) return hasCsrfHeader(request);
  return true;
}

export function enforceSameOrigin(request: Request): NextResponse | null {
  if (isSameOrigin(request)) return null;
  return NextResponse.json({ error: "Origin tidak diizinkan." }, { status: 403 });
}

function bodyTooLarge(): NextResponse {
  return NextResponse.json(
    { error: "Payload terlalu besar." },
    { status: 413, headers: { "Cache-Control": "no-store" } }
  );
}

export interface BodySizeGuardResult {
  response: NextResponse | null;
  /** Request yang body-nya sudah dibuffer; pakai ini untuk request.json(). */
  request: Request;
}

/**
 * Batasi ukuran body dan kembalikan request baru yang sudah dibuffer.
 * Node/undici tidak bisa membaca `request.clone()` tanpa mengonsumsi cabang
 * asalnya, jadi body asli dibaca sekali lalu dibungkus lagi.
 */
export async function enforceBodySize(
  request: Request,
  maxBytes = DEFAULT_MAX_BODY_BYTES
): Promise<BodySizeGuardResult> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { response: bodyTooLarge(), request };
  }
  if (!request.body || !MUTATING_METHODS.has(request.method.toUpperCase())) {
    return { response: null, request };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.byteLength ?? 0;
      if (total > maxBytes) {
        await reader.cancel();
        return { response: bodyTooLarge(), request };
      }
      chunks.push(value as Uint8Array);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { response: bodyTooLarge(), request };
  }

  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return {
    response: null,
    request: new Request(request.url, { method: request.method, headers, body })
  };
}
