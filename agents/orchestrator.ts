/**
 * AGENT 2 - ORCHESTRATOR
 * Menjalankan semua agent jam 07:00, 12:00, 18:00, 22:00 WIB,
 * cek pasien MERAH tiap 5 menit, retry 3x, log di agent_logs.
 * Scheduler hanya aktif bila ENABLE_SCHEDULER=true (default mati untuk testing).
 */

import cron, { type ScheduledTask } from "node-cron";
import { prisma } from "@/lib/prisma";
import { writeAgentLog } from "@/lib/agentLog";
import { runAnalyzer } from "@/agents/analyzer";
import { runReporter } from "@/agents/reporter";
import { runSecurityGuard } from "@/agents/securityGuard";
import { runEngagement } from "@/agents/engagement";
import { runUrgentTriage } from "@/agents/urgentCaller";
import { runBugHunter } from "@/agents/bugHunter";

export interface AgentOutcome {
  name: string;
  status: "SUCCESS" | "FAILED";
  attempts: number;
  detail: string;
  durationMs: number;
}

export interface OrchestratorRun {
  runId: string;
  startedAt: string;
  finishedAt: string;
  outcomes: AgentOutcome[];
}

const RETRY_LIMIT = 3;

async function withRetry(
  name: string,
  task: () => Promise<unknown>,
  runId: string
): Promise<AgentOutcome> {
  const startedAt = Date.now();
  let lastError = "";

  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt += 1) {
    try {
      const result = await task();
      const outcome: AgentOutcome = {
        name,
        status: "SUCCESS",
        attempts: attempt,
        detail: JSON.stringify(result).slice(0, 2000),
        durationMs: Date.now() - startedAt
      };
      await writeAgentLog({
        agentName: name,
        status: "SUCCESS",
        message: outcome.detail,
        durationMs: outcome.durationMs,
        runId
      });
      return outcome;
    } catch (error) {
      lastError = (error as Error).message;
      if (attempt < RETRY_LIMIT) {
        await new Promise((resolve) => setTimeout(resolve, process.env.SYNC_MODE === "true" ? 1 : 1000));
      }
    }
  }

  const outcome: AgentOutcome = {
    name,
    status: "FAILED",
    attempts: RETRY_LIMIT,
    detail: lastError,
    durationMs: Date.now() - startedAt
  };
  await writeAgentLog({
    agentName: name,
    status: "FAILED",
    message: lastError,
    durationMs: outcome.durationMs,
    runId
  });
  return outcome;
}

export async function checkRedPatients(runId: string): Promise<{ found: number; logged: number }> {
  const since = new Date(Date.now() - 5 * 60_000);
  const redLogs = await prisma.triageLog.findMany({
    where: { level: "MERAH", createdAt: { gte: since } },
    select: { id: true, patientId: true, visitId: true, createdAt: true }
  });

  let logged = 0;
  for (const log of redLogs) {
    const alreadyCalled = await prisma.urgentCall.count({
      where: { triageLogId: log.id, createdAt: { gte: log.createdAt } }
    });
    if (alreadyCalled > 0) continue;

    await runUrgentTriage({
      patientId: log.patientId,
      visitId: log.visitId ?? undefined,
      source: "ORCHESTRATOR_RED_CHECK"
    });
    logged += 1;
  }

  await writeAgentLog({
    agentName: "ORCHESTRATOR",
    status: "SUCCESS",
    message: `Cek MERAH 5 menit: ${redLogs.length} ditemukan, ${logged} ditindaklanjuti`,
    runId
  });

  return { found: redLogs.length, logged };
}

export async function runAllAgents(): Promise<OrchestratorRun> {
  const runId = `run-${Date.now()}`;
  const startedAt = new Date().toISOString();

  const outcomes: AgentOutcome[] = [];
  outcomes.push(await withRetry("RME_ANALYZER", runAnalyzer, runId));
  outcomes.push(await withRetry("AUTO_REPORTER", () => runReporter(), runId));
  outcomes.push(await withRetry("SECURITY_GUARD", runSecurityGuard, runId));
  outcomes.push(await withRetry("PATIENT_ENGAGEMENT", runEngagement, runId));
  outcomes.push(await withRetry("BUG_HUNTER", () => runBugHunter(), runId));
  outcomes.push(await withRetry("URGENT_CALLER", () => checkRedPatients(runId).then((r) => r.found), runId));

  const finishedAt = new Date().toISOString();
  await writeAgentLog({
    agentName: "ORCHESTRATOR",
    status: "SUCCESS",
    message: `Run ${runId} selesai: ${outcomes.filter((item) => item.status === "SUCCESS").length}/${outcomes.length} agent sukses`,
    payload: JSON.stringify(outcomes.map(({ name, status, attempts }) => ({ name, status, attempts }))),
    runId
  });

  return { runId, startedAt, finishedAt, outcomes };
}

let scheduledTasks: ScheduledTask[] = [];

export function startScheduler(): ScheduledTask[] {
  if (process.env.ENABLE_SCHEDULER !== "true") return scheduledTasks;
  if (scheduledTasks.length > 0) return scheduledTasks;

  scheduledTasks = [
    cron.schedule(
      "0 7,12,18,22 * * *",
      () => {
        void runAllAgents();
      },
      { timezone: "Asia/Jakarta" }
    ),
    cron.schedule(
      "*/5 * * * *",
      () => {
        void checkRedPatients(`red-${Date.now()}`);
      },
      { timezone: "Asia/Jakarta" }
    )
  ];

  console.log("[ORCHESTRATOR] Scheduler aktif (Asia/Jakarta).");
  return scheduledTasks;
}

export function stopScheduler(): void {
  for (const task of scheduledTasks) task.stop();
  scheduledTasks = [];
}
