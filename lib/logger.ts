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
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => logEvent("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => logEvent("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => logEvent("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => logEvent("error", event, fields)
};
