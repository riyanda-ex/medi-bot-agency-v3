import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import {
  isInsecureSecret,
  isPlaceholderSecret,
  isProductionRuntime,
  isProductionSecret
} from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "v1";
const DEV_KEY_MATERIAL = "MEDI-BOT-AGENCY-V3-DEV-ONLY-DO-NOT-USE-IN-PRODUCTION";

function deriveKey(material: string): Buffer {
  return createHash("sha256").update(material).digest();
}

let cachedKey: Buffer | null = null;
let cachedSigningKey: Buffer | null = null;
let cachedHmacKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.FIELD_ENCRYPTION_KEY;

  const usableLength = Buffer.byteLength(raw ?? "", "utf8") >= 32;
  if (usableLength && !isInsecureSecret(raw)) {
    cachedKey = deriveKey(raw as string);
    return cachedKey;
  }

  // Nilai DEV-ONLY/CI-ONLY masih diterima di pengembangan agar data uji lama
  // dapat didekripsi. Di produksi kunci tersebut harus ditolak.
  if (usableLength && !isPlaceholderSecret(raw)) {
    if (isProductionRuntime()) {
      throw new Error("Produksi menolak kunci DEV/CI. FIELD_ENCRYPTION_KEY wajib kunci acak.");
    }
    cachedKey = deriveKey(raw as string);
    return cachedKey;
  }

  if (isProductionRuntime()) {
    throw new Error(
      "Produksi menolak fallback kunci DEV. FIELD_ENCRYPTION_KEY wajib kunci acak minimal 32 byte."
    );
  }

  if (process.env.SYNC_MODE === "true") {
    console.warn(
      "[SECURITY] FIELD_ENCRYPTION_KEY tidak diisi. Memakai kunci DEV turunan untuk testing. " +
        "Jangan gunakan untuk data pasien nyata."
    );
    cachedKey = deriveKey(DEV_KEY_MATERIAL);
    return cachedKey;
  }

  throw new Error(
    "FIELD_ENCRYPTION_KEY wajib diisi dengan kunci rahasia minimal 32 byte " +
      "(atau set SYNC_MODE=true untuk testing)."
  );
}

/**
 * Kunci HMAC sengaja dipisah dari kunci enkripsi field. Domain separation
 * mencegah tanda tangan job/audit diturunkan langsung dari kunci enkripsi.
 */
function signingKey(): Buffer {
  if (cachedSigningKey) return cachedSigningKey;
  const secret = process.env.NEXTAUTH_SECRET;
  const fieldKey = process.env.FIELD_ENCRYPTION_KEY;
  const production = isProductionRuntime();
  const acceptable = (value: string | null | undefined): boolean =>
    Buffer.byteLength(value ?? "", "utf8") >= 32 &&
    (production ? isProductionSecret(value) : !isPlaceholderSecret(value));
  const material = acceptable(secret)
    ? (secret as string)
    : acceptable(fieldKey)
      ? (fieldKey as string)
      : DEV_KEY_MATERIAL;
  cachedSigningKey = createHash("sha256").update(`hmac-signing-v1|${material}`).digest();
  return cachedSigningKey;
}

function hmacKey(): Buffer {
  if (cachedHmacKey) return cachedHmacKey;
  cachedHmacKey = createHmac("sha256", signingKey()).update("field-hash-v1").digest();
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

/** Dekripsi nilai yang dibuat encryptField. Teks lama tanpa prefix hanya diterima di dev. */
export function decryptField(payload: string): string {
  if (!payload.startsWith(`${PREFIX}:`)) {
    if (isProductionRuntime()) {
      throw new Error("Data field tidak terenkripsi. Migrasikan data sebelum produksi.");
    }
    return payload;
  }
  const parts = payload.split(":");
  if (parts.length !== 4) {
    throw new Error("Format field terenkripsi tidak valid.");
  }
  const [, ivHex, tagHex, cipherHex] = parts;
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(cipherHex, "hex")), decipher.final()]).toString(
    "utf8"
  );
}

/** Hash deterministik untuk deteksi duplikat NIK tanpa menyimpan NIK plaintext. */
export function fieldHash(value: string): string {
  return createHmac("sha256", hmacKey()).update(value).digest("hex");
}

/** Tanda tangan HMAC untuk payload job antrean dan integrity audit. */
export function signPayload(value: string): string {
  return createHmac("sha256", signingKey()).update(`payload-signature-v1|${value}`).digest("hex");
}

/** Verifikasi tanda tangan dengan perbandingan konstan. */
export function verifyPayloadSignature(value: string, signature: string): boolean {
  const expected = Buffer.from(signPayload(value), "hex");
  const actual = Buffer.from(signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
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
