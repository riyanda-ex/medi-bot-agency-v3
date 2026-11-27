/**
 * Pembantu audit untuk endpoint API.
 * Setiap akses (termasuk yang ditolak) tercatat: aktor, peran, waktu, target,
 * metod, path, IP, dan user agent. Kegagalan audit tidak menggagalkan respons.
 */

import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { auditAccess } from "@/agents/securityGuard";
import { normalizeRole, type Role } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export interface ApiAuditSession {
  user?: {
    id?: string;
    role?: unknown;
  };
}

export interface ApiAuditInput {
  request: Request;
  session: ApiAuditSession | null | undefined;
  action: string;
  targetPatientId?: string;
  detail?: string;
}

function trustedProxies(): string[] {
  return (process.env.TRUST_PROXY ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

type HeaderBag = Headers | Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderBag, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  const raw = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null);
}

function cleanIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.split(",")[0]?.trim() ?? "";
  if (!candidate || candidate.length > 45) return null;
  return isIP(candidate) ? candidate : null;
}

/**
 * Header forwarding hanya dipercaya bila TRUST_PROXY dikonfigurasi.
 * Tanpa TRUST_PROXY, header klien diabaikan untuk mencegah spoofing IP audit/rate-limit.
 * Saat memakai reverse proxy, set TRUST_PROXY ke IP proxy tepercaya (atau '*'
 * hanya jika jaringan benar-benar menjamin semua request lewat proxy tepercaya).
 */
export function getRequestIp(source: Request | HeaderBag): string {
  const headers = source instanceof Request ? source.headers : source;
  const proxies = trustedProxies();
  if (proxies.length === 0) return "unknown";

  const forwarded = cleanIp(headerValue(headers, "x-forwarded-for"));
  const realIp = cleanIp(headerValue(headers, "x-real-ip"));
  return forwarded ?? realIp ?? "unknown";
}

export async function ensureSystemActor(): Promise<string> {
  const email = "system@medi-bot.local";
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "Sistem Audit",
      role: "TIDAK_AKTIF",
      passwordHash: randomBytes(32).toString("hex")
    },
    select: { id: true }
  });
  return user.id;
}

export async function auditApiAccess(input: ApiAuditInput): Promise<void> {
  try {
    const actorId = input.session?.user?.id || (await ensureSystemActor());
    const anonymous = !input.session?.user?.id;
    const url = new URL(input.request.url);
    const userAgent = (input.request.headers.get("user-agent") ?? "").slice(0, 300);
    const role: Role | "ANONYMOUS" = anonymous
      ? "ANONYMOUS"
      : normalizeRole(input.session?.user?.role);

    await auditAccess({
      actorId,
      role,
      action: input.action,
      ip: getRequestIp(input.request),
      targetPatientId: input.targetPatientId,
      method: input.request.method,
      path: url.pathname,
      userAgent,
      detail: anonymous ? `AKSES_TANPA_SESI | ${input.detail ?? ""}` : input.detail
    });
  } catch (error) {
    console.error("[AUDIT] Gagal mencatat akses API:", (error as Error).message);
  }
}

/** Catat kegagalan login tanpa pernah menulis kata sandi. */
export async function recordAuthFailure(input: {
  email: string;
  ip: string;
  reason: "RATE_LIMITED" | "INVALID_CREDENTIALS" | "ACCOUNT_INACTIVE";
}): Promise<void> {
  try {
    const actorId = await ensureSystemActor();
    await auditAccess({
      actorId,
      role: "ANONYMOUS",
      action: "LOGIN_FAILED",
      ip: input.ip,
      method: "POST",
      path: "/api/auth/callback/credentials",
      userAgent: "-",
      detail: `email=${input.email} | alasan=${input.reason}`
    });
  } catch (error) {
    console.error("[AUDIT] Gagal mencatat kegagalan login:", (error as Error).message);
  }
}
