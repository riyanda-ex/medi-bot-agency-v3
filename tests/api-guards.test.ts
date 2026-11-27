import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetServerSession = vi.fn();
const mockAuditApiAccess = vi.fn();
const mockEnforceRateLimit = vi.fn();
const mockEnforceSameOrigin = vi.fn();
const mockGetClientIp = vi.fn(() => "127.0.0.1");

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
vi.mock("@/agents/urgentCaller", () => ({
  runUrgentTriage: vi.fn(async () => ({ level: "MERAH", triageLogId: "t1" }))
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: { findUnique: vi.fn(async () => ({ id: "p1", name: "Budi" })) },
    visit: { create: vi.fn(async () => ({ id: "v1" })) }
  }
}));

import { POST as triagePost } from "../app/api/triage/route";

describe("API guard behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceSameOrigin.mockReturnValue(null);
    mockEnforceRateLimit.mockResolvedValue(null);
    mockAuditApiAccess.mockResolvedValue(undefined);
  });

  it("triage rejects invalid session/role", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", role: "RESEPSIONIS" } });
    const req = new Request("http://localhost/api/triage", {
      method: "POST",
      body: JSON.stringify({})
    });
    const res = await triagePost(req);
    expect(res.status).toBe(403);
  });

  it("triage rejects bad payload", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "u1", role: "DOKTER" } });
    const req = new Request("http://localhost/api/triage", {
      method: "POST",
      body: JSON.stringify({})
    });
    const res = await triagePost(req);
    expect(res.status).toBe(400);
  });
});
