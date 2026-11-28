import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentLogCreate: vi.fn(),
  triageFindMany: vi.fn(),
  triageCount: vi.fn(),
  urgentCallCount: vi.fn(),
  urgentRun: vi.fn(),
  analyzer: vi.fn(),
  reporter: vi.fn(),
  security: vi.fn(),
  engagement: vi.fn(),
  bugHunter: vi.fn(),
  cronSchedule: vi.fn(),
  cronValidate: vi.fn(),
  disconnect: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerDebug: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentLog: { create: (...args: unknown[]) => mocks.agentLogCreate(...args) },
    triageLog: {
      findMany: (...args: unknown[]) => mocks.triageFindMany(...args),
      count: (...args: unknown[]) => mocks.triageCount(...args)
    },
    urgentCall: { count: (...args: unknown[]) => mocks.urgentCallCount(...args) },
    $disconnect: (...args: unknown[]) => mocks.disconnect(...args)
  }
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: (...args: unknown[]) => mocks.loggerInfo(...args),
    warn: (...args: unknown[]) => mocks.loggerWarn(...args),
    error: (...args: unknown[]) => mocks.loggerError(...args),
    debug: (...args: unknown[]) => mocks.loggerDebug(...args)
  },
  logEvent: vi.fn()
}));

vi.mock("@/agents/analyzer", () => ({
  runAnalyzer: (...args: unknown[]) => mocks.analyzer(...args)
}));
vi.mock("@/agents/reporter", () => ({
  runReporter: (...args: unknown[]) => mocks.reporter(...args)
}));
vi.mock("@/agents/securityGuard", () => ({
  runSecurityGuard: (...args: unknown[]) => mocks.security(...args)
}));
vi.mock("@/agents/engagement", () => ({
  runEngagement: (...args: unknown[]) => mocks.engagement(...args)
}));
vi.mock("@/agents/bugHunter", () => ({
  runBugHunter: (...args: unknown[]) => mocks.bugHunter(...args)
}));
vi.mock("@/agents/urgentCaller", () => ({
  runUrgentTriage: (...args: unknown[]) => mocks.urgentRun(...args),
  executeUrgentFollowUp: vi.fn()
}));
vi.mock("node-cron", () => ({
  default: {
    schedule: (...args: unknown[]) => mocks.cronSchedule(...args),
    validate: (...args: unknown[]) => mocks.cronValidate(...args)
  }
}));

import {
  buildUrgentDedupeKey,
  checkRedPatients,
  deriveRunStatus,
  getSchedulerOwnerProcess,
  isAgentEnabled,
  resetSchedulerForTests,
  runAllAgents,
  startScheduler,
  startWorkerScheduler,
  stopScheduler
} from "../agents/orchestrator";
import { resetQueueMetricsForTests } from "../lib/queue";

const envKeys = [
  "SYNC_MODE",
  "LOG_LEVEL",
  "QUEUE_MODE",
  "REDIS_URL",
  "ENABLE_SCHEDULER",
  "SCHEDULER_OWNER",
  "CRON_ALL_AGENTS",
  "CRON_RED_CHECK",
  "URGENT_DEDUPE_WINDOW_MINUTES",
  "QUEUE_MAX_ATTEMPTS",
  "QUEUE_BACKOFF_DELAY_MS",
  "FEATURE_ANALYZER",
  "FEATURE_REPORTER",
  "FEATURE_SECURITY_GUARD",
  "FEATURE_ENGAGEMENT",
  "FEATURE_BUG_HUNTER",
  "FEATURE_URGENT_CALLER"
] as const;

const originalEnv = new Map<string, string | undefined>(
  envKeys.map((key) => [key, process.env[key]])
);

interface AgentLogCall {
  data: {
    agentName: string;
    status: string;
    message?: string;
    payload?: string;
    runId?: string;
  };
}

function orchestratorLogs(): AgentLogCall[] {
  return mocks.agentLogCreate.mock.calls
    .map((call) => call[0] as AgentLogCall)
    .filter((call) => call.data.agentName === "ORCHESTRATOR");
}

function lastTerminalLog(): AgentLogCall {
  const logs = orchestratorLogs();
  return logs[logs.length - 1];
}

