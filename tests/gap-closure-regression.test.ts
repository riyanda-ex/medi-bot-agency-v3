import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  audit: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  userUpdateMany: vi.fn(),
  resetClaim: vi.fn(),
  resetFind: vi.fn(),
  resetInvalidate: vi.fn(),
  resetUserUpdate: vi.fn(),
  transaction: vi.fn()
}));

vi.mock("@/auth", () => ({ auth: (...args: unknown[]) => mocks.auth(...args) }));
vi.mock("@/lib/audit", () => ({
  auditApiAccess: (...args: unknown[]) => mocks.audit(...args)
}));
vi.mock("@/lib/requestGuard", () => ({
  enforceBodySize: vi.fn(async (request: Request) => ({ response: null, request })),
  enforceRateLimit: vi.fn(async () => null),
  enforceSameOrigin: vi.fn(() => null),
  getClientIp: vi.fn(() => "127.0.0.1")
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    passwordResetToken: {
      updateMany: (...args: unknown[]) => {
        const where = (args[0] as { where: Record<string, unknown> }).where;
        return where.tokenHash ? mocks.resetClaim(...args) : mocks.resetInvalidate(...args);
      },
      findUnique: (...args: unknown[]) => mocks.resetFind(...args)
    },
    user: { update: (...args: unknown[]) => mocks.resetUserUpdate(...args) }
  };
  return {
    prisma: {
      user: {
        findUnique: (...args: unknown[]) => mocks.userFindUnique(...args),
        update: (...args: unknown[]) => mocks.userUpdate(...args),
        updateMany: (...args: unknown[]) => mocks.userUpdateMany(...args)
      },
      passwordResetToken: {
        updateMany: (...args: unknown[]) => {
          const where = (args[0] as { where: Record<string, unknown> }).where;
          return typeof where.tokenHash === "string"
            ? mocks.resetClaim(...args)
            : mocks.resetInvalidate(...args);
        }
      },
      apiLog: { create: vi.fn(async () => ({})) },
      $transaction: (...args: unknown[]) => mocks.transaction(...(args as [unknown]))
    },
    __tx: tx
  };
});

import { approvalAllowsChannel } from "../lib/approval";
import { consumeRecoveryCode, hashRecoveryCodes, totpAt } from "../lib/mfa";
import { consumeRecoveryCodeForUser } from "../lib/mfaStore";
import { hashResetToken } from "../lib/passwordReset";
import { POST as mfaPost } from "../app/api/me/mfa/route";
import { PATCH as adminPatch } from "../app/api/admin/users/[id]/route";
import { POST as resetPost } from "../app/api/auth/reset-password/route";

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify(body)
  });
}

const watchedEnv = [
  "NODE_ENV",
  "NEXT_PHASE",
  "APP_SIGNING_KEY",
  "NEXTAUTH_SECRET",
  "AUTH_SECRET",
  "FIELD_ENCRYPTION_KEY",
  "REQUIRE_HUMAN_APPROVAL",
  "SYNC_MODE"
] as const;
const originalEnv = new Map<string, string | undefined>(
  watchedEnv.map((key) => [key, process.env[key]])
);

beforeEach(() => {
  vi.clearAllMocks();
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = "test";
  env.SYNC_MODE = "true";
  mocks.auth.mockResolvedValue({ user: { id: "u1", role: "PASIEN", invalid: false } });
  mocks.audit.mockResolvedValue(undefined);
  const tx = {
    passwordResetToken: {
      updateMany: (...args: unknown[]) => {
        const where = (args[0] as { where: Record<string, unknown> }).where;
        return typeof where.tokenHash === "string"
          ? mocks.resetClaim(...args)
          : mocks.resetInvalidate(...args);
      },
      findUnique: (...args: unknown[]) => mocks.resetFind(...args)
    },
    user: { update: (...args: unknown[]) => mocks.resetUserUpdate(...args) }
  };
  mocks.transaction.mockImplementation(async (fn: (transaction: unknown) => unknown) => fn(tx));
});

