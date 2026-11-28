/**
 * Antrean produksi berbasis BullMQ + Redis.
 * Default tetap QUEUE_MODE=sync: tidak ada Redis yang dibutuhkan.
 * Payload ditandatangani HMAC agar pihak yang bisa menulis ke Redis tidak
 * bisa menyuntik job pengiriman nyata tanpa kunci server.
 */

import { Queue, Worker, type JobsOptions } from "bullmq";
import Redis from "ioredis";
import { z } from "zod";
import { signPayload, verifyPayloadSignature } from "@/lib/crypto";
import { assertSecureEnvironment, isProductionRuntime } from "@/lib/env";
import { logger } from "@/lib/logger";

export const QUEUE_NAME = "tasks";
export const DEAD_LETTER_QUEUE_NAME = "tasks-dlq";
export const DEFAULT_QUEUE_PREFIX = "medi-bot";
export const DEFAULT_MAX_JOB_ATTEMPTS = 3;
export const DEFAULT_JOB_BACKOFF_MS = 1000;
export const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;

export interface OrchestratorJobPayload {
  runId?: string;
  triggeredBy?: string;
}

export interface UrgentFollowupJobPayload {
  patientId: string;
  visitId?: string;
  triageLogId?: string;
  actorId?: string;
  approvalId?: string;
  approvedBy?: string;
  simulate?: boolean;
  stageOffset?: number;
  /** Kunci hash pasien+level+window; stabil walaupun triageLog.id berubah. */
  dedupeKey?: string;
}

export interface QueueJobPayloads {
  "orchestrator.run": OrchestratorJobPayload;
  "urgent.followup": UrgentFollowupJobPayload;
}

export type QueueJobName = keyof QueueJobPayloads;
export type QueueMode = "sync" | "redis";

/** Validasi kedua di worker: HMAC membuktikan asal, Zod membuktikan bentuk. */
export const orchestratorJobSchema = z.object({
  runId: z.string().min(1).optional(),
  triggeredBy: z.string().min(1).optional()
});

export const urgentFollowupJobSchema = z.object({
  patientId: z.string().min(1),
  visitId: z.string().min(1).optional(),
  triageLogId: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  approvalId: z.string().min(1).optional(),
  approvedBy: z.string().min(1).optional(),
  simulate: z.boolean().optional(),
  stageOffset: z.number().int().nonnegative().optional(),
  dedupeKey: z.string().min(1).max(64).optional()
});

interface SignedJob<T> {
  data: T;
  signature: string;
}

export interface EnqueueOptions {
  delayMs?: number;
  jobId?: string;
}

export interface EnqueueResult {
  mode: QueueMode;
  jobId?: string;
  detail: string;
}

export type SchedulerCandidate = "web" | "worker";
export type SchedulerOwner = "auto" | "web" | "worker" | "none";

let connection: Redis | null = null;
let queue: Queue | null = null;
let deadLetterQueue: Queue | null = null;

export function isQueueEnabled(): boolean {
  return process.env.QUEUE_MODE === "redis" && Boolean(process.env.REDIS_URL);
}

/**
 * Satu pemilik cron saja. `auto`: proses web saat mode memory/sync, worker saat
 * BullMQ/Redis aktif. `web`/`worker`: override eksplisit. `none`/nilai invalid:
 * fail-closed (tidak ada cron yang berjalan).
 */
export function schedulerOwner(): SchedulerOwner {
  const raw = (process.env.SCHEDULER_OWNER ?? "auto").trim().toLowerCase();
  if (raw === "auto" || raw === "web" || raw === "worker" || raw === "none") return raw;
  logger.warn("scheduler.owner_invalid", { value: raw.slice(0, 32) });
  return "none";
}

export function shouldOwnScheduler(candidate: SchedulerCandidate): boolean {
  if (process.env.ENABLE_SCHEDULER !== "true") return false;
  const owner = schedulerOwner();
  if (owner === "none") return false;
  if (owner !== "auto") return owner === candidate;
  return candidate === (isQueueEnabled() ? "worker" : "web");
}

/** Counter metrik ringan (in-memory) untuk observability tanpa dependency baru. */
const metricCounters = new Map<string, number>();

export function recordQueueMetric(metric: string, fields: Record<string, unknown> = {}): void {
  const key = metric.startsWith("queue.") ? metric : `queue.${metric}`;
  const total = (metricCounters.get(key) ?? 0) + 1;
  metricCounters.set(key, total);
  logger.info("metric.increment", { metric: key, total, ...fields });
}

export function getQueueMetrics(): Readonly<Record<string, number>> {
  return Object.fromEntries(metricCounters);
}

/** Reset counter metrik (dipakai tes). */
export function resetQueueMetricsForTests(): void {
  metricCounters.clear();
}

