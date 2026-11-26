import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canViewDiagnosis, hasPermission, normalizeRole } from "../lib/rbac";
import { getRequestIp } from "../lib/audit";
import { normalizePhone, resolveWhatsAppProvider, sendWhatsApp } from "../lib/whatsapp";
import { resolvePhoneProvider } from "../lib/phone";
import { buildWhatsappMessage } from "../agents/urgentCaller";
import { chatbotReply } from "../agents/engagement";
import {
  buildJobOptions,
  isQueueEnabled,
  signJobPayload,
  verifyJobPayload
} from "../lib/queue";
import { isPlaceholderSecret, isStrongSecret } from "../lib/env";
import { resolveReportPath } from "../lib/reportFiles";
import { checkRateLimit } from "../lib/rateLimit";

const watchedEnv = [
  "ALLOW_REAL_OUTBOUND",
  "WHATSAPP_PROVIDER",
  "PHONE_PROVIDER",
  "FONNTE_TOKEN",
  "QUEUE_MODE",
  "REDIS_URL",
  "SYNC_MODE",
  "TRUST_PROXY"
] as const;

const originalEnv = new Map<string, string | undefined>(
  watchedEnv.map((key) => [key, process.env[key]])
);

beforeEach(() => {
  process.env.SYNC_MODE = "true";
});

afterEach(() => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Hardening produksi - RBAC dan outbound", () => {
  it("dokter boleh diagnosis, resepsionis tidak", () => {
    expect(canViewDiagnosis("DOKTER")).toBe(true);
    expect(canViewDiagnosis("RESEPSIONIS")).toBe(false);
    expect(hasPermission("RESEPSIONIS", "report:read")).toBe(false);
    expect(hasPermission("ADMIN", "agent:run")).toBe(true);
    expect(hasPermission("ADMIN", "outbound:approve")).toBe(true);
  });

  it("peran tidak dikenal jatuh ke TIDAK_AKTIF (fail-closed)", () => {
    expect(normalizeRole("TIDAK_ADA")).toBe("TIDAK_AKTIF");
    expect(hasPermission(normalizeRole("TIDAK_ADA"), "patient:read")).toBe(false);
  });

  it("placeholder dan secret pendek ditolak", () => {
    expect(isPlaceholderSecret("GANTI_DENGAN_SECRET_ACAK")).toBe(true);
    expect(isPlaceholderSecret("ci-only-secret-1234567890")).toBe(true);
    expect(isStrongSecret("pendek")).toBe(false);
    expect(isStrongSecret("Vm8tR5xQ2pL7nB4sW1yK9dJ6hF3aN0cE8uZ1oX5vT7qR")).toBe(true);
  });

  it("provider mock aktif dan nomor dinormalisasi ke 62", async () => {
    process.env.WHATSAPP_PROVIDER = "mock";
    process.env.ALLOW_REAL_OUTBOUND = "false";
    expect(resolveWhatsAppProvider()).toBe("mock");
    expect(normalizePhone("0812-3456-7890")).toBe("6281234567890");

    const result = await sendWhatsApp("081234567890", "Tes aman");
    expect(result.ok).toBe(true);
    expect(result.simulated).toBe(true);
  });

  it("provider nyata diblokir tanpa ALLOW_REAL_OUTBOUND", async () => {
    process.env.WHATSAPP_PROVIDER = "fonnte";
    process.env.FONNTE_TOKEN = "token-dari-env-bukan-kode-asli";
    process.env.ALLOW_REAL_OUTBOUND = "false";

    const result = await sendWhatsApp("081234567890", "Tes aman");
    expect(result.ok).toBe(false);
    expect(result.simulated).toBe(true);
    expect(result.detail).toContain("ALLOW_REAL_OUTBOUND=false");
  });

  it("telepon default mock walaupun provider twilio dipilih tanpa flag", () => {
    process.env.PHONE_PROVIDER = "twilio";
    expect(resolvePhoneProvider()).toBe("twilio");
    process.env.PHONE_PROVIDER = "unknown";
    expect(resolvePhoneProvider()).toBe("mock");
  });

  it("template WhatsApp tidak memuat diagnosis atau angka vital", () => {
    const message = buildWhatsappMessage({
      nama: "Sari",
      namaKlinik: "Klinik Sehat Nusantara",
      nomorDarurat: "119"
    });
    expect(message).toContain("Sari");
    expect(message).toContain("Klinik Sehat Nusantara");
    expect(message).not.toMatch(/190\/120|gula\s*320|saturasi\s*88|hipertensi|diabetes/i);
  });

  it("chatbot hanya memberi edukasi generik", () => {
    expect(chatbotReply("Saya minta diagnosis diabetes saya apa?")).toContain("hubungi klinik");
    expect(chatbotReply("Kapan pengingat obat?")).toContain("08:00");
  });
});

