import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  patientFindUnique: vi.fn(),
  urgentCallCreate: vi.fn(),
  agentLogCreate: vi.fn(),
  decryptField: vi.fn(),
  sendWhatsApp: vi.fn(),
  callPatient: vi.fn(),
  verifyApproval: vi.fn(),
  approvalAllowsChannel: vi.fn(),
  isOutboundAllowed: vi.fn(),
  requireHumanApproval: vi.fn(),
  enqueueJob: vi.fn(),
  isQueueEnabled: vi.fn(),
  buildUrgentJobId: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: { findUnique: (...args: unknown[]) => mocks.patientFindUnique(...args) },
    urgentCall: { create: (...args: unknown[]) => mocks.urgentCallCreate(...args) },
    agentLog: { create: (...args: unknown[]) => mocks.agentLogCreate(...args) },
    approvalUse: { create: vi.fn(async () => ({})) }
  }
}));

vi.mock("@/lib/crypto", () => ({
  decryptField: (...args: unknown[]) => mocks.decryptField(...args)
}));

vi.mock("@/lib/whatsapp", () => ({
  sendWhatsApp: (...args: unknown[]) => mocks.sendWhatsApp(...args),
  isOutboundAllowed: (...args: unknown[]) => mocks.isOutboundAllowed(...args)
}));

vi.mock("@/lib/phone", () => ({
  callPatient: (...args: unknown[]) => mocks.callPatient(...args)
}));

vi.mock("@/lib/approval", () => ({
  verifyApproval: (...args: unknown[]) => mocks.verifyApproval(...args),
  approvalAllowsChannel: (...args: unknown[]) => mocks.approvalAllowsChannel(...args)
}));

vi.mock("@/lib/env", () => ({
  requireHumanApproval: (...args: unknown[]) => mocks.requireHumanApproval(...args)
}));

vi.mock("@/lib/agentLog", () => ({
  writeAgentLog: vi.fn()
}));

vi.mock("@/lib/queue", () => ({
  buildUrgentJobId: (...args: unknown[]) => mocks.buildUrgentJobId(...args),
  enqueueJob: (...args: unknown[]) => mocks.enqueueJob(...args),
  isQueueEnabled: (...args: unknown[]) => mocks.isQueueEnabled(...args)
}));

vi.mock("@/agents/urgentDedupe", () => ({
  buildUrgentDedupeKey: () => "dedupe-test"
}));

import { executeUrgentFollowUp } from "../agents/urgentCaller";

describe("consent gate pada tindak lanjut MERAH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decryptField.mockReturnValue("081234567890");
    mocks.sendWhatsApp.mockResolvedValue({ ok: true, detail: "TERKIRIM" });
    mocks.callPatient.mockResolvedValue({ ok: true, detail: "TERHUBUNG" });
    mocks.verifyApproval.mockResolvedValue({
      ok: true,
      reason: "Approval valid.",
      channels: ["WHATSAPP", "CALL", "ESCALATION"]
    });
    mocks.approvalAllowsChannel.mockImplementation(
      (verification: { ok: boolean; channels: string[] }, channel: string) =>
        verification.ok && verification.channels.includes(channel)
    );
    mocks.isOutboundAllowed.mockReturnValue(true);
    mocks.requireHumanApproval.mockReturnValue(true);
    mocks.isQueueEnabled.mockReturnValue(false);
    mocks.urgentCallCreate.mockImplementation(async ({ data }: { data: { id?: string } }) => ({
      id: data.id ?? "call-test"
    }));
  });

  it.each(["PENDING", "REVOKED", "REFUSED"])(
    "menolak outbound nyata bila consent = %s",
    async (consentStatus) => {
      mocks.patientFindUnique.mockResolvedValue({
        id: "patient-1",
        name: "Pasien Uji",
        phoneEncrypted: "cipher",
        consentStatus
      });

      const stages = await executeUrgentFollowUp({
        patientId: "patient-1",
        triageLogId: "triage-1",
        approvalId: "apr-test",
        simulate: false
      });

      expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
      expect(mocks.callPatient).not.toHaveBeenCalled();
      expect(stages.every((stage) => stage.status === "SIMULATED")).toBe(true);
    }
  );

  it("mengizinkan outbound nyata hanya bila consent GRANTED", async () => {
    mocks.patientFindUnique.mockResolvedValue({
      id: "patient-1",
      name: "Pasien Uji",
      phoneEncrypted: "cipher",
      consentStatus: "GRANTED"
    });

    const stages = await executeUrgentFollowUp({
      patientId: "patient-1",
      triageLogId: "triage-1",
      approvalId: "apr-test",
      simulate: false
    });

    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(1);
    expect(mocks.callPatient).toHaveBeenCalledTimes(2);
    expect(stages.some((stage) => stage.status === "SENT")).toBe(true);
  });

  it("hanya menjalankan kanal yang tercantum dalam approval", async () => {
    mocks.patientFindUnique.mockResolvedValue({
      id: "patient-1",
      name: "Pasien Uji",
      phoneEncrypted: "cipher",
      consentStatus: "GRANTED"
    });
    mocks.verifyApproval.mockResolvedValue({
      ok: true,
      reason: "Approval valid.",
      channels: ["WHATSAPP"]
    });

    await executeUrgentFollowUp({
      patientId: "patient-1",
      triageLogId: "triage-1",
      approvalId: "apr-test",
      simulate: false
    });

    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(1);
    expect(mocks.callPatient).not.toHaveBeenCalled();
  });

  it("tidak menghabiskan approval bila consent tidak aktif", async () => {
    mocks.patientFindUnique.mockResolvedValue({
      id: "patient-1",
      name: "Pasien Uji",
      phoneEncrypted: "cipher",
      consentStatus: "REVOKED"
    });

    await executeUrgentFollowUp({
      patientId: "patient-1",
      triageLogId: "triage-1",
      approvalId: "apr-test",
      simulate: false
    });

    expect(mocks.verifyApproval).not.toHaveBeenCalled();
  });

  it("tidak menghabiskan approval bila tidak ada kanal yang disetujui", async () => {
    mocks.patientFindUnique.mockResolvedValue({
      id: "patient-1",
      name: "Pasien Uji",
      phoneEncrypted: "cipher",
      consentStatus: "GRANTED"
    });
    mocks.verifyApproval.mockResolvedValue({
      ok: true,
      reason: "Approval valid.",
      channels: ["EMAIL"]
    });

    const stages = await executeUrgentFollowUp({
      patientId: "patient-1",
      triageLogId: "triage-1",
      approvalId: "apr-test",
      simulate: false
    });

    expect(mocks.verifyApproval).toHaveBeenCalledTimes(1);
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(mocks.callPatient).not.toHaveBeenCalled();
    expect(stages.every((stage) => stage.status === "SIMULATED")).toBe(true);
  });
});
