import { prisma } from "../lib/prisma";
import { runAnalyzer } from "../agents/analyzer";
import { runReporter } from "../agents/reporter";
import { runSecurityGuard } from "../agents/securityGuard";
import { runEngagement } from "../agents/engagement";
import { runBugHunter } from "../agents/bugHunter";
import { runUrgentTriage } from "../agents/urgentCaller";

async function main(): Promise<void> {
  const analyzer = await runAnalyzer();
  console.log("[VERIFY] Analyzer:", analyzer.analyzed, "records,", analyzer.merah, "MERAH");

  const redPatient = await prisma.patient.findFirst({
    where: { triageLogs: { some: { level: "MERAH" } } }
  });
  if (!redPatient) throw new Error("Tidak ada pasien MERAH di seed.");

  const urgent = await runUrgentTriage({ patientId: redPatient.id, source: "VERIFY" });
  console.log("[VERIFY] Urgent:", urgent.level, urgent.stages.length, "tahap");

  const reporter = await runReporter();
  console.log("[VERIFY] Reporter:", reporter.reportId, reporter.files.pdf);

  const security = await runSecurityGuard();
  console.log(
    "[VERIFY] Security:",
    security.syncMode,
    "sync,",
    security.auditRetentionDays,
    "hari retensi"
  );

  const engagement = await runEngagement();
  console.log("[VERIFY] Engagement:", JSON.stringify(engagement));

  const bugHunter = await runBugHunter();
  console.log(
    "[VERIFY] BugHunter:",
    bugHunter.findings.length,
    "temuan,",
    bugHunter.fixFiles.length,
    "file fix"
  );

  const urgentCalls = await prisma.urgentCall.count();
  console.log("[VERIFY] Total urgent_calls:", urgentCalls);
}

main()
  .catch((error) => {
    console.error("[VERIFY] Gagal:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
