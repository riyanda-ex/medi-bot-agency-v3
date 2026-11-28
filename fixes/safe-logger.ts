/**
 * Logger aman: masking NIK, nomor HP, dan kunci sebelum ditulis.
 * Redaksi terpusat di lib/logger.ts agar perilakunya konsisten.
 */
import { formatSafeLogLine, writeSafeLogLine } from "../lib/logger";

export function safeLog(level: "info" | "warn" | "error", message: string, meta?: unknown): void {
  writeSafeLogLine(level, formatSafeLogLine(level, message, meta));
}
