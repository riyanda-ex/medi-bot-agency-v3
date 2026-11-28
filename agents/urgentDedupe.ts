/**
 * Dedupe deterministik untuk panggilan MERAH.
 *
 * Kunci tidak bergantung pada `triageLog.id`: setiap eksekusi urgentCaller
 * membuat triage record baru, sehingga ID lama selalu stale. Kunci turunan
 * patientId + level + bucket waktu ini dipakai bersama oleh checkRedPatients
 * (frontend/in-process) dan jobId BullMQ (worker), sehingga satu pasien tidak
 * dipanggil dua kali dalam satu jendela.
 */

import { createHash } from "node:crypto";

export const DEFAULT_URGENT_DEDUPE_WINDOW_MINUTES = 15;
const DEDUPE_DOMAIN = "urgent-dedupe-v1";

/** Jendela dedupe bisa diatur, tetapi dibatasi agar tidak menonaktifkan SOP. */
export function urgentDedupeWindowMs(): number {
  const raw = Number(
    process.env.URGENT_DEDUPE_WINDOW_MINUTES ?? DEFAULT_URGENT_DEDUPE_WINDOW_MINUTES
  );
  if (!Number.isFinite(raw)) return DEFAULT_URGENT_DEDUPE_WINDOW_MINUTES * 60_000;
  return Math.min(120, Math.max(1, Math.floor(raw))) * 60_000;
}

/**
 * Kunci stabil untuk satu pasien+level pada satu bucket jendela. Hash sengaja
 * tanpa data klinis lain agar tidak membocorkan nilai vital ke log/queue.
 */
export function buildUrgentDedupeKey(
  patientId: string,
  level: string,
  nowMs: number = Date.now(),
  windowMs: number = urgentDedupeWindowMs()
): string {
  const bucket = Math.floor(nowMs / Math.max(1, windowMs));
  return createHash("sha256")
    .update(
      `${DEDUPE_DOMAIN}|${patientId.trim().toLowerCase()}|${level.trim().toUpperCase()}|${bucket}`
    )
    .digest("hex")
    .slice(0, 32);
}

/** Klaim in-process: menutup race dua callback cron sebelum triage record sempat ditulis. */
const claimedWindows = new Map<string, number>();

function pruneClaims(nowMs: number): void {
  for (const [key, expiresAt] of claimedWindows) {
    if (expiresAt <= nowMs) claimedWindows.delete(key);
  }
}

export function isUrgentWindowClaimed(key: string, nowMs: number = Date.now()): boolean {
  pruneClaims(nowMs);
  return claimedWindows.has(key);
}

export function claimUrgentWindow(key: string, nowMs: number = Date.now()): boolean {
  pruneClaims(nowMs);
  if (claimedWindows.has(key)) return false;
  claimedWindows.set(key, nowMs + urgentDedupeWindowMs());
  return true;
}

/** Lepaskan klaim bila eksekusi gagal, agar retry orchestrator tidak melewati pasien. */
export function releaseUrgentWindow(key: string): void {
  claimedWindows.delete(key);
}

/** Bersihkan state in-process (dipakai tes deterministik). */
export function resetUrgentDedupeCache(): void {
  claimedWindows.clear();
}
