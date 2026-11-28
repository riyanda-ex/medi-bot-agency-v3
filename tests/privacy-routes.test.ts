import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.fn();
const mockAudit = vi.fn();
const mockPatientFindUnique = vi.fn();
const mockPatientUpdate = vi.fn();
const mockAuditFindMany = vi.fn();
const mockDsrCreate = vi.fn();
const mockDsrFindFirst = vi.fn();
const mockDsrUpdateMany = vi.fn();
const mockTransaction = vi.fn(async (operations: unknown[]) => Promise.all(operations));

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
vi.mock("@/lib/crypto", () => ({
  encryptPhi: (value: string) => `enc:${value}`,
  fieldHash: (value: string) => `hash:${value}`
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: {
      findUnique: (...args: unknown[]) => mockPatientFindUnique(...args),
      update: (...args: unknown[]) => mockPatientUpdate(...args)
    },
    auditLog: { findMany: (...args: unknown[]) => mockAuditFindMany(...args) },
    dataSubjectRequest: {
      create: (...args: unknown[]) => mockDsrCreate(...args),
      findFirst: (...args: unknown[]) => mockDsrFindFirst(...args),
      updateMany: (...args: unknown[]) => mockDsrUpdateMany(...args)
    },
    apiLog: { create: vi.fn(() => Promise.resolve()) },
    $transaction: (...args: unknown[]) => mockTransaction(...(args as [unknown[]]))
  }
}));

import { GET as consentGet, PUT as consentPut } from "../app/api/me/consent/route";
import { DELETE as privacyDelete } from "../app/api/patients/[id]/privacy/route";
import { GET as phiAuditGet } from "../app/api/audit/phi/route";

const consentRecord = {
  id: "p1",
  consentStatus: "PENDING",
  consentAt: null,
  consentRevokedAt: null,
  retentionUntil: null
};

function session(role: string, patientId = "p1", doctorId?: string) {
  return { user: { id: "u1", role, patientId, doctorId } };
}

function jsonRequest(url: string, body?: unknown, headers?: Record<string, string>): Request {
  return new Request(url, {
    method: body === undefined ? "GET" : "PUT",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

describe("consent route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPatientFindUnique.mockResolvedValue({ ...consentRecord, visits: [] });
    mockPatientUpdate.mockResolvedValue({
      ...consentRecord,
      consentStatus: "REVOKED",
      legalHold: false
    });
    mockDsrCreate.mockResolvedValue({ id: "dsr-1" });
    mockAudit.mockResolvedValue(undefined);
  });

  it("pasien hanya dapat membaca consent miliknya", async () => {
    mockAuth.mockResolvedValue(session("PASIEN", "p1"));
    const response = await consentGet(jsonRequest("http://localhost/api/me/consent"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ patientId: "p1" });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CONSENT_READ", targetPatientId: "p1" })
    );
  });

  it("pasien tidak dapat membaca consent pasien lain", async () => {
    mockAuth.mockResolvedValue(session("PASIEN", "p2"));
    const response = await consentGet(jsonRequest("http://localhost/api/me/consent?patientId=p1"));
    expect(response.status).toBe(403);
  });

  it("pencabutan consent menjadwalkan retensi", async () => {
    mockAuth.mockResolvedValue(session("PASIEN", "p1"));
    const response = await consentPut(
      jsonRequest("http://localhost/api/me/consent", { consent: "REVOKED" })
    );
    expect(response.status).toBe(200);
    const update = mockPatientUpdate.mock.calls[0]?.[0] as {
      data: { consentStatus: string; retentionUntil: Date };
    };
    expect(update.data.consentStatus).toBe("REVOKED");
    expect(update.data.retentionUntil.getTime()).toBeGreaterThan(Date.now());
    expect(mockDsrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ patientId: "p1", type: "CONSENT_WITHDRAWAL" })
      })
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CONSENT_REVOKED", targetPatientId: "p1" })
    );
  });

  it("retensi 25 tahun dihitung dari kunjungan terakhir", async () => {
    mockAuth.mockResolvedValue(session("PASIEN", "p1"));
    mockPatientFindUnique.mockResolvedValue({
      ...consentRecord,
      visits: [{ doctorId: "d1", visitDate: new Date("2026-01-01T00:00:00.000Z") }]
    });
    await consentPut(jsonRequest("http://localhost/api/me/consent", { consent: "REVOKED" }));
    const update = mockPatientUpdate.mock.calls[0]?.[0] as {
      data: { retentionUntil: Date };
    };
    expect(update.data.retentionUntil.getUTCFullYear()).toBe(2051);
  });

  it("pemberian ulang consent menghapus tenggat retensi lama", async () => {
    mockAuth.mockResolvedValue(session("PASIEN", "p1"));
    mockPatientFindUnique.mockResolvedValue({
      ...consentRecord,
      visits: [],
      retentionUntil: new Date("2001-01-01T00:00:00.000Z")
    });
    const response = await consentPut(
      jsonRequest("http://localhost/api/me/consent", { consent: "GRANTED" })
    );
    expect(response.status).toBe(200);
    const update = mockPatientUpdate.mock.calls[0]?.[0] as {
      data: { consentStatus: string; retentionUntil: Date | null };
    };
    expect(update.data.consentStatus).toBe("GRANTED");
    expect(update.data.retentionUntil).toBeNull();
  });
});