beforeEach(() => {
  for (const key of envKeys) delete process.env[key];
  process.env.SYNC_MODE = "true";
  process.env.LOG_LEVEL = "error";
  vi.clearAllMocks();
  resetSchedulerForTests();
  resetQueueMetricsForTests();
  mocks.cronValidate.mockReturnValue(true);
  mocks.cronSchedule.mockImplementation(() => ({ stop: vi.fn() }));
  mocks.agentLogCreate.mockResolvedValue({});
  mocks.triageFindMany.mockResolvedValue([]);
  mocks.triageCount.mockResolvedValue(0);
  mocks.urgentCallCount.mockResolvedValue(0);
  mocks.urgentRun.mockResolvedValue({
    level: "MERAH",
    triageLogId: "new-triage-log",
    dedupeKey: "dedupe-key",
    reasons: [],
    needsReview: false,
    stages: []
  });
  mocks.analyzer.mockResolvedValue({ analyzed: 1 });
  mocks.reporter.mockResolvedValue({ reportId: "r1" });
  mocks.security.mockResolvedValue({ syncMode: true });
  mocks.engagement.mockResolvedValue({ sent: 0 });
  mocks.bugHunter.mockResolvedValue({ findings: [] });
});

afterEach(() => {
  resetSchedulerForTests();
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("orchestrator: status run turunan hasil nyata", () => {
  it("menulis status SUCCESS hanya bila semua agent sukses", async () => {
    const run = await runAllAgents();

    expect(run.status).toBe("SUCCESS");
    expect(run.outcomes).toHaveLength(6);
    expect(run.outcomes.every((outcome) => outcome.status === "SUCCESS")).toBe(true);
    expect(run.errorSummary).toEqual([]);

    const terminal = lastTerminalLog();
    expect(terminal.data.status).toBe("SUCCESS");
    expect(JSON.parse(terminal.data.payload ?? "{}").outcomes).toHaveLength(6);
  });

  it("menulis PARTIAL + ringkasan error saat sebagian agent gagal", async () => {
    mocks.analyzer.mockRejectedValue(new Error("analyzer down"));
    mocks.security.mockRejectedValue(new Error("security down"));

    const run = await runAllAgents();

    expect(run.status).toBe("PARTIAL");
    expect(run.outcomes.find((outcome) => outcome.name === "RME_ANALYZER")?.status).toBe("FAILED");
    expect(run.outcomes.find((outcome) => outcome.name === "AUTO_REPORTER")?.status).toBe(
      "SUCCESS"
    );
    expect(run.errorSummary.join(" ")).toContain("analyzer down");
    expect(run.errorSummary.join(" ")).toContain("security down");
    expect(mocks.analyzer).toHaveBeenCalledTimes(3);
    expect(lastTerminalLog().data.status).toBe("PARTIAL");
  });

  it("menulis FAILED bila semua agent gagal (termasuk agent critical)", async () => {
    mocks.analyzer.mockRejectedValue(new Error("analyzer down"));
    mocks.reporter.mockRejectedValue(new Error("reporter down"));
    mocks.security.mockRejectedValue(new Error("security down"));
    mocks.engagement.mockRejectedValue(new Error("engagement down"));
    mocks.bugHunter.mockRejectedValue(new Error("bug hunter down"));
    mocks.triageFindMany.mockResolvedValue([
      { id: "source-1", patientId: "p1", visitId: "v1", createdAt: new Date(Date.now() - 60_000) }
    ]);
    mocks.urgentRun.mockRejectedValue(new Error("caller down"));

    const run = await runAllAgents();

    expect(run.status).toBe("FAILED");
    expect(run.errorSummary).toHaveLength(6);
    expect(deriveRunStatus(run.outcomes)).toBe("FAILED");
    expect(lastTerminalLog().data.status).toBe("FAILED");
  });

  it("melewati agent yang dinonaktifkan feature flag", async () => {
    process.env.FEATURE_ANALYZER = "false";
    expect(isAgentEnabled("RME_ANALYZER")).toBe(false);

    const run = await runAllAgents();

    expect(mocks.analyzer).not.toHaveBeenCalled();
    expect(run.outcomes.find((outcome) => outcome.name === "RME_ANALYZER")?.status).toBe("SKIPPED");
    expect(run.status).toBe("SUCCESS");
    expect(lastTerminalLog().data.status).toBe("SUCCESS");
  });
});

describe("orchestrator: dedupe panggilan MERAH", () => {
  const redLog = () => [
    {
      id: "source-1",
      patientId: "p1",
      visitId: "v1",
      createdAt: new Date(Date.now() - 4 * 60_000)
    }
  ];

  it("tidak memanggil ulang bila sudah ada urgent call dalam window", async () => {
    mocks.triageFindMany.mockResolvedValue(redLog());
    mocks.urgentCallCount.mockResolvedValue(1);

    const result = await checkRedPatients("run-dedupe-1");

    expect(result.logged).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mocks.urgentRun).not.toHaveBeenCalled();
  });

  it("tidak mengantri ulang bila triage record baru sudah dibuat caller", async () => {
    mocks.triageFindMany.mockResolvedValue(redLog());
    mocks.triageCount.mockResolvedValue(1);

    const result = await checkRedPatients("run-dedupe-2");

    expect(result.logged).toBe(0);
    expect(mocks.urgentRun).not.toHaveBeenCalled();
    expect(mocks.triageCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: "source-1" } })
      })
    );
  });

  it("klaim window mencegah dua check berurutan memanggil pasien yang sama", async () => {
    mocks.triageFindMany.mockResolvedValue(redLog());

    const first = await checkRedPatients("run-dedupe-3");
    const second = await checkRedPatients("run-dedupe-4");

    expect(first.logged).toBe(1);
    expect(second.logged).toBe(0);
    expect(second.skipped).toBe(1);
    expect(mocks.urgentRun).toHaveBeenCalledTimes(1);
    expect(mocks.urgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ORCHESTRATOR_RED_CHECK", dedupeKey: expect.any(String) })
    );
  });

  it("kunci dedupe stabil dalam window dan berubah di window berikutnya", () => {
    process.env.URGENT_DEDUPE_WINDOW_MINUTES = "15";
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    const first = buildUrgentDedupeKey("p1", "MERAH", base);
    expect(buildUrgentDedupeKey("p1", "MERAH", base + 59_000)).toBe(first);
    expect(buildUrgentDedupeKey("P1", "merah", base + 59_000)).toBe(first);
    expect(buildUrgentDedupeKey("p1", "MERAH", base + 16 * 60_000)).not.toBe(first);
    expect(buildUrgentDedupeKey("p2", "MERAH", base)).not.toBe(first);
  });
});