afterEach(() => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("MFA pendaftaran server-side", () => {
  it("ENABLE memakai secret/kode pemulihan dari server, bukan dari body klien", async () => {
    const user: Record<string, unknown> = {
      id: "u1",
      email: "pasien@klinik.example",
      mfaEnabled: false,
      mfaSecret: null,
      mfaRecoveryHash: null,
      mfaPendingSecret: null,
      mfaPendingRecoveryHash: null,
      mfaPendingExpiresAt: null,
      tokenVersion: 0
    };
    mocks.userFindUnique.mockResolvedValue(user);
    mocks.userUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(user, data);
      return user;
    });
    mocks.userUpdateMany.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(user, data);
      return { count: 1 };
    });

    const begin = await mfaPost(jsonRequest("http://localhost/api/me/mfa", { action: "BEGIN" }));
    expect(begin.status).toBe(200);
    const setup = (await begin.json()) as {
      secret: string;
      recoveryCodes: string[];
      setupExpiresAt: string;
    };
    expect(setup.recoveryCodes).toHaveLength(6);
    expect(user.mfaPendingSecret).toBeTruthy();
    const pendingSecret = user.mfaPendingSecret;
    const step = Math.floor(Date.now() / 1000 / 30);
    const code = totpAt(setup.secret, step);

    const attackerSecret = "A".repeat(32);
    const attackerCodes = ["AAAA-AAAA-AAAA-AAAA-AAAA"];
    const enable = await mfaPost(
      jsonRequest("http://localhost/api/me/mfa", {
        action: "ENABLE",
        code,
        secret: attackerSecret,
        recoveryCodes: attackerCodes
      })
    );

    expect(enable.status).toBe(200);
    expect(user.mfaEnabled).toBe(true);
    expect(user.mfaSecret).toBe(pendingSecret);
    const storedRecoveryHashes = user.mfaRecoveryHash as string | null;
    expect(consumeRecoveryCode(storedRecoveryHashes, setup.recoveryCodes[0]!).ok).toBe(true);
    expect(consumeRecoveryCode(storedRecoveryHashes, attackerCodes[0]!).ok).toBe(false);
    expect(user.mfaPendingSecret).toBeNull();
  });

  it("konsumsi kode pemulihan login bersifat compare-and-swap", async () => {
    const codes = ["ABCD-EFGH-IJKL-MNOP-QRST"];
    const stored = hashRecoveryCodes(codes);
    mocks.userUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    expect(await consumeRecoveryCodeForUser("u1", stored, codes[0]!)).toBe(true);
    expect(mocks.userUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "u1", mfaRecoveryHash: stored })
      })
    );
    expect(await consumeRecoveryCodeForUser("u1", stored, codes[0]!)).toBe(false);
  });
});

describe("Kontrol admin dan reset kata sandi", () => {
  it("admin tidak dapat mengaktifkan MFA tanpa pendaftaran pemilik akun", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", invalid: false } });
    mocks.userFindUnique.mockResolvedValue({ id: "u2", status: "AKTIF" });
    const response = await adminPatch(
      jsonRequest("http://localhost/api/admin/users/u2", { mfaEnabled: true }),
      { params: Promise.resolve({ id: "u2" }) }
    );
    expect(response.status).toBe(400);
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it("token reset sekali pakai ditolak saat klaim kondisional gagal", async () => {
    mocks.resetClaim.mockResolvedValue({ count: 0 });
    const token = "reset-token-yang-cukup-panjang-1234567890";
    const response = await resetPost(
      jsonRequest("http://localhost/api/auth/reset-password", {
        token,
        password: "KataSandiBaru123!"
      })
    );
    expect(response.status).toBe(400);
    expect(mocks.resetUserUpdate).not.toHaveBeenCalled();
  });

  it("reset berhasil mencabut token lain milik pengguna yang sama", async () => {
    const token = "reset-token-yang-cukup-panjang-1234567890";
    const tokenHash = hashResetToken(token);
    mocks.resetClaim.mockResolvedValue({ count: 1 });
    mocks.resetFind.mockResolvedValue({ userId: "u1", tokenHash });
    mocks.resetUserUpdate.mockResolvedValue({ id: "u1" });
    mocks.resetInvalidate.mockResolvedValue({ count: 1 });

    const response = await resetPost(
      jsonRequest("http://localhost/api/auth/reset-password", {
        token,
        password: "KataSandiBaru123!"
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.resetInvalidate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "u1", tokenHash: { not: tokenHash } })
      })
    );
  });
});

describe("Kanal approval dan kunci tanda tangan", () => {
  it("approval hanya mengizinkan kanal yang dipilih", () => {
    process.env.REQUIRE_HUMAN_APPROVAL = "true";
    const verification = { ok: true, reason: "Approval valid.", channels: ["WHATSAPP"] };
    expect(approvalAllowsChannel(verification, "WHATSAPP")).toBe(true);
    expect(approvalAllowsChannel(verification, "CALL")).toBe(false);
    expect(approvalAllowsChannel({ ...verification, ok: false }, "WHATSAPP")).toBe(false);
  });

  it("tanda tangan produksi gagal tertutup tanpa APP_SIGNING_KEY", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.NEXT_PHASE;
    delete process.env.APP_SIGNING_KEY;
    process.env.NEXTAUTH_SECRET = "a".repeat(48);
    process.env.FIELD_ENCRYPTION_KEY = "b".repeat(48);
    delete process.env.AUTH_SECRET;
    process.env.SYNC_MODE = "true";
    vi.resetModules();
    const crypto = await import("../lib/crypto");
    expect(() => crypto.signPayload("payload")).toThrow(/APP_SIGNING_KEY wajib/);
  });
});
