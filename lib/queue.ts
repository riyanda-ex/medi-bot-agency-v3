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

export const QUEUE_NAME = "tasks";
export const DEFAULT_QUEUE_PREFIX = "medi-bot";

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
  stageOffset: z.number().int().nonnegative().optional()
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

let connection: Redis | null = null;
let queue: Queue | null = null;

export function isQueueEnabled(): boolean {
  return process.env.QUEUE_MODE === "redis" && Boolean(process.env.REDIS_URL);
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
  if (parsed && !parsed.password) {
    errors.push("REDIS_URL produksi wajib memuat password (requirepass).");
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
  if (typeof candidate.signature !== "string" || !verifyPayloadSignature(JSON.stringify(candidate.data), candidate.signature)) {
    throw new Error("Tanda tangan job tidak valid; job ditolak.");
  }
  return candidate.data;
}

/** jobId deterministik turunan konteks agar job sah tidak bisa diracun lebih awal. */
export function buildUrgentJobId(prefix: string, triageLogId: string, context: Record<string, unknown>): string {
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

export function buildJobOptions(options: EnqueueOptions = {}): JobsOptions {
  return {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    delay: Math.max(0, options.delayMs ?? 0),
    removeOnComplete: 1000,
    removeOnFail: 5000,
    ...(options.jobId ? { jobId: options.jobId } : {})
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
    console.log(`[QUEUE] Selesai: ${job.name} (${job.id ?? "-"})`);
  });
  worker.on("failed", (job, error) => {
    console.error(`[QUEUE] Gagal: ${job?.name ?? "?"} (${job?.id ?? "-"}) - ${error.message}`);
  });

  return worker;
}

export async function closeQueueConnections(worker?: Worker | null): Promise<void> {
  if (worker) {
    // Beri waktu pekerjaan berhenti rapi sebelum paksa tutup.
    await Promise.race([
      worker.close(),
      new Promise<void>((resolve) => setTimeout(resolve, 5000))
    ]);
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
