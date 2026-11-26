import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "v1";
const DEV_KEY_MATERIAL = "MEDI-BOT-AGENCY-V3-DEV-ONLY-DO-NOT-USE-IN-PRODUCTION";

function isPlaceholder(value: string | undefined): boolean {
  return !value || value.trim() === "" || value.includes("GANTI_");
}

function deriveKey(material: string): Buffer {
  return createHash("sha256").update(material).digest();
}

let cachedKey: Buffer | null = null;
let cachedHmacKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.FIELD_ENCRYPTION_KEY;

  if (!isPlaceholder(raw)) {
    cachedKey = deriveKey(raw as string);
    return cachedKey;
  }

  if (process.env.SYNC_MODE === "true") {
    console.warn(
      "[SECURITY] FIELD_ENCRYPTION_KEY tidak diisi. Memakai kunci DEV turunan. " +
        "Jangan gunakan untuk data pasien nyata."
    );
    cachedKey = deriveKey(DEV_KEY_MATERIAL);
    return cachedKey;
  }

  throw new Error(
    "FIELD_ENCRYPTION_KEY wajib diisi dengan kunci rahasia minimal 32 karakter " +
      "(atau set SYNC_MODE=true untuk testing)."
  );
}

function hmacKey(): Buffer {
  if (cachedHmacKey) return cachedHmacKey;
  cachedHmacKey = createHmac("sha256", encryptionKey()).update("medi-bot-hmac-v1").digest();
  return cachedHmacKey;
}

/** Enkripsi nilai sensitif. Format: v1:<iv>:<tag>:<ciphertext> (semua hex). */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
}

/** Dekripsi nilai yang dibuat encryptField. Teks lama tanpa prefix dikembalikan apa adanya. */
export function decryptField(payload: string): string {
  if (!payload.startsWith(`${PREFIX}:`)) {
    return payload;
  }
  const parts = payload.split(":");
  if (parts.length !== 4) {
    throw new Error("Format field terenkripsi tidak valid.");
  }
  const [, ivHex, tagHex, cipherHex] = parts;
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherHex, "hex")),
    decipher.final()
  ]).toString("utf8");
}

/** Hash deterministik untuk deteksi duplikat NIK tanpa menyimpan NIK plaintext. */
export function fieldHash(value: string): string {
  return createHmac("sha256", hmacKey()).update(value).digest("hex");
}

/** Masking NIK: 3501010101010001 -> 35****0001 */
export function maskNik(nik: string): string {
  const digits = nik.replace(/\D/g, "");
  if (digits.length < 8) return "****";
  return `${digits.slice(0, 2)}****${digits.slice(-4)}`;
}

/** Masking nomor HP: 081234567890 -> 0812****7890 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return "****";
  return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
}
