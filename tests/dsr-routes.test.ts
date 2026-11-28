import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.fn();
const mockAudit = vi.fn();
const mockDsrCreate = vi.fn();
const mockDsrFindFirst = vi.fn();
const mockDsrFindMany = vi.fn();
const mockDsrFindUnique = vi.fn();
const mockDsrUpdate = vi.fn();
const mockPatientFindUnique = vi.fn();
const mockPatientUpdate = vi.fn();

vi.mock("@/auth", () => ({ auth: (...args: unknown[]) => mockAuth(...args) }));
vi.mock("@/lib/audit", () => ({
  auditApiAccess: (...args: unknown[]) => mockAudit(...args),
  getRequestIp: () => "127.0.0.1"
}));
vi.mock("@/lib/requestGuard", () => ({
  enforceBodySize: vi.fn(async (request: Request) => ({ response: null, request })),
  enforceRateLimit: vi.fn(async () => null),
  enforceSameOrigin: vi.fn(() => null),
  getClientIp: vi.fn(() => "127.0.0.1")
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    dataSubjectRequest: {
      create: (...args: unknown[]) => mockDsrCreate(...args),
      findFirst: (...args: unknown[]) => mockDsrFindFirst(...args),
      findMany: (...args: unknown[]) => mockDsrFindMany(...args),
      findUnique: (...args: unknown[]) => mockDsrFindUnique(...args),
      update: (...args: unknown[]) => mockDsrUpdate(...args)
    },
    patient: {
      findUnique: (...args: unknown[]) => mockPatientFindUnique(...args),
      update: (...args: unknown[]) => mockPatientUpdate(...args)
    },
    apiLog: { create: vi.fn(async () => ({})) }
  }
}));

import { GET as dsrGet, POST as dsrPost } from "../app/api/me/privacy-requests/route";
import { PATCH as dsrPatch } from "../app/api/privacy-requests/[id]/route";

function session(role: string, patientId?: string) {
  return { user: { id: role === "ADMIN" ? "admin-1" : "user-1", role, patientId } };
}

