import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetServerSession = vi.fn();
const mockAuditApiAccess = vi.fn();
const mockEnforceRateLimit = vi.fn();
const mockEnforceSameOrigin = vi.fn();
const mockGetClientIp = vi.fn(() => "127.0.0.1");
const mockCreateApproval = vi.fn(async (..._args: unknown[]) => ({ approvalId: "ap1", scope: "URGENT", resourceId: "t1", expiresAt: "2099-01-01T00:00:00.000Z" }));
const mockRunReporter = vi.fn(async (..._args: unknown[]) => ({ reportId: "r1", data: { date: "2026-01-01", newPatients: 1, controls: 2, cancelled: 0, urgent: 1, pendingClaims: 0, visits7Days: [] }, files: {}, email: { ok: true } }));
const mockEnqueueJob = vi.fn(async (..._args: unknown[]) => ({ mode: "redis", jobId: "j1", detail: "queued" }));
const mockRunAllAgents = vi.fn(async (..._args: unknown[]) => ({ runId: "run1", outcomes: [] }));
const mockExecuteUrgentFollowUp = vi.fn(async (..._args: unknown[]) => [{ stage: 0 }]);

vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/audit", () => ({
  auditApiAccess: (...args: unknown[]) => mockAuditApiAccess(...args)
}));
vi.mock("@/lib/requestGuard", () => ({
  enforceRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...(args as [])),
  enforceSameOrigin: (...args: unknown[]) => mockEnforceSameOrigin(...(args as [])),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...(args as []))
}));
vi.mock("@/lib/agentLog", () => ({ writeAgentLog: vi.fn() }));
vi.mock("@/lib/approval", () => ({ createApproval: (...args: unknown[]) => mockCreateApproval(...args) }));
vi.mock("@/agents/reporter", () => ({ runReporter: (...args: unknown[]) => mockRunReporter(...args) }));
vi.mock("@/lib/queue", () => ({ enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args), buildUrgentJobId: () => "jid" }));
vi.mock("@/agents/orchestrator", () => ({ runAllAgents: (...args: unknown[]) => mockRunAllAgents(...args) }));
vi.mock("@/agents/urgentCaller", () => ({
  runUrgentTriage: vi.fn(async () => ({ level: "MERAH", triageLogId: "t1" })),
  executeUrgentFollowUp: (...args: unknown[]) => mockExecuteUrgentFollowUp(...args)
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: { findUnique: vi.fn(async () => ({ id: "p1", name: "Budi" })) },
    visit: { create: vi.fn(async () => ({ id: "v1" })) },
    triageLog: { findUnique: vi.fn(async () => ({ id: "t1", patientId: "p1", visitId: "v1" })) }
  }
}));

import { POST as triagePost } from "../app/api/triage/route";
import { POST as approvePost } from "../app/api/urgent/approve/route";
import { POST as simulatePost } from "../app/api/urgent/simulate/route";
import { POST as reportPost } from "../app/api/reports/generate/route";
import { POST as orchestratorPost } from "../app/api/orchestrator/run/route";
import { GET as healthGet } from "../app/api/health/route";

function session(role: string) {
  mockGetServerSession.mockResolvedValue({ user: { id: "u1", role, invalid: false } });
}

describe("API guard behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceSameOrigin.mockReturnValue(null);
    mockEnforceRateLimit.mockResolvedValue(null);
    mockAuditApiAccess.mockResolvedValue(undefined);
  });

  it("triage rejects invalid session/role", async () => {
    session("RESEPSIONIS");
    const req = new Request("http://localhost/api/triage", { method: "POST", body: JSON.stringify({}) });
    const res = await triagePost(req);
    expect(res.status).toBe(403);
  });

  it("triage rejects bad payload", async () => {
    session("DOKTER");
    const req = new Request("http://localhost/api/triage", { method: "POST", body: JSON.stringify({}) });
    const res = await triagePost(req);
    expect(res.status).toBe(400);
  });

  it("urgent approve rejects non-approver", async () => {
    session("PERAWAT");
    const req = new Request("http://localhost/api/urgent/approve", { method: "POST", body: JSON.stringify({ scope: "URGENT", resourceId: "t1", channels: ["WHATSAPP"] }) });
    const res = await approvePost(req);
    expect(res.status).toBe(403);
  });

  it("urgent approve creates approval for dokter", async () => {
    session("DOKTER");
    const req = new Request("http://localhost/api/urgent/approve", { method: "POST", body: JSON.stringify({ scope: "URGENT", resourceId: "t1", channels: ["WHATSAPP"] }) });
    const res = await approvePost(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approvalId).toBe("ap1");
  });

  it("urgent simulate rejects invalid role", async () => {
    session("RESEPSIONIS");
    const req = new Request("http://localhost/api/urgent/simulate", { method: "POST", body: JSON.stringify({ patientId: "p1" }) });
    const res = await simulatePost(req);
    expect(res.status).toBe(403);
  });

  it("urgent simulate queues for admin", async () => {
    session("ADMIN");
    const req = new Request("http://localhost/api/urgent/simulate", { method: "POST", body: JSON.stringify({ patientId: "p1" }) });
    const res = await simulatePost(req);
    expect(res.status).toBe(202);
  });

  it("report generate rejects invalid role", async () => {
    session("PASIEN");
    const req = new Request("http://localhost/api/reports/generate", { method: "POST", body: JSON.stringify({}) });
    const res = await reportPost(req);
    expect(res.status).toBe(403);
  });

  it("report generate works for admin", async () => {
    session("ADMIN");
    const req = new Request("http://localhost/api/reports/generate", { method: "POST", body: JSON.stringify({}) });
    const res = await reportPost(req);
    expect(res.status).toBe(200);
  });

  it("orchestrator run queues for admin", async () => {
    session("ADMIN");
    const req = new Request("http://localhost/api/orchestrator/run", { method: "POST" });
    const res = await orchestratorPost(req);
    expect([200, 202]).toContain(res.status);
  });

  it("health endpoint returns ok", async () => {
    const res = await healthGet(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});
