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
  requestId?: string;
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
  const candidate = (value ?? "").trim();
  if (!candidate || candidate.length > 45) return null;
  return isIP(candidate) ? candidate : null;
}

/** X-Forwarded-For ditulis kiri -> kanan: klien asli, lalu tiap proxy. */
function forwardedChain(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => cleanIp(item))
    .filter((item): item is string => Boolean(item));
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function matchesProxy(ip: string, proxy: string): boolean {
  if (proxy === "*") return true;
  if (proxy === ip) return true;
  if (!proxy.includes("/")) return false;
  const [base, bitsRaw] = proxy.split("/");
  const bits = Number(bitsRaw);
  const ipValue = ipv4ToInt(ip);
  const baseValue = ipv4ToInt(base ?? "");
  if (ipValue === null || baseValue === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipValue & mask) >>> 0 === (baseValue & mask) >>> 0;
}

function isTrustedProxy(ip: string, proxies: string[]): boolean {
  return proxies.some((proxy) => matchesProxy(ip, proxy));
}

/**
 * Hanya mempercayai rantai `X-Forwarded-For` bila TRUST_PROXY dikonfigurasi.
 *
 * Penyerang bisa mengganti bagian kiri XFF. Karena itu kita membaca dari hop
 * paling kanan (peer yang dilihat proxy terdekat) dan melewati hop yang memang
 * terdaftar sebagai proxy tepercaya. Nilai paling kiri TIDAK pernah dipakai.
 * Tanpa TRUST_PROXY semua header diabaikan agar audit/rate-limit tidak bisa
 * dispoof. Gunakan CIDR IPv4 atau IP eksak di TRUST_PROXY; `'*'` hanya boleh
 * bila jaringan menjamin semua request melewati proxy tepercaya.
 */
export function getRequestIp(source: Request | HeaderBag): string {
  const headers = source instanceof Request ? source.headers : source;
  const proxies = trustedProxies();
  if (proxies.length === 0) return "unknown";

  const chain = forwardedChain(headerValue(headers, "x-forwarded-for"));
  if (chain.length === 0) {
    return cleanIp(headerValue(headers, "x-real-ip")) ?? "unknown";
  }

  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const hop = chain[index] as string;
    if (!isTrustedProxy(hop, proxies)) return hop;
  }
  // Semua hop terdaftar (mis. TRUST_PROXY=*): tidak ada petunjuk klien asli.
  return chain[0] as string;
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
