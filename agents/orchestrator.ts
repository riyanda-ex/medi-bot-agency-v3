/**
 * AGENT 2 - ORCHESTRATOR
 * Menjalankan semua agent jam 07:00, 12:00, 18:00, 22:00 WIB,
 * cek pasien MERAH tiap 5 menit, retry 3x, log di agent_logs.
 *
 * Cron punya satu owner saja. Mode `auto`: in-process (web) saat queue memory
 * (`QUEUE_MODE=sync`), worker saat BullMQ/Redis aktif. Override dengan
 * SCHEDULER_OWNER=web|worker|none. ENABLE_SCHEDULER=true wajib untuk keduanya.
 *
 * Feature flag per agent: FEATURE_ANALYZER, FEATURE_REPORTER,
 * FEATURE_SECURITY_GUARD, FEATURE_ENGAGEMENT, FEATURE_BUG_HUNTER,
 * FEATURE_URGENT_CALLER (nilai false/0/no/off menonaktifkan).
 */

import cron, { type ScheduledTask } from "node-cron";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { writeAgentLog } from "@/lib/agentLog";
import { logger } from "@/lib/logger";
import {
  jobRetryPolicy,
  recordQueueMetric,
  shouldOwnScheduler,
  type SchedulerCandidate
} from "@/lib/queue";
import { runAnalyzer } from "@/agents/analyzer";
import { runReporter } from "@/agents/reporter";
import { runSecurityGuard } from "@/agents/securityGuard";
import { runEngagement } from "@/agents/engagement";
import { runUrgentTriage } from "@/agents/urgentCaller";
import { runBugHunter } from "@/agents/bugHunter";
import {
  buildUrgentDedupeKey,
  claimUrgentWindow,
  isUrgentWindowClaimed,
  releaseUrgentWindow,
  resetUrgentDedupeCache,
  urgentDedupeWindowMs
} from "@/agents/urgentDedupe";

export type AgentStatus = "SUCCESS" | "FAILED" | "SKIPPED";
export type RunStatus = "SUCCESS" | "PARTIAL" | "FAILED";

export interface AgentOutcome {
  name: string;
  status: AgentStatus;
  attempts: number;
  detail: string;
  durationMs: number;
}

export interface OrchestratorRun {
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: RunStatus;
  outcomes: AgentOutcome[];
  errorSummary: string[];
}

export interface RedCheckResult {
  found: number;
  logged: number;
  skipped: number;
  errors: string[];
  dedupeKeys: string[];
}

export const AGENT_FEATURE_FLAGS = {
  RME_ANALYZER: "FEATURE_ANALYZER",
  AUTO_REPORTER: "FEATURE_REPORTER",
  SECURITY_GUARD: "FEATURE_SECURITY_GUARD",
  PATIENT_ENGAGEMENT: "FEATURE_ENGAGEMENT",
  BUG_HUNTER: "FEATURE_BUG_HUNTER",
  URGENT_CALLER: "FEATURE_URGENT_CALLER"
} as const;

export const CRITICAL_AGENTS: readonly string[] = ["URGENT_CALLER"];

const RED_CHECK_LOOKBACK_MS = 5 * 60_000;
const SCHEDULER_GLOBAL_KEY = Symbol.for("medibot.orchestrator.scheduler");

/** Feature flag per agent; tidak ada env = aktif (kompatibel dengan perilaku lama). */
export function isAgentEnabled(name: string): boolean {
  const envKey = AGENT_FEATURE_FLAGS[name as keyof typeof AGENT_FEATURE_FLAGS];
  if (!envKey) return true;
  const raw = process.env[envKey];
  if (raw === undefined || raw.trim() === "") return true;
  return !["false", "0", "no", "off"].includes(raw.trim().toLowerCase());
}

export function isCriticalAgent(name: string): boolean {
  return CRITICAL_AGENTS.includes(name);
}

/**
 * Status run mengikuti hasil nyata agent, bukan asumsi SUCCESS.
 * Agent critical yang gagal (atau semua agent yang dijalankan gagal) => FAILED.
 */
