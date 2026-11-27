import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface ApiLogInput {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ip?: string | null;
  userId?: string | null;
  userAgent?: string | null;
  error?: string | null;
}

function retentionDays(): number {
  const raw = Number(process.env.API_LOG_RETENTION_DAYS ?? "30");
  if (!Number.isFinite(raw)) return 30;
  return Math.min(365, Math.max(1, Math.floor(raw)));
}

export async function logApiRequest(input: ApiLogInput): Promise<void> {
  try {
    await prisma.apiLog.create({
      data: {
        requestId: input.requestId,
        method: input.method.slice(0, 16),
        path: input.path.slice(0, 512),
        statusCode: input.statusCode,
        durationMs: Math.max(0, Math.round(input.durationMs)),
        ip: input.ip?.slice(0, 64) ?? null,
        userId: input.userId ?? null,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
        error: input.error?.slice(0, 1000) ?? null
      }
    });
  } catch (error) {
    logger.warn("api_log.write_failed", {
      requestId: input.requestId,
      error: (error as Error).message
    });
  }
}

/** Purge log API lama untuk retensi/minimisasi data. Jalankan terjadwal di produksi. */
export async function purgeOldApiLogs(): Promise<{ deleted: number; cutoff: string }> {
  if (process.env.API_LOG_PURGE_ENABLED === "false") {
    return { deleted: 0, cutoff: new Date().toISOString() };
  }
  const cutoff = new Date(Date.now() - retentionDays() * 24 * 60 * 60 * 1000);
  const result = await prisma.apiLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  logger.info("api_log.purged", { deleted: result.count, cutoff: cutoff.toISOString() });
  return { deleted: result.count, cutoff: cutoff.toISOString() };
}
