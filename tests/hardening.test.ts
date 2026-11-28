import path from "node:path";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertPatientAccess,
  canAccessPatient,
  canViewDiagnosis,
  hasPermission,
  normalizeRole
} from "../lib/rbac";
import { getRequestIp, isTrustedProxyHop } from "../lib/audit";
import { normalizePhone, resolveWhatsAppProvider, sendWhatsApp } from "../lib/whatsapp";
import { resolvePhoneProvider } from "../lib/phone";
import { buildWhatsappMessage } from "../agents/urgentCaller";
import { chatbotReply } from "../agents/engagement";
import { buildJobOptions, isQueueEnabled, signJobPayload, verifyJobPayload } from "../lib/queue";
import {
  assertSecureEnvironment,
  isKnownCiSecret,
  isPlaceholderSecret,
  isProductionSecret,
  isStrongSecret
} from "../lib/env";
import { resolveReportPath } from "../lib/reportFiles";
import { checkRateLimit } from "../lib/rateLimit";
import { redactLogFields } from "../lib/logger";

const watchedEnv = [
  "ALLOW_REAL_OUTBOUND",
  "WHATSAPP_PROVIDER",
  "PHONE_PROVIDER",
  "FONNTE_TOKEN",
  "QUEUE_MODE",
  "REDIS_URL",
  "RATE_LIMIT_REDIS_URL",
  "RATE_LIMIT_MODE",
  "SYNC_MODE",
  "TRUST_PROXY",
  "NODE_ENV",
  "NEXT_PHASE",
  "CI",
  "GITHUB_ACTIONS",
  "APP_SIGNING_KEY",
  "NEXTAUTH_SECRET",
  "AUTH_SECRET",
  "FIELD_ENCRYPTION_KEY",
  "NEXTAUTH_URL",
  "REQUIRE_HUMAN_APPROVAL"
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
    const { encryptField, decryptField, fieldHash, maskNik, maskPhone } =
      await import("../lib/crypto");
    const nik = "3501010101010001";
    const encrypted = encryptField(nik);

    expect(encrypted).not.toContain(nik);
    expect(decryptField(encrypted)).toBe(nik);
    expect(fieldHash(nik)).not.toBe(nik);
    expect(maskNik(nik)).toBe("35****0001");
    expect(maskPhone("081234567890")).toBe("0812****7890");
  });

  it("IP audit mengabaikan header forwarding saat TRUST_PROXY kosong", () => {
    const request = new Request("https://klinik.example/api/patients", {
      headers: {
        "x-real-ip": "203.0.113.9",
        "x-forwarded-for": "198.51.100.7, 10.0.0.1"
      }
    });
    delete process.env.TRUST_PROXY;
    expect(getRequestIp(request)).toBe("unknown");

    process.env.TRUST_PROXY = "10.0.0.5";
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
      verifyJobPayload({
        data: { patientId: "p1", simulate: false },
        signature: envelope.signature
      })
    ).toThrow(/Tanda tangan job tidak valid/);
  });

  it("path laporan tidak boleh keluar dari folder reports", () => {
    const safe = path.join(process.cwd(), "reports", "laporan.xlsx");
    expect(resolveReportPath(safe)).toBe(safe);
    expect(() => resolveReportPath(path.join(process.cwd(), ".env"))).toThrow(/di luar direktori/);
  });

  it("rate limit login memblokir setelah batas tercapai", async () => {
    const key = `test-login-${Date.now()}`;
    for (let index = 0; index < 8; index += 1) {
      expect((await checkRateLimit(key, 8, 60_000)).allowed).toBe(true);
    }
    expect((await checkRateLimit(key, 8, 60_000)).allowed).toBe(false);
  });

  it("secret DEV/CI dan nilai CI default ditolak di produksi", () => {
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    expect(isProductionSecret("DEV-ONLY-MEDI-BOT-KEY-1234567890")).toBe(false);
    expect(isProductionSecret("CI-ONLY-MEDI-BOT-KEY-1234567890")).toBe(false);
    expect(isProductionSecret("GANTI_DENGAN_KUNCI_RAHASIA_32_KARAKTER")).toBe(false);
    process.env.CI = "true";
    expect(isKnownCiSecret("test")).toBe(true);
    expect(isProductionSecret("a".repeat(40))).toBe(true);
    delete process.env.CI;
  });

  it("produksi mewajibkan RATE_LIMIT_MODE=redis dan REDIS_URL", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.NEXT_PHASE;
    process.env.NEXTAUTH_SECRET = "a".repeat(48);
    process.env.FIELD_ENCRYPTION_KEY = "b".repeat(48);
    process.env.APP_SIGNING_KEY = "c".repeat(48);
    delete process.env.AUTH_SECRET;
    process.env.NEXTAUTH_URL = "https://klinik.example";
    process.env.SYNC_MODE = "false";
    process.env.REQUIRE_HUMAN_APPROVAL = "true";
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    process.env.RATE_LIMIT_MODE = "memory";
    delete process.env.REDIS_URL;
    delete process.env.RATE_LIMIT_REDIS_URL;

    expect(() => assertSecureEnvironment()).toThrow(/RATE_LIMIT_MODE=redis/);
    process.env.RATE_LIMIT_MODE = "redis";
    expect(() => assertSecureEnvironment()).toThrow(/REDIS_URL/);
    process.env.REDIS_URL = "redis://localhost:6379";
    expect(() => assertSecureEnvironment()).not.toThrow();
  });

  it("produksi menolak APP_SIGNING_KEY yang tidak ada", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.NEXT_PHASE;
    process.env.NEXTAUTH_SECRET = "a".repeat(48);
    process.env.FIELD_ENCRYPTION_KEY = "b".repeat(48);
    delete process.env.APP_SIGNING_KEY;
    process.env.NEXTAUTH_URL = "https://klinik.example";
    process.env.SYNC_MODE = "false";
    process.env.REQUIRE_HUMAN_APPROVAL = "true";
    process.env.RATE_LIMIT_MODE = "redis";
    process.env.REDIS_URL = "redis://localhost:6379";
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    expect(() => assertSecureEnvironment()).toThrow(/APP_SIGNING_KEY wajib/);
  });

  it("denylist secret CI tetap menolak nilai yang cukup panjang", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.NEXT_PHASE;
    process.env.NEXTAUTH_SECRET = "ci-runner-token-abcdefghijklmnop";
    process.env.FIELD_ENCRYPTION_KEY = "b".repeat(48);
    process.env.APP_SIGNING_KEY = "c".repeat(48);
    delete process.env.AUTH_SECRET;
    process.env.NEXTAUTH_URL = "https://klinik.example";
    process.env.SYNC_MODE = "false";
    process.env.REQUIRE_HUMAN_APPROVAL = "true";
    process.env.RATE_LIMIT_MODE = "redis";
    process.env.REDIS_URL = "redis://localhost:6379";
    delete process.env.GITHUB_ACTIONS;
    process.env.CI = "true";

    expect(() => assertSecureEnvironment()).toThrow(/CI environment/);
    process.env.CI = "false";
    expect(() => assertSecureEnvironment()).not.toThrow();

    process.env.CI = "true";
    process.env.NEXTAUTH_SECRET = "a".repeat(48);
    process.env.APP_SIGNING_KEY = "a".repeat(48);
    expect(() => assertSecureEnvironment()).toThrow(/APP_SIGNING_KEY/);
  });

  it("rate limit produksi fail-closed bila Redis tidak tersedia", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.NEXT_PHASE;
    process.env.RATE_LIMIT_MODE = "redis";
    delete process.env.REDIS_URL;
    delete process.env.RATE_LIMIT_REDIS_URL;
    const result = await checkRateLimit("emergency-test", 100, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.backend).toBe("redis");
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("X-Forwarded-For hanya dipercaya bila hop proxy cocok", () => {
    const request = new Request("https://klinik.example/api/ready", {
      headers: {
        "x-real-ip": "203.0.113.9",
        "x-forwarded-for": "198.51.100.7, 10.0.0.1"
      }
    });
    delete process.env.TRUST_PROXY;
    expect(getRequestIp(request)).toBe("unknown");
    process.env.TRUST_PROXY = "10.0.0.5";
    expect(getRequestIp(request)).toBe("198.51.100.7");
    expect(isTrustedProxyHop("10.0.0.9", "10.0.0.5/24")).toBe(true);
    const spoofed = new Request("https://klinik.example/api/ready", {
      headers: { "x-forwarded-for": "198.51.100.7" }
    });
    expect(getRequestIp(spoofed)).toBe("unknown");
    process.env.TRUST_PROXY = "*";
    expect(getRequestIp(spoofed)).toBe("198.51.100.7");
  });

  it("logger meredaksi email, NIK, telepon, dan token", () => {
    const safe = redactLogFields({
      requestId: "req-1",
      email: "dokter@klinik.example",
      nik: "3501010101010001",
      phone: "081234567890",
      token: "gho_rahasia123",
      nested: { authorization: "Bearer abc.def.ghi" }
    });
    const serialized = JSON.stringify(safe);
    expect(serialized).toContain("req-1");
    expect(serialized).not.toContain("dokter@klinik.example");
    expect(serialized).not.toContain("3501010101010001");
    expect(serialized).not.toContain("081234567890");
    expect(serialized).not.toContain("gho_rahasia123");
    expect(serialized).not.toContain("abc.def.ghi");
  });

  it("RBAC PHI granuler dan akses object-level PASIEN", () => {
    expect(hasPermission("ADMIN", "patient:read_nik")).toBe(true);
    expect(hasPermission("DOKTER", "patient:read_diagnosis")).toBe(true);
    expect(hasPermission("PERAWAT", "patient:read_contact")).toBe(true);
    expect(hasPermission("PERAWAT", "patient:read_nik")).toBe(false);
    expect(hasPermission("RESEPSIONIS", "patient:read_contact")).toBe(false);
    expect(canAccessPatient("PASIEN", "u1", "p1", "p1")).toBe(true);
    expect(canAccessPatient("PASIEN", "u1", "p1", "p2")).toBe(false);
    expect(canAccessPatient("DOKTER", "u1", "p1", null, "d1", "d1")).toBe(true);
    expect(canAccessPatient("DOKTER", "u1", "p1", null, "d2", "d1")).toBe(false);
    expect(() => assertPatientAccess("PASIEN", "u1", "p2", "p1")).toThrow();
  });
});

