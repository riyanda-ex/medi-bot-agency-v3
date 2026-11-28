/**
 * Verifikasi berkala tanda tangan audit log.
 *   npm run audit:verify
 *
 * Keluar dengan kode 1 bila ada baris tanpa tanda tangan atau tanda tangan
 * tidak cocok. Cocok dipakai sebagai cron/SIEM check di produksi.
 */

import { prisma } from "../lib/prisma";
import { verifyAuditRows, type AuditVerificationResult } from "../lib/auditIntegrity";
import { writeAgentLog } from "../lib/agentLog";
import { logger } from "../lib/logger";

const BATCH_SIZE = 500;

export async function verifyAllAuditSignatures(): Promise<AuditVerificationResult> {
  const total: AuditVerificationResult = {
    checked: 0,
    valid: 0,
    unsigned: 0,
    invalid: 0,
    invalidIds: []
  };
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.auditLog.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        actorId: true,
        role: true,
        action: true,
        ipAddress: true,
        targetPatientId: true,
        detail: true,
        signature: true
      }
    });
    if (rows.length === 0) break;

    const batch = verifyAuditRows(rows);
    total.checked += batch.checked;
    total.valid += batch.valid;
    total.unsigned += batch.unsigned;
    total.invalid += batch.invalid;
    total.invalidIds.push(...batch.invalidIds);
    cursor = rows[rows.length - 1]?.id;
  }

  return total;
}

async function main(): Promise<void> {
  const result = await verifyAllAuditSignatures();
  const failed = result.unsigned + result.invalid;

  await writeAgentLog({
    agentName: "SECURITY_GUARD",
    status: failed === 0 ? "SUCCESS" : "FAILED",
    message: `Verifikasi integritas audit: ${result.checked} baris, ${result.valid} valid, ${result.unsigned} tanpa tanda tangan, ${result.invalid} tanda tangan tidak cocok.`,
    payload: JSON.stringify({
      checked: result.checked,
      failed,
      sample: result.invalidIds.slice(0, 20)
    })
  });

  if (failed > 0) {
    logger.error("audit.integrity_failed", {
      checked: result.checked,
      unsigned: result.unsigned,
      invalid: result.invalid
    });
    process.exitCode = 1;
  } else {
    logger.info("audit.integrity_ok", { checked: result.checked });
  }

  await prisma.$disconnect();
}

main().catch(async (error: Error) => {
  logger.error("audit.integrity_error", { error: error.message.slice(0, 500) });
  await prisma.$disconnect();
  process.exitCode = 1;
});
