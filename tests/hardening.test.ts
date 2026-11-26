import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canViewDiagnosis, hasPermission, normalizeRole } from "../lib/rbac";
import { getRequestIp } from "../lib/audit";
import { normalizePhone, resolveWhatsAppProvider, sendWhatsApp } from "../lib/whatsapp";
import { resolvePhoneProvider } from "../lib/phone";
import { buildWhatsappMessage } from "../agents/urgentCaller";
import { buildJobOptions, isQueueEnabled } from "../lib/queue";

const watchedEnv = [
  "ALLOW_REAL_OUTBOUND",
  "WHATSAPP_PROVIDER",
  "PHONE_PROVIDER",
  "FONNTE_TOKEN",
  "QUEUE_MODE",
  "REDIS_URL",
  "SYNC_MODE"
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
  });

  it("peran tidak dikenal jatuh ke RESEPSIONIS", () => {
    expect(normalizeRole("TIDAK_ADA")).toBe("RESEPSIONIS");
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

  it("IP audit memakai x-forwarded-for pertama", () => {
    const request = new Request("https://klinik.example/api/patients", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }
    });
    expect(getRequestIp(request)).toBe("203.0.113.9");
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
});