/** Redis produksi wajib berpassword dan/atau TLS; tidak boleh terbuka publik. */
export function assertRedisSecurity(): void {
  if (!isProductionRuntime()) return;
  const url = process.env.REDIS_URL;
  if (!url) return;
  const errors: string[] = [];
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    errors.push("REDIS_URL tidak valid.");
  }
  if (parsed) {
    const host = parsed.hostname.toLowerCase();
    const privateHost =
      host === "localhost" ||
      host === "::1" ||
      host === "127.0.0.1" ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.endsWith(".internal");
    if (!parsed.password && !privateHost) {
      errors.push(
        "REDIS_URL produksi wajib memuat password (requirepass) kecuali host privat/lokal."
      );
    }
    if (!privateHost && parsed.protocol !== "rediss:" && process.env.REDIS_TLS !== "true") {
      errors.push("Redis di jaringan publik wajib REDIS_TLS=true atau skema rediss://.");
    }
  }
  if (errors.length > 0) {
    throw new Error(`Konfigurasi Redis tidak aman: ${errors.join("; ")}.`);
  }
}

export function queuePrefix(): string {
  return process.env.QUEUE_PREFIX || DEFAULT_QUEUE_PREFIX;
}

export function signJobPayload<T>(data: T): SignedJob<T> {
  const serialized = JSON.stringify(data);
  return { data, signature: signPayload(serialized) };
}

/** Verifikasi payload job; melempar error bila tanda tangan tidak cocok. */
export function verifyJobPayload<T>(envelope: unknown): T {
  if (!envelope || typeof envelope !== "object") {
    throw new Error("Payload job tidak valid.");
  }
  const candidate = envelope as SignedJob<T>;
  if (
    typeof candidate.signature !== "string" ||
    !verifyPayloadSignature(JSON.stringify(candidate.data), candidate.signature)
  ) {
    throw new Error("Tanda tangan job tidak valid; job ditolak.");
  }
  return candidate.data;
}

/** jobId deterministik turunan konteks agar job sah tidak bisa diracun lebih awal. */
export function buildUrgentJobId(
  prefix: string,
  triageLogId: string,
  context: Record<string, unknown>
): string {
  const hash = signPayload(JSON.stringify({ triageLogId, ...context })).slice(0, 16);
  return `${prefix}-${triageLogId}-${hash}`;
}

function getConnection(): Redis {
  if (connection) return connection;

  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL wajib diisi ketika QUEUE_MODE=redis.");
  assertRedisSecurity();

  connection = new Redis(url, {
    maxRetriesPerRequest: null,
    ...(process.env.REDIS_TLS === "true" ? { tls: {} } : {})
  });
  connection.on("error", (error: Error) => {
    console.error("[QUEUE] Koneksi Redis bermasalah:", error.message);
  });
  return connection;
}