describe("Kriptografi field dan signing key", () => {
  it("enkripsi v2 dapat didekripsi dan format v1 lama tetap didukung", async () => {
    vi.resetModules();
    delete process.env.FIELD_ENCRYPTION_KEY;
    process.env.SYNC_MODE = "true";
    const crypto = await import("../lib/crypto");
    const nik = "3501010101010001";
    const encrypted = crypto.encryptField(nik);
    expect(encrypted).toMatch(/^v2:[0-9a-f]{12}:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(encrypted.split(":")[0]).toBe("v2");
    expect(crypto.decryptField(encrypted)).toBe(nik);
    expect(crypto.decryptPhi(crypto.encryptPhi(nik))).toBe(nik);

    const devKey = createHash("sha256")
      .update("MEDI-BOT-AGENCY-V3-DEV-ONLY-DO-NOT-USE-IN-PRODUCTION")
      .digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", devKey, iv);
    const ciphertext = Buffer.concat([cipher.update(nik, "utf8"), cipher.final()]);
    const legacy = [
      "v1",
      iv.toString("hex"),
      cipher.getAuthTag().toString("hex"),
      ciphertext.toString("hex")
    ].join(":");
    expect(crypto.decryptField(legacy)).toBe(nik);
  });

  it("APP_SIGNING_KEY tidak mengubah hash NIK yang sudah tersimpan", async () => {
    vi.resetModules();
    delete process.env.APP_SIGNING_KEY;
    delete process.env.FIELD_ENCRYPTION_KEY;
    process.env.SYNC_MODE = "true";
    const before = await import("../lib/crypto");
    const hash = before.fieldHash("3501010101010001");
    const signature = before.signPayload("payload");

    vi.resetModules();
    process.env.APP_SIGNING_KEY = "c".repeat(64);
    const after = await import("../lib/crypto");
    expect(after.hasAppSigningKey()).toBe(true);
    expect(after.fieldHash("3501010101010001")).toBe(hash);
    expect(after.verifyPayloadSignature("payload", signature)).toBe(true);
  });
});