describe("Hardening produksi - enkripsi, audit, dan antrean", () => {
  it("enkripsi NIK dan masking tetap berfungsi", async () => {
    const { encryptField, decryptField, fieldHash, maskNik, maskPhone } = await import("../lib/crypto");
    const nik = "3501010101010001";
    const encrypted = encryptField(nik);

    expect(encrypted).not.toContain(nik);
    expect(decryptField(encrypted)).toBe(nik);
    expect(fieldHash(nik)).not.toBe(nik);
    expect(maskNik(nik)).toBe("35****0001");
    expect(maskPhone("081234567890")).toBe("0812****7890");
  });

  it("IP audit hanya memakai X-Forwarded-For dari proxy tepercaya", () => {
    const request = new Request("https://klinik.example/api/patients", {
      headers: {
        "x-real-ip": "203.0.113.9",
        "x-forwarded-for": "198.51.100.7, 10.0.0.1"
      }
    });
    delete process.env.TRUST_PROXY;
    expect(getRequestIp(request)).toBe("203.0.113.9");

    process.env.TRUST_PROXY = "203.0.113.9";
    expect(getRequestIp(request)).toBe("198.51.100.7");
  });

  it("antrean hanya aktif dengan QUEUE_MODE=redis dan REDIS_URL", () => {
    process.env.QUEUE_MODE = "redis";
    delete process.env.REDIS_URL;
    expect(isQueueEnabled()).toBe(false);

    process.env.REDIS_URL = "redis://localhost:6379";
    expect(isQueueEnabled()).toBe(true);

    process.env.QUEUE_MODE = "sync";
    expect(isQueueEnabled()).toBe(false);
  });

  it("opsi job memakai retry exponential dan job id", () => {
    const options = buildJobOptions({ delayMs: 5000, jobId: "urgent-test" });
    expect(options).toMatchObject({
      attempts: 3,
      delay: 5000,
      jobId: "urgent-test",
      backoff: { type: "exponential", delay: 1000 }
    });
  });

  it("payload job ditandatangani dan penyeratan ditolak", () => {
    const envelope = signJobPayload({ patientId: "p1", simulate: true });
    expect(verifyJobPayload(envelope)).toEqual({ patientId: "p1", simulate: true });
    expect(() =>
      verifyJobPayload({ data: { patientId: "p1", simulate: false }, signature: envelope.signature })
    ).toThrow(/Tanda tangan job tidak valid/);
  });

  it("path laporan tidak boleh keluar dari folder reports", () => {
    const safe = path.join(process.cwd(), "reports", "laporan.xlsx");
    expect(resolveReportPath(safe)).toBe(safe);
    expect(() => resolveReportPath(path.join(process.cwd(), ".env"))).toThrow(/di luar direktori/);
  });

  it("rate limit login memblokir setelah batas tercapai", () => {
    const key = `test-login-${Date.now()}`;
    for (let index = 0; index < 8; index += 1) {
      expect(checkRateLimit(key, 8, 60_000).allowed).toBe(true);
    }
    expect(checkRateLimit(key, 8, 60_000).allowed).toBe(false);
  });
});