export function deriveRunStatus(outcomes: readonly AgentOutcome[]): RunStatus {
  const executed = outcomes.filter((outcome) => outcome.status !== "SKIPPED");
  const failed = executed.filter((outcome) => outcome.status === "FAILED");
  if (failed.length === 0) return "SUCCESS";
  if (
    executed.length === 0 ||
    failed.length === executed.length ||
    failed.some((outcome) => isCriticalAgent(outcome.name))
  ) {
    return "FAILED";
  }
  return "PARTIAL";
}

export function skippedOutcome(
  name: string,
  reason = "Dinonaktifkan lewat feature flag"
): AgentOutcome {
  return { name, status: "SKIPPED", attempts: 0, detail: reason, durationMs: 0 };
}

function retryDelayMs(attempt: number): number {
  if (process.env.SYNC_MODE === "true") return 1;
  return Math.min(8000, 1000 * 2 ** Math.max(0, attempt - 1));
}

async function withRetry(
  name: string,
  task: () => Promise<unknown>,
  runId: string
): Promise<AgentOutcome> {
  const startedAt = Date.now();
  const attempts = Math.max(1, jobRetryPolicy().attempts);
  let lastError = "";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
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
      if (attempt < attempts)
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
    }
  }

  const outcome: AgentOutcome = {
    name,
    status: "FAILED",
    attempts,
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
  recordQueueMetric("agent.failed", { agentName: name });
  return outcome;
}

async function runAgentStep(
  name: string,
  task: () => Promise<unknown>,
  runId: string
): Promise<AgentOutcome> {
  if (!isAgentEnabled(name)) {
    const outcome = skippedOutcome(name);
    await writeAgentLog({
      agentName: name,
      status: "SKIPPED",
      message: outcome.detail,
      durationMs: 0,
      runId
    });
    recordQueueMetric("agent.skipped", { agentName: name });
    return outcome;
  }
  return withRetry(name, task, runId);
}

/**
 * Cek MERAH 5 menit. Dedupe memakai kunci stabil (pasien+level+window),
 * urgentCall aktif dalam window, DAN triage record baru yang dibuat caller.
 * ID triage lama sengaja tidak dipakai karena selalu stale.
 */
