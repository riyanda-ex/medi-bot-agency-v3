/**
 * Antrean produksi berbasis BullMQ + Redis.
 * Default tetap SYNC_MODE / QUEUE_MODE=sync: tidak ada Redis yang dibutuhkan.
 * Set QUEUE_MODE=redis dan REDIS_URL untuk menjalankan worker terpisah.
 */

import { Queue, Worker, type JobsOptions } from "bullmq";
import Redis from "ioredis";

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
  approvedBy?: string;
  simulate?: boolean;
}

export interface QueueJobPayloads {
  "orchestrator.run": OrchestratorJobPayload;
  "urgent.followup": UrgentFollowupJobPayload;
}

export type QueueJobName = keyof QueueJobPayloads;
export type QueueMode = "sync" | "redis";

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

/** Antrean aktif hanya bila QUEUE_MODE=redis DAN REDIS_URL diisi. */
export function isQueueEnabled(): boolean {
  return process.env.QUEUE_MODE === "redis" && Boolean(process.env.REDIS_URL);
}

export function queuePrefix(): string {
  return process.env.QUEUE_PREFIX || DEFAULT_QUEUE_PREFIX;
}

function getConnection(): Redis {
  if (connection) return connection;

  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL wajib diisi ketika QUEUE_MODE=redis.");

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

/** Opsi job diekspos untuk pengujian tanpa membuka koneksi Redis. */
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

/** Masukkan job ke Redis. Mode sync mengembalikan penanda agar caller menjalankan langsung. */
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

  const job = await getQueue().add(name, payload, buildJobOptions(options));
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

/** Worker dipakai oleh scripts/queue-worker.ts, bukan oleh proses Next.js. */
export async function startQueueWorker(handlers: QueueHandlers): Promise<Worker | null> {
  if (!isQueueEnabled()) return null;

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === "orchestrator.run") {
        return handlers["orchestrator.run"](job.data as OrchestratorJobPayload);
      }
      if (job.name === "urgent.followup") {
        return handlers["urgent.followup"](job.data as UrgentFollowupJobPayload);
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

/** Tutup worker, queue, dan koneksi Redis dengan rapi saat shutdown. */
export async function closeQueueConnections(worker?: Worker | null): Promise<void> {
  if (worker) await worker.close();
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
