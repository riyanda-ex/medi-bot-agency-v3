/**
 * Logger aman: masking NIK, nomor HP, dan kunci sebelum ditulis.
 * Dihasilkan oleh Bug Hunter untuk mengganti console.log mentah.
 */
const SENSITIVE = /(35\d{14}|08\d{8,}|gho_[A-Za-z0-9]+|sk-[A-Za-z0-9]+)/g;

export function safeLog(level: "info" | "warn" | "error", message: string, meta?: unknown): void {
  const redact = (value: string): string => value.replace(SENSITIVE, "[REDACTED]");
  const serialized =
    meta === undefined ? "" : JSON.stringify(meta).replace(SENSITIVE, "[REDACTED]");
  const line = `[${level.toUpperCase()}] ${redact(message)} ${serialized}`.trim();
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
