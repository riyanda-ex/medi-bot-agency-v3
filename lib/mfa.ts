/**
 * TOTP (RFC 6238) dan kode pemulihan tanpa dependency eksternal.
 * Secret disimpan terenkripsi di DB; kode pemulihan hanya disimpan sebagai hash.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const RECOVERY_CODE_COUNT = 6;

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Secret TOTP tidak valid.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function counterBuffer(counter: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  return buffer;
}

export function totpAt(secret: string, counter: number): string {
  const digest = createHmac("sha1", base32Decode(secret)).update(counterBuffer(counter)).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    (((digest[offset]! & 0x7f) << 24) |
      ((digest[offset + 1]! & 0xff) << 16) |
      ((digest[offset + 2]! & 0xff) << 8) |
      (digest[offset + 3]! & 0xff)) >>>
    0;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function codesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Verifikasi dengan toleransi satu langkah sebelum/sesudah (drift jam). */
export function verifyTotp(secret: string, code: string, now = Date.now(), window = 1): boolean {
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code)) return false;
  const step = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
  for (let delta = -window; delta <= window; delta += 1) {
    if (codesEqual(totpAt(secret, step + delta), code)) return true;
  }
  return false;
}

export function otpAuthUri(secret: string, issuer: string, account: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS)
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () =>
    randomBytes(10)
      .toString("hex")
      .toUpperCase()
      .match(/.{1,4}/g)!
      .join("-")
  );
}

function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256")
    .update(`mfa-recovery-v1|${normalizeRecoveryCode(code)}`)
    .digest("hex");
}

export function hashRecoveryCodes(codes: string[]): string {
  return codes.map(hashRecoveryCode).join(",");
}

export function recoveryCodesRemaining(stored: string | null): number {
  if (!stored) return 0;
  return stored.split(",").filter(Boolean).length;
}

/** Kode pemulihan sekali pakai; hash yang terpakai dibuang dari daftar. */
export function consumeRecoveryCode(
  stored: string | null,
  code: string
): { ok: boolean; remaining: string } {
  if (!stored || !code) return { ok: false, remaining: stored ?? "" };
  const candidate = hashRecoveryCode(code);
  const hashes = stored.split(",").filter(Boolean);
  const index = hashes.findIndex((item) => codesEqual(item, candidate));
  if (index < 0) return { ok: false, remaining: stored };
  hashes.splice(index, 1);
  return { ok: true, remaining: hashes.join(",") };
}