function getQueue(): Queue {
  if (queue) return queue;
  queue = new Queue(QUEUE_NAME, { connection: getConnection(), prefix: queuePrefix() });
  return queue;
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Retry selalu dibatasi; backoff eksponensial oleh BullMQ dengan delay dasar. */
export function jobRetryPolicy(): { attempts: number; backoffMs: number } {
  return {
    attempts: boundedInteger(process.env.QUEUE_MAX_ATTEMPTS, DEFAULT_MAX_JOB_ATTEMPTS, 1, 10),
    backoffMs: boundedInteger(process.env.QUEUE_BACKOFF_DELAY_MS, DEFAULT_JOB_BACKOFF_MS, 1, 60_000)
  };
}

export function buildJobOptions(options: EnqueueOptions = {}): JobsOptions {
  const { attempts, backoffMs } = jobRetryPolicy();
  return {
    attempts,
    backoff: { type: "exponential", delay: backoffMs },
    delay: Math.max(0, options.delayMs ?? 0),
    removeOnComplete: 1000,
    removeOnFail: 5000,
    ...(options.jobId ? { jobId: options.jobId } : {})
  };
}

/** Job yang sudah mencapai batas retry dipindah ke DLQ, bukan dihapus diam-diam. */
export function isDeadLetterJobDue(job: {
  attemptsMade: number;
  opts?: { attempts?: number };
}): boolean {
  const configured = job.opts?.attempts ?? jobRetryPolicy().attempts;
  return job.attemptsMade >= Math.max(1, configured);
}

function getDeadLetterQueue(): Queue {
  if (deadLetterQueue) return deadLetterQueue;
  deadLetterQueue = new Queue(DEAD_LETTER_QUEUE_NAME, {
    connection: getConnection(),
    prefix: queuePrefix()
  });
  return deadLetterQueue;
}

/** Salin job yang gagal permanen ke antrean DLQ untuk inspeksi/replay manual. */
export async function enqueueDeadLetterJob(
  job: { id?: string; name: string; data: unknown; attemptsMade?: number },
  error: Error
): Promise<EnqueueResult> {
  const added = await getDeadLetterQueue().add(
    "dead-letter",
    {
      sourceQueue: QUEUE_NAME,
      jobId: job.id ?? null,
      jobName: job.name,
      data: job.data,
      attemptsMade: job.attemptsMade ?? 0,
      error: error.message.slice(0, 2000),
      failedAt: new Date().toISOString()
    },
    { attempts: 1, removeOnComplete: false, removeOnFail: false }
  );
  recordQueueMetric("job.dead_lettered", { jobName: job.name });
  return {
    mode: "redis",
    jobId: added.id,
    detail: `Job ${job.id ?? "(tanpa id)"} dipindah ke DLQ ${queuePrefix()}:${DEAD_LETTER_QUEUE_NAME}.`
  };
}

export async function enqueueJob<K extends QueueJobName>(
  name: K,
  payload: QueueJobPayloads[K],
  options: EnqueueOptions = {}
): Promise<EnqueueResult> {
  if (!isQueueEnabled()) {
    return {
      mode: "sync",
      detail: "QUEUE_MODE bukan redis atau REDIS_URL kosong: pekerjaan dijalankan langsung."
    };
  }

  assertSecureEnvironment();
  assertRedisSecurity();
  const job = await getQueue().add(name, signJobPayload(payload), buildJobOptions(options));
  return {
    mode: "redis",
    jobId: job.id,
    detail: `Job ${job.id ?? "(tanpa id)"} masuk antrean ${queuePrefix()}:${QUEUE_NAME}.`
  };
}

export interface QueueHandlers {
  "orchestrator.run": (payload: OrchestratorJobPayload) => Promise<unknown>;
  "urgent.followup": (payload: UrgentFollowupJobPayload) => Promise<unknown>;
}

export async function startQueueWorker(handlers: QueueHandlers): Promise<Worker | null> {
  if (!isQueueEnabled()) return null;
  assertSecureEnvironment();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === "orchestrator.run") {
        return handlers["orchestrator.run"](verifyJobPayload<OrchestratorJobPayload>(job.data));
      }
      if (job.name === "urgent.followup") {
        return handlers["urgent.followup"](verifyJobPayload<UrgentFollowupJobPayload>(job.data));
      }
      throw new Error(`Job tidak dikenal: ${job.name}`);
    },
    {
      connection: getConnection(),
      prefix: queuePrefix(),
      concurrency: Math.max(1, Number(process.env.QUEUE_CONCURRENCY ?? 2))
    }
  );

  worker.on("completed", (job) => {
    recordQueueMetric("job.completed", { jobName: job.name });
    logger.info("queue.job_completed", { jobName: job.name, jobId: job.id ?? "-" });
  });

  // Setiap job yang gagal permanen (retry habis) masuk DLQ. Guard in-memory
  // mencegah duplicate DLQ bila event failed terfire lebih dari sekali.
  const deadLettered = new Set<string>();
  worker.on("failed", (job, error) => {
    logger.error("queue.job_failed", {
      jobName: job?.name ?? "?",
      jobId: job?.id ?? "-",
      attemptsMade: job?.attemptsMade ?? 0,
      error: error.message.slice(0, 500)
    });
    recordQueueMetric("job.failed", { jobName: job?.name ?? "?" });
    if (!job || !isDeadLetterJobDue(job)) return;
    const key = job.id ?? `${job.name}:${job.attemptsMade}:${Date.now()}`;
    if (deadLettered.has(key)) return;
    if (deadLettered.size > 1000) deadLettered.clear();
    deadLettered.add(key);
    void enqueueDeadLetterJob(job, error).catch((dlqError: Error) => {
      logger.error("queue.dead_letter_failed", {
        jobId: job.id ?? "-",
        error: dlqError.message.slice(0, 500)
      });
      recordQueueMetric("job.dead_letter_failed", { jobName: job.name });
    });
  });

  return worker;
}

export async function closeQueueConnections(worker?: Worker | null): Promise<void> {
  if (worker) {
    const drainTimeoutMs = boundedInteger(
      process.env.QUEUE_DRAIN_TIMEOUT_MS,
      DEFAULT_DRAIN_TIMEOUT_MS,
      1000,
      300_000
    );
    // close() tanpa force menunggu job aktif selesai. Watchdog hanya memberi
    // batas waktu; tidak ada process.exit() di sini maupun di handler job.
    let watchdog: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      worker
        .close(false)
        .then(() => "drained" as const)
        .catch((error: Error) => {
          logger.error("queue.worker_close_failed", { error: error.message.slice(0, 500) });
          return "drained" as const;
        }),
      new Promise<"timeout">((resolve) => {
        watchdog = setTimeout(() => resolve("timeout"), drainTimeoutMs);
      })
    ]);
    if (watchdog) clearTimeout(watchdog);
    if (outcome === "timeout") {
      logger.warn("queue.drain_timeout", { timeoutMs: drainTimeoutMs });
      recordQueueMetric("worker.drain_timeout");
      await worker.close(true).catch((error: Error) => {
        logger.error("queue.force_close_failed", { error: error.message.slice(0, 500) });
      });
    } else {
      recordQueueMetric("worker.drained");
    }
  }
  if (deadLetterQueue) {
    await deadLetterQueue.close();
    deadLetterQueue = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
