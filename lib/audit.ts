/**
 * Pembantu audit untuk endpoint API.
 * Setiap akses sukses tercatat di audit_logs: aktor, waktu, target, dan IP.
 * Kegagalan penulisan audit tidak boleh menggagalkan respons utama.
 */

import { auditAccess } from "@/agents/securityGuard";
import { normalizeRole } from "@/lib/rbac";

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

/** Ambil IP asli dari proxied request; fallback ke localhost untuk pengujian lokal. */
export function getRequestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() || "127.0.0.1";
}

export async function auditApiAccess(input: ApiAuditInput): Promise<void> {
  const actorId = input.session?.user?.id;
  if (!actorId) return;

  try {
    await auditAccess({
      actorId,
      role: normalizeRole(input.session?.user?.role),
      action: input.action,
      ip: getRequestIp(input.request),
      targetPatientId: input.targetPatientId,
      detail: input.detail
    });
  } catch (error) {
    console.error("[AUDIT] Gagal mencatat akses API:", (error as Error).message);
  }
}