describe("privacy deletion route", () => {
  const params = { params: Promise.resolve({ id: "p1" }) };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAudit.mockResolvedValue(undefined);
    mockPatientFindUnique.mockResolvedValue({
      id: "p1",
      consentStatus: "REVOKED",
      consentRevokedAt: new Date("2000-01-01T00:00:00.000Z"),
      retentionUntil: new Date("2001-01-01T00:00:00.000Z"),
      legalHold: false,
      deletedAt: null
    });
    mockDsrFindFirst.mockResolvedValue({ id: "dsr-1", type: "DELETION", status: "APPROVED" });
    mockDsrUpdateMany.mockResolvedValue({ count: 1 });
  });

  function deleteRequest(headers: Record<string, string> = {}) {
    return new Request("http://localhost/api/patients/p1/privacy", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-confirm-privacy-delete": "p1",
        ...headers
      },
      body: JSON.stringify({ reason: "Pasien mencabut persetujuan" })
    });
  }

  it("non-ADMIN ditolak", async () => {
    mockAuth.mockResolvedValue(session("DOKTER", "p1", "d1"));
    const response = await privacyDelete(deleteRequest(), params);
    expect(response.status).toBe(403);
  });

  it("konfirmasi harus cocok dengan ID", async () => {
    mockAuth.mockResolvedValue(session("ADMIN", undefined));
    const response = await privacyDelete(
      deleteRequest({ "x-confirm-privacy-delete": "p2" }),
      params
    );
    expect(response.status).toBe(400);
  });

  it("menganonimisasi data setelah persetujuan dicabut", async () => {
    mockAuth.mockResolvedValue(session("ADMIN", undefined));
    const response = await privacyDelete(deleteRequest(), params);
    expect(response.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockPatientUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({
          nikMasked: "****",
          deletedAt: expect.any(Date),
          anonymizedAt: expect.any(Date)
        })
      })
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PATIENT_ANONYMIZED", targetPatientId: "p1" })
    );
    expect(mockDsrUpdateMany).toHaveBeenCalled();
  });

  it("menolak penghapusan saat legal hold aktif", async () => {
    mockAuth.mockResolvedValue(session("ADMIN", undefined));
    mockPatientFindUnique.mockResolvedValue({
      id: "p1",
      consentStatus: "REVOKED",
      consentRevokedAt: new Date("2000-01-01T00:00:00.000Z"),
      retentionUntil: new Date("2001-01-01T00:00:00.000Z"),
      legalHold: true,
      deletedAt: null
    });
    const response = await privacyDelete(deleteRequest(), params);
    expect(response.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("menolak penghapusan tanpa tiket terverifikasi", async () => {
    mockAuth.mockResolvedValue(session("ADMIN", undefined));
    mockDsrFindFirst.mockResolvedValue(null);
    const response = await privacyDelete(deleteRequest(), params);
    expect(response.status).toBe(409);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("menolak tiket yang sudah ditutup tanpa eksekusi anonimisasi", async () => {
    mockAuth.mockResolvedValue(session("ADMIN", undefined));
    mockDsrFindFirst.mockResolvedValue({ id: "dsr-1", type: "DELETION", status: "COMPLETED" });
    const response = await privacyDelete(deleteRequest(), params);
    expect(response.status).toBe(409);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe("PHI audit route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAudit.mockResolvedValue(undefined);
  });

  it("hanya ADMIN", async () => {
    mockAuth.mockResolvedValue(session("PERAWAT", "p1"));
    const response = await phiAuditGet(jsonRequest("http://localhost/api/audit/phi"));
    expect(response.status).toBe(403);
  });

  it("meredaksi NIK dalam detail audit", async () => {
    mockAuth.mockResolvedValue(session("ADMIN", undefined));
    mockAuditFindMany.mockResolvedValue([
      {
        id: "a1",
        actorId: "u1",
        action: "PHI_READ",
        role: "DOKTER",
        targetPatientId: "p1",
        ipAddress: "127.0.0.1",
        method: "GET",
        path: "/api/patients",
        detail: "NIK 3501010101010001 dibaca",
        createdAt: new Date("2026-01-01T00:00:00.000Z")
      }
    ]);
    const response = await phiAuditGet(jsonRequest("http://localhost/api/audit/phi"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entries[0].detail).toContain("[NIK]");
    expect(body.entries[0].detail).not.toContain("3501010101010001");
  });
});