export async function checkRedPatients(runId: string): Promise<RedCheckResult> {
  if (!isAgentEnabled("URGENT_CALLER")) {
    await writeAgentLog({
      agentName: "ORCHESTRATOR",
      status: "SKIPPED",
      message: "Cek MERAH dilewati: FEATURE_URGENT_CALLER=false",
      runId
    });
    return { found: 0, logged: 0, skipped: 0, errors: [], dedupeKeys: [] };
  }

  const now = Date.now();
  const since = new Date(now - RED_CHECK_LOOKBACK_MS);
  const windowStart = new Date(now - urgentDedupeWindowMs());
  const redLogs = await prisma.triageLog.findMany({
    where: { level: "MERAH", createdAt: { gte: since } },
    select: { id: true, patientId: true, visitId: true, createdAt: true }
  });

  let logged = 0;
  let skipped = 0;
  const errors: string[] = [];
  const dedupeKeys: string[] = [];

  for (const log of redLogs) {
    const dedupeKey = buildUrgentDedupeKey(log.patientId, "MERAH", now);
    dedupeKeys.push(dedupeKey);

    // Semua panggilan pada window (aktif maupun gagal) mengunci pasien agar
    // tidak ada telepon/WhatsApp dobel dalam satu SOP 15 menit.
    const activeCalls = await prisma.urgentCall.count({
      where: { patientId: log.patientId, createdAt: { gte: windowStart } }
    });
    // caller selalu membuat triage record BARU; cari record yang lebih baru
    // dari sumber agar run berikutnya tidak mengantri ulang job yang sama.
    const newerTriage = await prisma.triageLog.count({
      where: {
        patientId: log.patientId,
        level: "MERAH",
        id: { not: log.id },
        createdAt: { gt: log.createdAt, gte: windowStart }
      }
    });

    if (activeCalls > 0 || newerTriage > 0) {
      skipped += 1;
      await writeAgentLog({
        agentName: "ORCHESTRATOR",
        status: "SKIPPED",
        message: `MERAH ${log.patientId} dilewati: sudah ada panggilan/triage dalam window`,
        payload: JSON.stringify({
          sourceTriageLogId: log.id,
          dedupeKey,
          activeCalls,
          newerTriage
        }),
        runId
      });
      continue;
    }

    if (!claimUrgentWindow(dedupeKey)) {
      skipped += 1;
      await writeAgentLog({
        agentName: "ORCHESTRATOR",
        status: "SKIPPED",
        message: `MERAH ${log.patientId} dilewati: klaim window sudah dipegang`,
        payload: JSON.stringify({ sourceTriageLogId: log.id, dedupeKey }),
        runId
      });
      continue;
    }

    try {
      const result = await runUrgentTriage({
        patientId: log.patientId,
        visitId: log.visitId ?? undefined,
        source: "ORCHESTRATOR_RED_CHECK",
        dedupeKey
      });
      logged += 1;
      await writeAgentLog({
        agentName: "ORCHESTRATOR",
        status: "SUCCESS",
        message: `MERAH ${log.patientId} ditindaklanjuti (${result.level})`,
        payload: JSON.stringify({
          sourceTriageLogId: log.id,
          triageLogId: result.triageLogId,
          dedupeKey
        }),
        runId
      });
    } catch (error) {
      releaseUrgentWindow(dedupeKey);
      errors.push(`${log.patientId}: ${(error as Error).message}`);
    }
  }

  const status = errors.length === 0 ? "SUCCESS" : logged > 0 ? "PARTIAL" : "FAILED";
  await writeAgentLog({
    agentName: "ORCHESTRATOR",
    status,
    message: `Cek MERAH 5 menit: ${redLogs.length} ditemukan, ${logged} ditindaklanjuti, ${skipped} dilewati, ${errors.length} gagal`,
    payload: JSON.stringify({ dedupeKeys, windowMs: urgentDedupeWindowMs(), errors }),
    runId
  });
  recordQueueMetric("red_check.completed", {
    found: redLogs.length,
    logged,
    skipped,
    failed: errors.length
  });

  if (errors.length > 0) {
    // Tidak ditelan: withRetry menerima error ini dan menulis status FAILED.
    throw new Error(`Cek MERAH gagal untuk ${errors.length} pasien: ${errors.join("; ")}`);
  }

  return { found: redLogs.length, logged, skipped, errors, dedupeKeys };
}

