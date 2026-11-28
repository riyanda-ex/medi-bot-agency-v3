/**
 * Operator DLQ: lihat daftar atau replay satu job yang gagal permanen.
 *   npm run queue:replay -- --list
 *   npm run queue:replay -- <jobId>
 *
 * Payload aslinya tetap diverifikasi HMAC + Zod sebelum masuk antrean utama.
 */

import "dotenv/config";
import {
  closeQueueConnections,
  isQueueEnabled,
  listDeadLetterJobs,
  replayDeadLetterJob
} from "../lib/queue";

async function main(): Promise<void> {
  if (!isQueueEnabled()) {
    throw new Error("QUEUE_MODE=redis dan REDIS_URL wajib diisi untuk mengelola DLQ.");
  }

  const args = process.argv.slice(2);
  if (args[0] === "--list") {
    const jobs = await listDeadLetterJobs(20);
    console.log(JSON.stringify(jobs, null, 2));
    return;
  }

  const jobId = args[0]?.trim();
  if (!jobId) {
    throw new Error("Berikan --list atau ID job DLQ. Contoh: npm run queue:replay -- --list");
  }
  const result = await replayDeadLetterJob(jobId);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error: Error) => {
    console.error(`[DLQ] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueueConnections().catch(() => undefined);
  });