describe("orchestrator: cron single-owner dan shutdown", () => {
  it("hanya web yang menyalakan cron saat queue memory/sync", () => {
    process.env.ENABLE_SCHEDULER = "true";
    process.env.SCHEDULER_OWNER = "auto";
    process.env.QUEUE_MODE = "sync";

    expect(startScheduler()).toHaveLength(2);
    // Jalur worker tidak boleh membuat cron kedua; ia hanya melihat task yang
    // sudah dipegang web dan tidak mengubah owner.
    expect(startWorkerScheduler()).toHaveLength(2);
    expect(getSchedulerOwnerProcess()).toBe("web");
    expect(mocks.cronSchedule).toHaveBeenCalledTimes(2);
  });

  it("hanya worker yang menyalakan cron saat queue redis", () => {
    process.env.ENABLE_SCHEDULER = "true";
    process.env.QUEUE_MODE = "redis";
    process.env.REDIS_URL = "redis://127.0.0.1:6379";

    expect(startScheduler()).toHaveLength(0);
    expect(getSchedulerOwnerProcess()).toBeNull();
    expect(startWorkerScheduler()).toHaveLength(2);
    expect(getSchedulerOwnerProcess()).toBe("worker");
    stopScheduler();
    expect(mocks.cronSchedule.mock.calls[0][2]).toEqual({ timezone: "Asia/Jakarta" });
  });

  it("SCHEDULER_OWNER=none mematikan kedua jalur cron", () => {
    process.env.ENABLE_SCHEDULER = "true";
    process.env.SCHEDULER_OWNER = "none";

    expect(startScheduler()).toHaveLength(0);
    expect(startWorkerScheduler()).toHaveLength(0);
    expect(mocks.cronSchedule).not.toHaveBeenCalled();
  });

  it("callback cron menangkap error fire-and-forget dengan logger", async () => {
    process.env.ENABLE_SCHEDULER = "true";
    process.env.QUEUE_MODE = "sync";
    mocks.triageFindMany.mockRejectedValue(new Error("db down"));
    startScheduler();

    const redCheckCallback = mocks.cronSchedule.mock.calls[1][1] as () => void;
    redCheckCallback();

    await vi.waitFor(() => {
      expect(
        mocks.loggerError.mock.calls.some(
          ([event, fields]) =>
            event === "scheduler.task_failed" &&
            (fields as { task?: string } | undefined)?.task === "checkRedPatients"
        )
      ).toBe(true);
    });
  });

  it("shutdown worker berhenti rapi tanpa process.exit(0) paksa", async () => {
    process.env.QUEUE_MODE = "sync";
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit tidak boleh dipanggil saat shutdown");
    }) as never);
    const previousExitCode = process.exitCode;
    try {
      const { resetWorkerShutdownForTests, shutdownWorker } =
        await import("../scripts/queue-worker");
      resetWorkerShutdownForTests();
      const stop = vi.fn();
      const close = vi.fn(async () => undefined);
      const disconnect = vi.fn(async () => undefined);

      await shutdownWorker("SIGTERM", null, {
        stopScheduler: stop,
        closeConnections: close,
        disconnect
      });

      expect(stop).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledWith(null);
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
      resetWorkerShutdownForTests();
    } finally {
      exitSpy.mockRestore();
      process.exitCode = previousExitCode;
    }
  });
});