export async function runAllAgents(): Promise<OrchestratorRun> {
  const runId = `run-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const startedAt = new Date().toISOString();
  const outcomes: AgentOutcome[] = [];
  let fatalError = "";

  try {
    outcomes.push(await runAgentStep("RME_ANALYZER", runAnalyzer, runId));
    outcomes.push(await runAgentStep("AUTO_REPORTER", () => runReporter(), runId));
    outcomes.push(await runAgentStep("SECURITY_GUARD", runSecurityGuard, runId));
    outcomes.push(await runAgentStep("PATIENT_ENGAGEMENT", runEngagement, runId));
    outcomes.push(await runAgentStep("BUG_HUNTER", () => runBugHunter(), runId));
    outcomes.push(
      await runAgentStep("URGENT_CALLER", async () => (await checkRedPatients(runId)).logged, runId)
    );

    const status = deriveRunStatus(outcomes);
    const errorSummary = outcomes
      .filter((outcome) => outcome.status === "FAILED")
      .map((outcome) => `${outcome.name}: ${outcome.detail}`);
    return {
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      status,
      outcomes,
      errorSummary
    };
  } catch (error) {
    fatalError = (error as Error).message;
    throw error;
  } finally {
    // Terminal log selalu ditulis, termasuk saat exception tak terduga.
    const status = fatalError ? "FAILED" : deriveRunStatus(outcomes);
    const errorSummary = [
      ...outcomes
        .filter((outcome) => outcome.status === "FAILED")
        .map((outcome) => `${outcome.name}: ${outcome.detail}`),
      ...(fatalError ? [`ORCHESTRATOR: ${fatalError}`] : [])
    ];
    await writeAgentLog({
      agentName: "ORCHESTRATOR",
      status,
      message: `Run ${runId} selesai: ${outcomes.filter((outcome) => outcome.status === "SUCCESS").length}/${outcomes.length} agent sukses (${status})`,
      payload: JSON.stringify({
        status,
        outcomes: outcomes.map(({ name, status: agentStatus, attempts, detail }) => ({
          name,
          status: agentStatus,
          attempts,
          detail: detail.slice(0, 500)
        })),
        errorSummary
      }),
      runId
    });
    recordQueueMetric("orchestrator.run_completed", {
      status,
      succeeded: outcomes.filter((outcome) => outcome.status === "SUCCESS").length,
      failed: outcomes.filter((outcome) => outcome.status === "FAILED").length
    });
  }
}

interface SchedulerState {
  tasks: ScheduledTask[];
  owner: SchedulerCandidate | null;
}

function schedulerState(): SchedulerState {
  const globalState = globalThis as typeof globalThis & {
    [SCHEDULER_GLOBAL_KEY]?: SchedulerState;
  };
  if (!globalState[SCHEDULER_GLOBAL_KEY]) {
    globalState[SCHEDULER_GLOBAL_KEY] = { tasks: [], owner: null };
  }
  return globalState[SCHEDULER_GLOBAL_KEY] as SchedulerState;
}

function watchFireAndForget(label: string, task: () => Promise<unknown>): void {
  void Promise.resolve()
    .then(task)
    .catch((error: Error) => {
      logger.error("scheduler.task_failed", { task: label, error: error.message.slice(0, 500) });
      recordQueueMetric("scheduler.task_failed", { task: label });
    });
}

function startSchedulerFor(candidate: SchedulerCandidate): ScheduledTask[] {
  const state = schedulerState();
  if (state.tasks.length > 0 || state.owner) {
    logger.info("scheduler.already_started", { owner: state.owner });
    return state.tasks;
  }
  if (!shouldOwnScheduler(candidate)) {
    recordQueueMetric("scheduler.skipped", { candidate });
    return [];
  }

  const allAgentsCron = process.env.CRON_ALL_AGENTS || "0 7,12,18,22 * * *";
  const redCheckCron = process.env.CRON_RED_CHECK || "*/5 * * * *";
  if (!cron.validate(allAgentsCron) || !cron.validate(redCheckCron)) {
    logger.error("scheduler.invalid_cron", { allAgentsCron, redCheckCron });
    recordQueueMetric("scheduler.invalid_cron");
    return [];
  }

  state.tasks = [
    cron.schedule(allAgentsCron, () => watchFireAndForget("runAllAgents", runAllAgents), {
      timezone: "Asia/Jakarta"
    }),
    cron.schedule(
      redCheckCron,
      () =>
        watchFireAndForget("checkRedPatients", () =>
          checkRedPatients(`red-${Date.now()}-${randomBytes(3).toString("hex")}`)
        ),
      { timezone: "Asia/Jakarta" }
    )
  ];
  state.owner = candidate;
  logger.info("scheduler.started", { owner: candidate, allAgentsCron, redCheckCron });
  recordQueueMetric("scheduler.started", { owner: candidate });
  return state.tasks;
}

/** Owner cron proses web (hanya saat queue memory/sync pada mode auto). */
export function startScheduler(): ScheduledTask[] {
  return startSchedulerFor("web");
}

/** Owner cron proses worker (hanya saat BullMQ/Redis aktif pada mode auto). */
export function startWorkerScheduler(): ScheduledTask[] {
  return startSchedulerFor("worker");
}

export function stopScheduler(): void {
  const state = schedulerState();
  for (const task of state.tasks) task.stop();
  state.tasks = [];
  state.owner = null;
  recordQueueMetric("scheduler.stopped");
}

/** Proses yang sedang memegang cron (null = tidak ada). */
export function getSchedulerOwnerProcess(): SchedulerCandidate | null {
  return schedulerState().owner;
}

/** Reset state cron/claim dedupe (dipakai tes deterministik). */
export function resetSchedulerForTests(): void {
  stopScheduler();
  resetUrgentDedupeCache();
}

// Re-export untuk penempatan helper dedupe yang nyaman di test/caller lain.
export {
  buildUrgentDedupeKey,
  claimUrgentWindow,
  isUrgentWindowClaimed,
  releaseUrgentWindow,
  resetUrgentDedupeCache,
  urgentDedupeWindowMs
};
