type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// NIK (16 digit), nomor HP Indonesia, kunci API, dan header Bearer.
const SENSITIVE_PATTERN =
  /\b(?:\d{16}|08\d{8,}|gho_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]+)\b|\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;

/** Gunakan satu tempat untuk semua penyamaran nilai sensitif di log. */
export function redactSensitive(value: string): string {
  return value.replace(SENSITIVE_PATTERN, "[REDACTED]");
}

/** Format baris log aman yang dipakai oleh safeLog maupun konsol fix files. */
export function formatSafeLogLine(
  level: Exclude<Level, "debug">,
  message: string,
  meta?: unknown
): string {
  const json = meta === undefined ? "" : JSON.stringify(meta);
  const serialized = json ? redactSensitive(json) : "";
  return `[${level.toUpperCase()}] ${redactSensitive(message)} ${serialized}`.trim();
}

/** Tulis baris log yang sudah disamarkan ke konsol yang sesuai. */
export function writeSafeLogLine(level: Exclude<Level, "debug">, line: string): void {
  const safeLine = redactSensitive(line);
  if (level === "error") console.error(safeLine);
  else if (level === "warn") console.warn(safeLine);
  else console.info(safeLine);
}

function currentLevel(): Level {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  return (["debug", "info", "warn", "error"] as const).includes(raw as Level)
    ? (raw as Level)
    : "info";
}

function shouldLog(level: Level): boolean {
  return LEVELS[level] >= LEVELS[currentLevel()];
}

export function logEvent(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (!shouldLog(level)) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    service: "medibot-clinical-ops",
    version: process.env.APP_VERSION || process.env.npm_package_version || "0.0.0",
    ...fields
  };
  const line = redactSensitive(JSON.stringify(entry));
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => logEvent("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => logEvent("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => logEvent("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => logEvent("error", event, fields)
};
