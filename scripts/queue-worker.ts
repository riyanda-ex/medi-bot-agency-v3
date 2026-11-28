/**
 * Worker antrean produksi. Jalankan sebagai proses terpisah:
 *   QUEUE_MODE=redis REDIS_URL=redis://localhost:6379 npm run queue:worker
 *
 * Worker tidak pernah mengirim pesan nyata tanpa ALLOW_REAL_OUTBOUND=true
 * dan approval manusia; logika tersebut tetap ada di agent urgentCaller.
 *
 * Cron: pada QUEUE_MODE=redis + ENABLE_SCHEDULER=true worker adalah SATU-SATUNYA
 * pemilik cron (auto). Proses web tidak menjalankan cron dalam mode ini.
 * Gunakan SCHEDULER_OWNER=web|worker|none untuk override/fail-closed.
 */

import type { Worker } from "bullmq";
import { runAllAgents, startWorkerScheduler, stopScheduler } from "../agents/orchestrator";
import { executeUrgentFollowUp } from "../agents/urgentCaller";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import {
  closeQueueConnections,
  isQueueEnabled,
  orchestratorJobSchema,
  recordQueueMetric,
  startQueueWorker,
  urgentFollowupJobSchema
} from "../lib/queue";

let shuttingDown = false;

export interface WorkerShutdownDeps {
  stopScheduler?: () => void;
  closeConnections?: (worker: Worker | null) => Promise<void>;
  disconnect?: () => Promise<void>;
}

/**
 * Shutdown rapi: hentikan cron, tunggu job aktif selesai (drain), tutup Redis,
 * lalu disconnect Prisma. Tidak ada process.exit(0) paksa di sini maupun di
 * handler job; exit code diatur agar event loop bisa habis dengan sendirinya.
 */
export async function shutdownWorker(
  signal: string,
  worker: Worker | null,
  deps: WorkerShutdownDeps = {}
): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("queue.worker.shutdown", { signal });
  (deps.stopScheduler ?? stopScheduler)();
  await (deps.closeConnections ?? closeQueueConnections)(worker);
  await (deps.disconnect ?? (() => prisma.$disconnect()))();
  recordQueueMetric("worker.shutdown", { signal });
  process.exitCode = 0;
}

/** Reset guard shutdown (dipakai tes). */
export function resetWorkerShutdownForTests(): void {
  shuttingDown = false;
}

async function main(): Promise<void> {
  if (!isQueueEnabled()) {
    logger.info("queue.worker.disabled", {
      detail: "QUEUE_MODE bukan redis atau REDIS_URL kosong"
    });
    await prisma.$disconnect();
    return;
  }

  const worker = await startQueueWorker({
    "orchestrator.run": async (payload) => {
      const job = orchestratorJobSchema.parse(payload);
      logger.info("queue.job.orchestrator", { runId: job.runId ?? "tanpa-run-id" });
      return runAllAgents();
    },
    "urgent.followup": async (payload) => {
      const job = urgentFollowupJobSchema.parse(payload);
      const stages = await executeUrgentFollowUp({
        patientId: job.patientId,
        visitId: job.visitId,
        triageLogId: job.triageLogId,
        actorId: job.actorId,
        approvalId: job.approvalId,
        approvedBy: job.approvedBy,
        simulate: job.simulate,
        stageOffset: job.stageOffset,
        dedupeKey: job.dedupeKey
      });
      return { patientId: job.patientId, stages: stages.length };
    }
  });

  if (!worker) {
    await prisma.$disconnect();
    return;
  }

  const cronTasks = startWorkerScheduler();
  if (cronTasks.length > 0) {
    logger.info("queue.worker.scheduler_enabled", { tasks: cronTasks.length });
  }

  const onSignal = (signal: string): void => {
    void shutdownWorker(signal, worker).catch((error: Error) => {
      logger.error("queue.worker.shutdown_failed", { signal, error: error.message.slice(0, 500) });
      recordQueueMetric("worker.shutdown_failed", { signal });
      process.exitCode = 1;
    });
  };

  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  logger.info("queue.worker.ready", { queues: "orchestrator.run,urgent.followup" });
}

main().catch((error) => {
  logger.error("queue.worker.startup_failed", { error: (error as Error).message.slice(0, 500) });
  process.exit(1);
});
