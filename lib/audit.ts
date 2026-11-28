/**
 * Pembantu audit untuk endpoint API.
 * Setiap akses (termasuk yang ditolak) tercatat: aktor, peran, waktu, target,
 * metod, path, IP, dan user agent. Kegagalan audit tidak menggagalkan respons.
 */

import { createHash, randomBytes } from "node:crypto";
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

interface TrustedProxyConfig {
  allowAll: boolean;
  entries: string[];
}

function trustedProxies(): TrustedProxyConfig {
  const entries = (process.env.TRUST_PROXY ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    // Hanya '*' eksplisit yang boleh mempercayai seluruh hop.
    allowAll: entries.includes("*"),
    entries: entries.filter((entry) => entry !== "*" && !/^(true|false|1|0)$/i.test(entry))
  };
}

type HeaderBag = Headers | Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderBag, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  const raw = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null);
}

function cleanIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 45) return null;
  return isIP(candidate) ? candidate : null;
}

function ipv4Bits(ip: string): number[] {
  return ip.split(".").map((part) => Number(part));
}

function matchesIpv4Prefix(ip: string, network: string, prefix?: string): boolean {
  const ipParts = ipv4Bits(ip);
  const netParts = ipv4Bits(network);
  if (ipParts.length !== 4 || netParts.length !== 4) return false;
  if (ipParts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (netParts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;

  const bits = prefix === undefined ? 24 : Number(prefix);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  let mask = 0xffffffff << (32 - bits);
  mask = mask >>> 0;
  const toInt = (parts: number[]): number =>
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  return (toInt(ipParts) & mask) === (toInt(netParts) & mask);
}

/** Bare IP diperlakukan sebagai /24 (IPv4) agar jaringan proxy lokal dapat dipakai. */
export function isTrustedProxyHop(ip: string, entry: string): boolean {
  if (entry === "*") return true;
  const [network, prefix, ...rest] = entry.split("/");
  if (rest.length > 0 || !network) return false;
  if (isIP(network) === 4) return matchesIpv4Prefix(ip, network, prefix);
  if (isIP(network) === 6) return ip === network;
  return false;
}

function forwardedHops(headers: HeaderBag): string[] {
  const raw = headerValue(headers, "x-forwarded-for");
  if (!raw) return [];
  return raw
    .split(",")
    .map((hop) => cleanIp(hop))
    .filter((hop): hop is string => Boolean(hop));
}

/**
 * Header forwarding hanya dipercaya bila TRUST_PROXY dikonfigurasi.
 * Tanpa TRUST_PROXY, header klien diabaikan untuk mencegah spoofing IP audit/rate-limit.
 * Dengan daftar proxy, rantai X-Forwarded-For dibaca dari kanan: hop terpercaya
 * terakhir harus cocok, lalu IP pertama di sebelah kirinya dipakai sebagai klien.
 * '*' hanya dipercaya bila memang ditulis eksplisit.
 */
export function getRequestIp(source: Request | HeaderBag): string {
  const headers = source instanceof Request ? source.headers : source;
  const config = trustedProxies();
  if (!config.allowAll && config.entries.length === 0) return "unknown";

  const hops = forwardedHops(headers);
  if (config.allowAll) {
    return hops[0] ?? cleanIp(headerValue(headers, "x-real-ip")) ?? "unknown";
  }
  if (hops.length === 0) return "unknown";

  let cursor = hops.length - 1;
  let foundTrustedHop = false;
  while (cursor >= 0 && config.entries.some((entry) => isTrustedProxyHop(hops[cursor], entry))) {
    foundTrustedHop = true;
    cursor -= 1;
  }
  if (!foundTrustedHop) return "unknown";
  return cursor >= 0 ? hops[cursor] : hops[0];
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

function withRequestId(detail: string | undefined, requestId: string | undefined): string {
  const base = detail?.trim() ?? "";
  const id = requestId ?? "-";
  return base ? `${base} | requestId=${id}` : `requestId=${id}`;
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
      detail: withRequestId(
        anonymous ? `AKSES_TANPA_SESI | ${input.detail ?? ""}` : input.detail,
        input.requestId
      )
    });
  } catch (error) {
    console.error("[AUDIT] Gagal mencatat akses API:", (error as Error).message);
  }
}

/** Catat kegagalan login tanpa pernah menulis kata sandi maupun email mentah. */
export async function recordAuthFailure(input: {
  email: string;
  ip: string;
  reason: "RATE_LIMITED" | "INVALID_CREDENTIALS" | "ACCOUNT_INACTIVE";
}): Promise<void> {
  try {
    const actorId = await ensureSystemActor();
    const emailHash = createHash("sha256")
      .update(input.email.trim().toLowerCase())
      .digest("hex")
      .slice(0, 32);
    await auditAccess({
      actorId,
      role: "ANONYMOUS",
      action: "LOGIN_FAILED",
      ip: input.ip,
      method: "POST",
      path: "/api/auth/callback/credentials",
      userAgent: "-",
      detail: `emailHash=${emailHash} | alasan=${input.reason}`
    });
  } catch (error) {
    console.error("[AUDIT] Gagal mencatat kegagalan login:", (error as Error).message);
  }
}
