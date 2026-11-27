type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

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

async function reportToSentry(level: Level, event: string, fields: Record<string, unknown>): Promise<void> {
  const dsn = sentryDsn();
  if (!dsn || (level !== "error" && level !== "warn")) return;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    const key = u.username;
    if (!projectId || !key) return;
    const endpoint = `${u.protocol}//${u.host}/api/${projectId}/store/?sentry_key=${key}&sentry_version=7`;
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    service: "medibot-clinical-ops",
    version: process.env.APP_VERSION || process.env.npm_package_version || "0.0.0",
    ...fields
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  void reportToSentry(level, event, fields);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => logEvent("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => logEvent("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => logEvent("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => logEvent("error", event, fields)
};
