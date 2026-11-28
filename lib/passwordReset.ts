import { createHash, randomBytes } from "node:crypto";

export const RESET_TOKEN_TTL_HOURS = 1;

export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

/** DB hanya menyimpan hash token, bukan token mentah. */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(`password-reset-v1|${token}`).digest("hex");
}

export function resetTokenExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000);
}