function request(method: string, body?: unknown): Request {
  return new Request("http://localhost/api/me/privacy-requests", {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

describe("tiket hak subjek data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAudit.mockResolvedValue(undefined);
    mockDsrFindFirst.mockResolvedValue(null);
    mockDsrFindMany.mockResolvedValue([]);
    mockPatientUpdate.mockResolvedValue({});
    mockPatientFindUnique.mockResolvedValue({ anonymizedAt: null });
  });

  it("pasien mengajukan tiket dengan SLA 72 jam", async () => {
    mockAuth.mockResolvedValue(session("PASIEN", "p1"));
    mockDsrCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "dsr-1",
      type: data.type,
      status: data.status,
      requestedAt: data.requestedAt,
      dueAt: data.dueAt
    }));
    const response = await dsrPost(request("POST", { type: "COPY", notes: "Perlu salinan rekam" }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.slaHours).toBe(72);
    expect(mockDsrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          patientId: "p1",
          type: "COPY",
          status: "PENDING",
          openKey: "p1:COPY"
        })
      })
    );
  });

  it("duplikat konkuren ditolak oleh kunci unik tiket aktif", async () => {
    mockAuth.mockResolvedValue(session("PASIEN", "p1"));
    mockDsrCreate.mockRejectedValue({ code: "P2002" });
    const response = await dsrPost(request("POST", { type: "COPY", notes: "Perlu salinan rekam" }));
    expect(response.status).toBe(409);
    expect(mockPatientUpdate).not.toHaveBeenCalled();
  });

  it("permintaan penghapusan mencatat deletionRequestedAt", async () => {
    mockAuth.mockResolvedValue(session("PASIEN", "p1"));
    mockDsrCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "dsr-2",
      type: data.type,
      status: data.status,
      requestedAt: data.requestedAt,
      dueAt: data.dueAt
    }));
    await dsrPost(request("POST", { type: "DELETION", notes: "Consent dicabut pasien" }));
    expect(mockPatientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({ deletionReason: "Consent dicabut pasien" })
      })
    );
  });

  it("ADMIN menutup tiket dan mencatat audit", async () => {
    mockAuth.mockResolvedValue(session("ADMIN"));
    mockDsrFindUnique.mockResolvedValue({
      id: "dsr-1",
      patientId: "p1",
      status: "PENDING",
      dueAt: new Date("2026-01-04T00:00:00Z")
    });
    mockDsrUpdate.mockResolvedValue({
      id: "dsr-1",
      patientId: "p1",
      status: "APPROVED",
      dueAt: new Date("2026-01-04T00:00:00Z")
    });
    const response = await dsrPatch(
      request("PATCH", { status: "APPROVED", notes: "Identitas terverifikasi" }),
      { params: Promise.resolve({ id: "dsr-1" }) }
    );
    expect(response.status).toBe(200);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "DSR_STATUS_UPDATED", targetPatientId: "p1" })
    );
  });

  it("status terminal membebaskan kunci unik tiket aktif", async () => {
    mockAuth.mockResolvedValue(session("ADMIN"));
    mockDsrFindUnique.mockResolvedValue({
      id: "dsr-1",
      patientId: "p1",
      status: "APPROVED",
      dueAt: new Date("2026-01-04T00:00:00Z")
    });
    mockDsrUpdate.mockResolvedValue({
      id: "dsr-1",
      patientId: "p1",
      status: "REJECTED",
      dueAt: new Date("2026-01-04T00:00:00Z")
    });
    const response = await dsrPatch(
      request("PATCH", { status: "REJECTED", notes: "Dokumen tidak lengkap" }),
      { params: Promise.resolve({ id: "dsr-1" }) }
    );
    expect(response.status).toBe(200);
    expect(mockDsrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "REJECTED", openKey: null })
      })
    );
  });

  it("tiket penghapusan tidak boleh ditutup tanpa bukti anonimisasi", async () => {
    mockAuth.mockResolvedValue(session("ADMIN"));
    mockDsrFindUnique.mockResolvedValue({
      id: "dsr-3",
      patientId: "p1",
      type: "DELETION",
      status: "APPROVED",
      dueAt: new Date("2026-01-04T00:00:00Z")
    });
    const response = await dsrPatch(
      request("PATCH", { status: "COMPLETED", notes: "Sudah dihapus" }),
      { params: Promise.resolve({ id: "dsr-3" }) }
    );
    expect(response.status).toBe(409);
    expect(mockDsrUpdate).not.toHaveBeenCalled();
  });

  it("tiket penghapusan dapat ditutup setelah anonimisasi tercatat", async () => {
    mockAuth.mockResolvedValue(session("ADMIN"));
    mockDsrFindUnique.mockResolvedValue({
      id: "dsr-3",
      patientId: "p1",
      type: "DELETION",
      status: "APPROVED",
      dueAt: new Date("2026-01-04T00:00:00Z")
    });
    mockPatientFindUnique.mockResolvedValue({ anonymizedAt: new Date("2026-01-03T00:00:00Z") });
    mockDsrUpdate.mockResolvedValue({
      id: "dsr-3",
      patientId: "p1",
      type: "DELETION",
      status: "COMPLETED",
      dueAt: new Date("2026-01-04T00:00:00Z")
    });
    const response = await dsrPatch(
      request("PATCH", { status: "COMPLETED", notes: "Anonimisasi terverifikasi" }),
      { params: Promise.resolve({ id: "dsr-3" }) }
    );
    expect(response.status).toBe(200);
    expect(mockDsrUpdate).toHaveBeenCalled();
  });

  it("non-ADMIN tidak dapat memverifikasi tiket", async () => {
    mockAuth.mockResolvedValue(session("PERAWAT"));
    const response = await dsrPatch(request("PATCH", { status: "APPROVED" }), {
      params: Promise.resolve({ id: "dsr-1" })
    });
    expect(response.status).toBe(403);
  });

  it("pasien melihat tiketnya sendiri", async () => {
    mockAuth.mockResolvedValue(session("PASIEN", "p1"));
    const response = await dsrGet(request("GET"));
    expect(response.status).toBe(200);
    expect(mockDsrFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { patientId: "p1" } })
    );
  });
});
