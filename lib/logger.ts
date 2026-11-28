type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Field yang aman untuk dikirim ke console/Sentry tanpa penyaringan tambahan. */
export const LOG_FIELD_ALLOWLIST = new Set([
  "ts",
  "level",
  "event",
  "service",
  "version",
  "requestId",
  "method",
  "path",
  "statusCode",
  "durationMs",
  "latencyMs",
  "actorId",
  "userId",
  "patientId",
  "visitId",
  "triageLogId",
  "reportId",
  "jobId",
  "runId",
  "resourceId",
  "scope",
  "backend",
  "remaining",
  "retryAfterSeconds",
  "reason",
  "detail",
  "production",
  "queued",
  "mode",
  "stage",
  "totalLogs",
  "status"
]);

/** Field yang selalu diredaksi, walaupun nilainya tampak innocuous. */
export const LOG_FIELD_DENYLIST =
  /email|e-mail|phone|telepon|no_hp|nik|ktp|token|secret|password|passwd|authorization|cookie|address|alamat|diagnosis|bpjs|nama|name/i;

function redactString(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/(?<!\d)\d{16}(?!\d)/g, "[REDACTED_NIK]")
    .replace(/(?<!\d)(?:\+?62|0)8\d{6,13}(?!\d)/g, "[REDACTED_PHONE]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_TOKEN]")
    .replace(/\bgho_[A-Za-z0-9]+/g, "[REDACTED_TOKEN]")
    .replace(/\bsk-[A-Za-z0-9]+/g, "[REDACTED_TOKEN]")
    .replace(/(sentry_key|api[_-]?key|api[_-]?token)([=:]\s*)([^\s,;]+)/gi, "$1$2[REDACTED_TOKEN]");
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeField(key, item, depth + 1)
      ])
    );
  }
  return "[REDACTED]";
}

function sanitizeField(key: string, value: unknown, depth = 0): unknown {
  if (LOG_FIELD_DENYLIST.test(key) && !LOG_FIELD_ALLOWLIST.has(key)) return "[REDACTED]";
  if (LOG_FIELD_ALLOWLIST.has(key)) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      return typeof value === "string" ? redactString(value) : value;
    }
  }
  return sanitizeValue(value, depth);
}

/** Terapkan allowlist/denylist sebelum field dikonsumsi console maupun Sentry. */
export function redactLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, sanitizeField(key, value)])
  );
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

function sentryDsn(): string | undefined {
  const dsn = process.env.SENTRY_DSN?.trim();
  return dsn ? dsn : undefined;
}

async function reportToSentry(
  level: Level,
  event: string,
  fields: Record<string, unknown>
): Promise<void> {
  const dsn = sentryDsn();
  if (!dsn || (level !== "error" && level !== "warn")) return;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    const key = u.username;
    if (!projectId || !/^[A-Za-z0-9]+$/.test(key)) return;
    // Kunci Sentry dikirim lewat header, bukan query string (tidak masuk log URL).
    const endpoint = `${u.protocol}//${u.host}/api/${encodeURIComponent(projectId)}/store/`;
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${key}`
      },
      body: JSON.stringify({
        message: event,
        level: level === "warn" ? "warning" : level,
        platform: "javascript",
        timestamp: Date.now() / 1000,
        tags: { service: "medibot-clinical-ops" },
        extra: fields
      })
    }).catch(() => undefined);
  } catch {
    // best-effort observability; jangan ganggu flow utama
  }
}

export function logEvent(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (!shouldLog(level)) return;
  const safeFields = redactLogFields(fields);
  const entry = {
    ts: new Date().toISOString(),
    level,
    event: redactString(event),
    service: "medibot-clinical-ops",
    version: process.env.APP_VERSION || process.env.npm_package_version || "0.0.0",
    ...safeFields
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  void reportToSentry(level, redactString(event), safeFields);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => logEvent("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => logEvent("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => logEvent("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => logEvent("error", event, fields)
};
