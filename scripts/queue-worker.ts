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
import { closeQueueConnections, isQueueEnabled, startQueueWorker } from "../lib/queue";

async function main(): Promise<void> {
  if (!isQueueEnabled()) {
    console.log("[QUEUE] QUEUE_MODE bukan redis atau REDIS_URL kosong. Worker tidak dimulai.");
    await prisma.$disconnect();
    return;
  }

  const worker = await startQueueWorker({
    "orchestrator.run": async (payload) => {
      console.log(`[QUEUE] Menjalankan orchestrator (${payload.runId ?? "tanpa-run-id"}).`);
      return runAllAgents();
    },
    "urgent.followup": async (payload) => {
      const stages = await executeUrgentFollowUp({
        patientId: payload.patientId,
        visitId: payload.visitId,
        triageLogId: payload.triageLogId,
        actorId: payload.actorId,
        approvedBy: payload.approvedBy,
        simulate: payload.simulate
      });
      return { patientId: payload.patientId, stages: stages.length };
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
