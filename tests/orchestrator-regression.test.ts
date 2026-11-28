import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  redLogs: [] as Array<{ id: string; patientId: string; visitId: string | null }>,
  callStatuses: [] as string[],
  checkedAgainCount: 0,
  countCalls: [] as Array<Record<string, unknown>>,
  urgentTriage: vi.fn(async (_input: unknown) => ({ ok: true })),
  reporter: vi.fn(async () => ({ status: "SUCCESS" })),
  logs: [] as Array<Record<string, unknown>>
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    triageLog: {
      findMany: async () =>
        state.redLogs.map((row) => ({ ...row, createdAt: new Date(Date.now() - 60_000) })),
      count: async ({ where }: { where: Record<string, unknown> }) => {
        state.countCalls.push(where);
        return state.checkedAgainCount;
      }
    },
    urgentCall: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        state.countCalls.push(where);
        const allowed = (where.status as { in?: string[] } | undefined)?.in ?? [];
        return state.callStatuses.filter((status) => allowed.includes(status)).length;
      }
    }
  }
}));

vi.mock("@/lib/agentLog", () => ({
  writeAgentLog: async (input: Record<string, unknown>) => {
    state.logs.push(input);
  }
}));

vi.mock("@/agents/analyzer", () => ({ runAnalyzer: vi.fn(async () => ({})) }));
vi.mock("@/agents/securityGuard", () => ({ runSecurityGuard: vi.fn(async () => ({})) }));
vi.mock("@/agents/engagement", () => ({ runEngagement: vi.fn(async () => ({})) }));
vi.mock("@/agents/bugHunter", () => ({ runBugHunter: vi.fn(async () => ({})) }));
vi.mock("@/agents/reporter", () => ({ runReporter: state.reporter }));
vi.mock("@/agents/urgentCaller", () => ({ runUrgentTriage: state.urgentTriage }));

import { checkRedPatients, runAllAgents } from "../agents/orchestrator";

beforeEach(() => {
  state.redLogs = [{ id: "t1", patientId: "p1", visitId: "v1" }];
  state.callStatuses = [];
  state.checkedAgainCount = 0;
  state.countCalls.length = 0;
  state.logs.length = 0;
  state.urgentTriage.mockClear();
  state.reporter.mockClear();
  state.reporter.mockResolvedValue({ status: "SUCCESS" } as never);
});

describe("Regresi alur MERAH orchestrator", () => {
  it("hanya status aktif yang dihitung sebagai sudah ditangani", async () => {
    await expect(checkRedPatients("run-1", "apr-1")).resolves.toEqual({ found: 1, logged: 1 });
    expect(state.countCalls[0]).toMatchObject({
      triageLogId: "t1",
      status: { in: ["QUEUED", "SENT", "ESCALATED"] }
    });
    expect(state.urgentTriage).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ORCHESTRATOR_RED_CHECK", approvalId: "apr-1" })
    );
  });

  it("log SIMULATED/FAILED tidak menekan tindak lanjut nyata", async () => {
    state.callStatuses = ["SIMULATED", "FAILED"];
    await expect(checkRedPatients("run-2")).resolves.toEqual({ found: 1, logged: 1 });
    expect(state.urgentTriage).toHaveBeenCalledTimes(1);
  });

  it("log QUEUED/SENT/ESCALATED mencegah duplikasi tindak lanjut", async () => {
    state.callStatuses = ["QUEUED"];
    await expect(checkRedPatients("run-3")).resolves.toEqual({ found: 1, logged: 0 });
    expect(state.urgentTriage).not.toHaveBeenCalled();
  });

  it("agen dengan efek samping tidak dijalankan ulang saat gagal", async () => {
    state.redLogs = [];
    state.reporter.mockRejectedValueOnce(new Error("email gagal"));
    state.reporter.mockResolvedValue({ status: "SUCCESS" } as never);

    const run = await runAllAgents();
    const reporterOutcome = run.outcomes.find((item) => item.name === "AUTO_REPORTER");

    expect(state.reporter).toHaveBeenCalledTimes(1);
    expect(reporterOutcome).toMatchObject({ attempts: 1, status: "FAILED" });
    expect(run.outcomes).toHaveLength(6);
  });

  it("status PARTIAL diteruskan ke hasil dan log run", async () => {
    state.redLogs = [];
    state.reporter.mockResolvedValue({ status: "PARTIAL" } as never);

    const run = await runAllAgents();
    const reporterOutcome = run.outcomes.find((item) => item.name === "AUTO_REPORTER");
    const orchestratorLog = state.logs.filter((item) => item.agentName === "ORCHESTRATOR").at(-1);

    expect(reporterOutcome).toMatchObject({ status: "PARTIAL" });
    expect(orchestratorLog).toMatchObject({ status: "PARTIAL" });
  });
});
