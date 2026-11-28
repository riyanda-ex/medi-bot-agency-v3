/**
 * Job retensi mingguan: menyelaraskan retentionUntil = kunjungan terakhir + 25 tahun.
 * TIDAK menghapus data. Overdue DSR hanya dilaporkan untuk eskalasi DPO/ADMIN.
 *   npm run retention:sweep
 */

import { prisma } from "../lib/prisma";
import { writeAgentLog } from "../lib/agentLog";
import { logger } from "../lib/logger";
import { consentRetentionUntil, dsrIsOverdue, latestVisitDate } from "../lib/privacy";

const BATCH_SIZE = 200;

async function main(): Promise<void> {
  const now = new Date();
  let cursor: string | undefined;
  let aligned = 0;
  let scanned = 0;

  for (;;) {
    const patients = await prisma.patient.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        retentionUntil: true,
        deletedAt: true,
        visits: { select: { visitDate: true } }
      }
    });
    if (patients.length === 0) break;

    for (const patient of patients) {
      scanned += 1;
      if (patient.deletedAt) continue;
      const target = consentRetentionUntil(
        latestVisitDate(patient.visits),
        now,
        patient.retentionUntil
      );
      const current = patient.retentionUntil?.getTime();
      if (current !== target.getTime()) {
        await prisma.patient.update({
          where: { id: patient.id },
          data: { retentionUntil: target }
        });
        aligned += 1;
      }
    }
    cursor = patients[patients.length - 1]?.id;
  }

  const openRequests = await prisma.dataSubjectRequest.findMany({
    where: { completedAt: null },
    select: { id: true, dueAt: true, completedAt: true }
  });
  const overdue = openRequests.filter((item) => dsrIsOverdue(item)).map((item) => item.id);

  await writeAgentLog({
    agentName: "SECURITY_GUARD",
    status: overdue.length > 0 ? "FAILED" : "SUCCESS",
    message:
      `Retensi: ${scanned} pasien dipindai, ${aligned} diselaraskan; ` +
      `${overdue.length} tiket DSR melewati SLA 3x24 jam.`,
    payload: JSON.stringify({ scanned, aligned, overdue: overdue.slice(0, 50) })
  });

  if (overdue.length > 0) {
    logger.error("privacy.dsr_overdue", { count: overdue.length, sample: overdue.slice(0, 20) });
    process.exitCode = 1;
  } else {
    logger.info("privacy.retention_sweep_ok", { scanned, aligned });
  }
  await prisma.$disconnect();
}

main().catch(async (error: Error) => {
  logger.error("privacy.retention_sweep_error", { error: error.message.slice(0, 500) });
  await prisma.$disconnect();
  process.exitCode = 1;
});
