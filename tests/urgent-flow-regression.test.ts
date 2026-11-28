import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<{ id: string; data: Record<string, unknown> }>,
  queuedRow: null as { id: string } | null,
  logs: [] as Array<Record<string, unknown>>
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: {
      findUnique: async () => ({ id: "p1", name: "Sari", phoneEncrypted: "encrypted" })
    },
    urgentCall: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `call-${state.created.length + 1}`, ...data };
        state.created.push(data);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        state.updated.push({ id: where.id, data });
        return { id: where.id, ...data };
      },
      findFirst: async () => state.queuedRow
    }
  }
}));

vi.mock("@/lib/crypto", () => ({ decryptField: () => "081234567890" }));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsApp: vi.fn(),
  isOutboundAllowed: vi.fn(() => true)
}));
vi.mock("@/lib/phone", () => ({ callPatient: vi.fn() }));
vi.mock("@/lib/agentLog", () => ({
  writeAgentLog: async (input: Record<string, unknown>) => {
    state.logs.push(input);
  }
}));
vi.mock("@/lib/queue", () => ({
  buildUrgentJobId: vi.fn(() => "job-1"),
  enqueueJob: vi.fn(async () => ({ mode: "sync" })),
  isQueueEnabled: vi.fn(() => false)
}));
vi.mock("@/lib/approval", () => ({ verifyApproval: vi.fn() }));
vi.mock("@/lib/env", () => ({ requireHumanApproval: () => true }));

import { executeUrgentFollowUp } from "../agents/urgentCaller";
import { sendWhatsApp } from "../lib/whatsapp";
import { callPatient } from "../lib/phone";
import { verifyApproval } from "../lib/approval";

const approved = { ok: true, reason: "Approval valid.", approverId: "doc-1" };

beforeEach(() => {
  state.created.length = 0;
  state.updated.length = 0;
  state.logs.length = 0;
  state.queuedRow = null;
  vi.mocked(sendWhatsApp).mockReset();
  vi.mocked(callPatient).mockReset();
  vi.mocked(verifyApproval).mockReset();
  vi.mocked(verifyApproval).mockResolvedValue(approved);
});

describe("Regresi follow-up MERAH", () => {
  it("flag simulated mengikuti hasil provider, bukan mode approval", async () => {
    vi.mocked(sendWhatsApp).mockResolvedValue({
      ok: true,
      simulated: false,
      provider: "fonnte",
      detail: "WA terkirim"
    });
    vi.mocked(callPatient).mockResolvedValue({
      ok: true,
      simulated: false,
      provider: "twilio",
      detail: "Panggilan tersambung"
    });

    const stages = await executeUrgentFollowUp({
      patientId: "p1",
      triageLogId: "t1",
      approvalId: "apr-1",
      simulate: false
    });

    expect(stages).toHaveLength(4);
    expect(state.created).toHaveLength(4);
    expect(state.created[0]).toMatchObject({
      channel: "WHATSAPP",
      status: "SENT",
      simulated: false,
      provider: "fonnte",
      approvedBy: "doc-1"
    });
    expect(state.created[1]).toMatchObject({ channel: "CALL", status: "SENT", simulated: false });
    expect(state.created[3]).toMatchObject({ channel: "ESCALATION", status: "ESCALATED" });
    expect(vi.mocked(verifyApproval)).toHaveBeenCalledTimes(4);
    expect(vi.mocked(verifyApproval)).toHaveBeenCalledWith(
      "apr-1",
      "URGENT",
      "t1",
      expect.objectContaining({ channel: "WHATSAPP" })
    );
  });

  it("mode simulasi tetap tercatat simulated=true dan tidak memanggil provider", async () => {
    await executeUrgentFollowUp({ patientId: "p1", triageLogId: "t1", simulate: true });

    expect(vi.mocked(sendWhatsApp)).not.toHaveBeenCalled();
    expect(vi.mocked(callPatient)).not.toHaveBeenCalled();
    expect(vi.mocked(verifyApproval)).not.toHaveBeenCalled();
    expect(state.created.every((row) => row.simulated === true)).toBe(true);
    expect(state.created.every((row) => row.status === "SIMULATED")).toBe(true);
  });

  it("retry satu tahap memperbarui placeholder QUEUED tanpa duplikasi", async () => {
    state.queuedRow = { id: "queued-1" };
    vi.mocked(sendWhatsApp).mockResolvedValue({
      ok: true,
      simulated: true,
      provider: "mock",
      detail: "mock"
    });

    await executeUrgentFollowUp({
      patientId: "p1",
      triageLogId: "t1",
      stageOffset: 10,
      simulate: true
    });

    expect(state.updated).toHaveLength(1);
    expect(state.updated[0]).toMatchObject({ id: "queued-1" });
    expect(state.created).toHaveLength(0);
  });

  it("kegagalan sebagian tahap menghasilkan status agent PARTIAL", async () => {
    vi.mocked(sendWhatsApp).mockResolvedValue({
      ok: false,
      simulated: false,
      provider: "fonnte",
      detail: "gagal"
    });
    vi.mocked(callPatient).mockResolvedValue({
      ok: true,
      simulated: false,
      provider: "twilio",
      detail: "ok"
    });

    const stages = await executeUrgentFollowUp({
      patientId: "p1",
      triageLogId: "t1",
      approvalId: "apr-1",
      simulate: false
    });

    expect(stages[0]).toMatchObject({ status: "FAILED" });
    expect(state.logs.at(-1)).toMatchObject({ agentName: "URGENT_CALLER", status: "PARTIAL" });
  });
});
