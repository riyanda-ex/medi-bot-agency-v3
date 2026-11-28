import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  reportIds: [] as string[],
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
  visitWhere: [] as Array<Record<string, unknown>>
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: { count: async () => 2 },
    visit: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        state.visitWhere.push(where);
        return 3;
      },
      groupBy: async ({ by }: { by: string[] }) =>
        by[0] === "icd10"
          ? [{ icd10: "I10", _count: { _all: 2 } }]
          : [{ doctorId: "doc-1", _count: { _all: 3 } }]
    },
    triageLog: { count: async () => 1 },
    medicineStock: { findMany: async () => [{ name: "Paracetamol", stock: 4, unit: " tablet" }] },
    claim: { count: async () => 1 },
    report: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = state.reportIds.shift() ?? `report-${state.created.length + 1}`;
        const row = { id, ...data };
        state.created.push(data);
        return row;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.updated.push(data);
        return data;
      }
    }
  }
}));

vi.mock("@/lib/agentLog", () => ({
  writeAgentLog: async (input: Record<string, unknown>) => {
    state.logs.push(input);
  }
}));
vi.mock("@/lib/approval", () => ({
  verifyApproval: vi.fn(async () => ({ ok: true, reason: "Approval valid.", approverId: "doc-1" }))
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn() }
}));

import nodemailer from "nodemailer";
import { buildDailyReport, runReporter } from "../agents/reporter";

const watchedEnv = ["ALLOW_REAL_OUTBOUND", "SMTP_HOST", "SYNC_MODE", "ALERT_EMAIL"] as const;
const originalEnv = new Map<string, string | undefined>(
  watchedEnv.map((key) => [key, process.env[key]])
);
const writtenDirs: string[] = [];

beforeEach(() => {
  state.reportIds.length = 0;
  state.created.length = 0;
  state.updated.length = 0;
  state.logs.length = 0;
  state.visitWhere.length = 0;
  delete process.env.ALLOW_REAL_OUTBOUND;
  delete process.env.SMTP_HOST;
  delete process.env.ALERT_EMAIL;
  process.env.SYNC_MODE = "true";
  vi.mocked(nodemailer.createTransport).mockReset();
});

afterEach(async () => {
  for (const key of watchedEnv) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of writtenDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("Regresi reporter harian", () => {
  it("tanggal laporan memakai WIB, bukan UTC", async () => {
    const data = await buildDailyReport(new Date("2026-11-28T20:30:00.000Z"));

    expect(data.date).toBe("2026-11-29");
    expect(data.visits7Days[6]?.date).toBe("2026-11-29");
    expect((state.visitWhere[0]?.visitDate as { gte: Date }).gte.toISOString()).toBe(
      "2026-11-28T17:00:00.000Z"
    );
  });

  it("setiap generate memakai direktori unik sehingga tidak menimpa laporan lama", async () => {
    state.reportIds.push("report-a", "report-b");
    const first = await runReporter();
    writtenDirs.push(path.join(process.cwd(), "reports", first.data.date, "report-a"));
    const second = await runReporter();
    writtenDirs.push(path.join(process.cwd(), "reports", second.data.date, "report-b"));

    expect(first.reportId).toBe("report-a");
    expect(second.reportId).toBe("report-b");
    const firstPath = String(state.updated[0]?.filePathPdf);
    const secondPath = String(state.updated[1]?.filePathPdf);
    expect(firstPath).toContain("report-a");
    expect(secondPath).toContain("report-b");
    expect(firstPath).not.toBe(secondPath);
    await expect(fs.stat(firstPath)).resolves.toBeDefined();
    await expect(fs.stat(secondPath)).resolves.toBeDefined();
    expect(first.status).toBe("SUCCESS");
    expect(state.updated[0]).toMatchObject({ status: "SUCCESS" });
  });

  it("file tetap berhasil dibuat saat email gagal: status PARTIAL", async () => {
    process.env.ALLOW_REAL_OUTBOUND = "true";
    process.env.SMTP_HOST = "smtp.example";
    delete process.env.SYNC_MODE;
    vi.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail: vi.fn(async () => {
        throw new Error("SMTP down");
      })
    } as never);

    const result = await runReporter();
    writtenDirs.push(path.join(process.cwd(), "reports", result.data.date, result.reportId));

    expect(result.status).toBe("PARTIAL");
    expect(result.email).toMatchObject({ sent: false, simulated: false });
    expect(state.updated[0]).toMatchObject({ status: "PARTIAL" });
    expect(state.logs.at(-1)).toMatchObject({ status: "PARTIAL" });
  });
});
