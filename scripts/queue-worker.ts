/**
 * Worker antrean produksi. Jalankan sebagai proses terpisah:
 *   QUEUE_MODE=redis REDIS_URL=redis://localhost:6379 npm run queue:worker
 *
 * Worker tidak pernah mengirim pesan nyata tanpa ALLOW_REAL_OUTBOUND=true
 * dan approval manusia; logika tersebut tetap ada di agent urgentCaller.
 */

import { runAllAgents } from "../agents/orchestrator";
import { executeUrgentFollowUp } from "../agents/urgentCaller";
import { prisma } from "../lib/prisma";
import {
  closeQueueConnections,
  isQueueEnabled,
  orchestratorJobSchema,
  startQueueWorker,
  urgentFollowupJobSchema
} from "../lib/queue";

async function main(): Promise<void> {
  if (!isQueueEnabled()) {
    console.log("[QUEUE] QUEUE_MODE bukan redis atau REDIS_URL kosong. Worker tidak dimulai.");
    await prisma.$disconnect();
    return;
  }

  const worker = await startQueueWorker({
    "orchestrator.run": async (payload) => {
      const job = orchestratorJobSchema.parse(payload);
      console.log(`[QUEUE] Menjalankan orchestrator (${job.runId ?? "tanpa-run-id"}).`);
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
        stageOffset: job.stageOffset
      });
      return { patientId: job.patientId, stages: stages.length };
    }
  });

  if (!worker) {
    await prisma.$disconnect();
    return;
  }

  const shutdown = async (): Promise<void> => {
    await closeQueueConnections(worker);
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  console.log("[QUEUE] Worker aktif. Menunggu job orchestrator.run dan urgent.followup.");
}

main().catch((error) => {
  console.error("[QUEUE] Worker gagal:", error);
  process.exit(1);
});
