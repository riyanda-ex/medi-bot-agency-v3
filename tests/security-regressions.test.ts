import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPermission } from "../lib/rbac";
import { redactSensitive } from "../lib/logger";
import { redactRecordForRole } from "../agents/securityGuard";

interface AuditRow {
  id: string;
  action: string;
  detail: string;
  signature: string | null;
  createdAt: Date;
}

const state = vi.hoisted(() => ({
  auditLogs: [] as AuditRow[],
  approver: { role: "DOKTER", status: "AKTIF" } as { role: string; status: string } | null
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: AuditRow = {
          id: `log-${state.auditLogs.length + 1}`,
          action: String(data.action ?? ""),
          detail: String(data.detail ?? ""),
          signature: (data.signature as string | null) ?? null,
          createdAt: new Date()
        };
        state.auditLogs.push(row);
        return row;
      },
      findFirst: async ({
        where
      }: {
        where: { action?: string; detail?: { startsWith?: string } };
      }) =>
        state.auditLogs.find(
          (row) =>
            (!where.action || row.action === where.action) &&
            (!where.detail?.startsWith || row.detail.startsWith(where.detail.startsWith))
        ) ?? null
    },
    user: { findUnique: async () => state.approver }
  }
}));

import { createApproval, verifyApproval, APPROVAL_CONSUMPTION_ACTION } from "../lib/approval";

const watchedEnv = [
  "NODE_ENV",
  "NEXT_PHASE",
  "NEXTAUTH_SECRET",
  "FIELD_ENCRYPTION_KEY",
  "REQUIRE_HUMAN_APPROVAL"
] as const;
const originalEnv = new Map<string, string | undefined>(
  watchedEnv.map((key) => [key, process.env[key]])
);

beforeEach(() => {
  state.auditLogs.length = 0;
  state.approver = { role: "DOKTER", status: "AKTIF" };
  delete process.env.REQUIRE_HUMAN_APPROVAL;
});

afterEach(() => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Regresi keamanan approval", () => {
  it("approval terikat kanal yang disetujui", async () => {
    const record = await createApproval({
      scope: "URGENT",
      resourceId: "triage-1",
      approverId: "user-1",
      role: "DOKTER",
      channels: ["whatsapp"]
    });

    await expect(
      verifyApproval(record.approvalId, "URGENT", "triage-1", { channel: "CALL" })
    ).resolves.toMatchObject({ ok: false });
    await expect(
      verifyApproval(record.approvalId, "URGENT", "triage-1", { channel: "WHATSAPP" })
    ).resolves.toMatchObject({ ok: true, approverId: "user-1" });
  });

  it("approval tidak bisa dipakai ulang untuk kanal/tahap yang sama", async () => {
    const record = await createApproval({
      scope: "URGENT",
      resourceId: "triage-2",
      approverId: "user-1",
      role: "DOKTER",
      channels: ["CALL"]
    });
    const use = { channel: "CALL", stage: "CALL:120" };

    await expect(
      verifyApproval(record.approvalId, "URGENT", "triage-2", use)
    ).resolves.toMatchObject({ ok: true });
    await expect(
      verifyApproval(record.approvalId, "URGENT", "triage-2", use)
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("sudah dipakai") });
    // Tahap lain pada kanal yang sama masih sah.
    await expect(
      verifyApproval(record.approvalId, "URGENT", "triage-2", {
        channel: "CALL",
        stage: "CALL:300"
      })
    ).resolves.toMatchObject({ ok: true });
    expect(
      state.auditLogs.filter((row) => row.action === APPROVAL_CONSUMPTION_ACTION)
    ).toHaveLength(2);
  });

  it("verifikasi tanpa kanal ditolak (fail-closed)", async () => {
    const record = await createApproval({
      scope: "REPORT",
      resourceId: "2026-11-28",
      approverId: "user-1",
      role: "ADMIN",
      channels: ["EMAIL"]
    });
    await expect(verifyApproval(record.approvalId, "REPORT", "2026-11-28")).resolves.toMatchObject({
      ok: false
    });
  });

  it("tanda tangan produksi tidak memakai kunci DEV sebagai fallback", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.NEXT_PHASE;
    const devKey = "DEV-ONLY-0123456789abcdef0123456789abcdef";
    process.env.NEXTAUTH_SECRET = devKey;
    process.env.FIELD_ENCRYPTION_KEY = devKey;

    vi.resetModules();
    const { signPayload } = await import("../lib/crypto");
    expect(() => signPayload("must-not-be-signable")).toThrow(/fallback kunci DEV/);
  });
});

describe("Regresi keamanan data", () => {
  it("izin PHI baru hanya untuk peran berwenang", () => {
    for (const role of ["ADMIN", "DOKTER"] as const) {
      expect(hasPermission(role, "patient:read_nik")).toBe(true);
      expect(hasPermission(role, "patient:read_diagnosis")).toBe(true);
      expect(hasPermission(role, "patient:read_contact")).toBe(true);
    }
    expect(hasPermission("RESEPSIONIS", "patient:read_nik")).toBe(false);
    expect(hasPermission("RESEPSIONIS", "patient:read_contact")).toBe(false);
  });

  it("redaksi rekam medis menghapus semua field PHI untuk peran rendah", () => {
    const record = {
      id: "rec-1",
      diagnosisIcd10: "I10",
      anamnesis: "Nyeri dada",
      actionIcd9: "Tindakan",
      radiology: "Foto toraks",
      vitalSigns: "190/120",
      note: "Catatan dokter"
    };
    const safe = redactRecordForRole(record, "RESEPSIONIS");
    expect(safe).toEqual({ id: "rec-1" });
    expect(redactRecordForRole(record, "DOKTER")).toEqual(record);
  });

  it("logger menyamarkan NIK, telepon, token, dan Bearer", () => {
    const line = redactSensitive(
      "NIK 3501010101010001 telp 081234567890 gho_abc123 sk-xyz789 Bearer abc.def"
    );
    expect(line).not.toContain("3501010101010001");
    expect(line).not.toContain("081234567890");
    expect(line).not.toContain("gho_abc123");
    expect(line).not.toContain("sk-xyz789");
    expect(line).not.toContain("abc.def");
    expect(line.match(/\[REDACTED\]/g)).toHaveLength(5);
  });
});
