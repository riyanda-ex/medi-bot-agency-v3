import { describe, expect, it } from "vitest";
import {
  consumeRecoveryCode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCodes,
  otpAuthUri,
  recoveryCodesRemaining,
  totpAt,
  verifyTotp
} from "../lib/mfa";

// RFC 6238 Appendix B: "12345678901234567890" base32, T=59 -> 94287082 (8 digit).
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTP MFA", () => {
  it("cocok dengan vektor RFC 6238", () => {
    expect(totpAt(RFC_SECRET, 1)).toBe("287082");
    expect(verifyTotp(RFC_SECRET, "287082", 59_000)).toBe(true);
  });

  it("menolak kode salah dan format bukan 6 digit", () => {
    expect(verifyTotp(RFC_SECRET, "000000", 59_000, 0)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "12345", 59_000)).toBe(false);
  });

  it("secret baru berformat base32 dan URI authenticator memuat issuer", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpAuthUri(secret, "MediBot", "user@klinik.example")).toContain("issuer=MediBot");
  });

  it("kode pemulihan sekali pakai", () => {
    const codes = generateRecoveryCodes(3);
    const stored = hashRecoveryCodes(codes);
    expect(recoveryCodesRemaining(stored)).toBe(3);
    const first = consumeRecoveryCode(stored, codes[0]!);
    expect(first.ok).toBe(true);
    expect(recoveryCodesRemaining(first.remaining)).toBe(2);
    expect(consumeRecoveryCode(first.remaining, codes[0]!).ok).toBe(false);
  });
});
