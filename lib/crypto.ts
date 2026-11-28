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
  isProductionRuntime,
  isProductionSecret,
  isKnownCiSecret
} from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const V1_PREFIX = "v1";
const V2_PREFIX = "v2";
const DEV_KEY_MATERIAL = "MEDI-BOT-AGENCY-V3-DEV-ONLY-DO-NOT-USE-IN-PRODUCTION";
const PREVIOUS_KEY_ENV_NAMES = [
  "FIELD_ENCRYPTION_KEY_PREVIOUS",
  "FIELD_ENCRYPTION_KEY_OLD",
  "FIELD_ENCRYPTION_KEY_V1"
] as const;

/** Pola placeholder/kunci contoh. DEV-ONLY sengaja tidak termasuk agar data uji lama terbaca. */
function isExampleKey(value: string | null | undefined): boolean {
  if (!value) return true;
  return /GANTI_|GANTI |CHANGE_|CHANGEME|CI-ONLY|PLACEHOLDER|DUMMY|SAMPLE|EXAMPLE/i.test(value);
}

function deriveKey(material: string): Buffer {
  return createHash("sha256").update(material).digest();
}

let cachedKey: Buffer | null = null;
let cachedPreviousKeys: Buffer[] | null = null;
let cachedLegacySigningKey: Buffer | null = null;
let cachedAppSigningKey: Buffer | null = null;
let cachedHmacKey: Buffer | null = null;

function isUsableKey(value: string | null | undefined): boolean {
  return Buffer.byteLength(value ?? "", "utf8") >= 32;
}

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  const production = isProductionRuntime();

  if (isUsableKey(raw) && !isInsecureSecret(raw) && !isKnownCiSecret(raw)) {
    cachedKey = deriveKey(raw as string);
    return cachedKey;
  }

  // Nilai DEV-ONLY masih diterima di pengembangan agar data uji lama dapat
  // didekripsi. Di produksi kunci tersebut harus ditolak.
  if (isUsableKey(raw) && !isExampleKey(raw)) {
    if (production) {
      throw new Error("Produksi menolak kunci DEV/CI. FIELD_ENCRYPTION_KEY wajib kunci acak.");
    }
    cachedKey = deriveKey(raw as string);
    return cachedKey;
  }

  if (production) {
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

/** Kunci lama dipakai hanya untuk dekripsi saat rotasi kunci field. */
function previousEncryptionKeys(): Buffer[] {
  if (cachedPreviousKeys) return cachedPreviousKeys;
  const production = isProductionRuntime();
  const keys: Buffer[] = [];
  for (const name of PREVIOUS_KEY_ENV_NAMES) {
    const raw = process.env[name];
    if (!isUsableKey(raw) || isExampleKey(raw)) continue;
    if (production && !isProductionSecret(raw)) continue;
    keys.push(deriveKey(raw as string));
  }
  cachedPreviousKeys = keys;
  return keys;
}

/** Kid adalah sidik jari kunci aktif, bukan nomor urut yang bisa ditebak. */
export function fieldKeyId(key: Buffer = encryptionKey()): string {
  return createHash("sha256").update("field-key-id-v1|").update(key).digest("hex").slice(0, 12);
}

function candidateEncryptionKeys(): Buffer[] {
  const active = encryptionKey();
  const seen = new Set<string>([fieldKeyId(active)]);
  const keys = [active];
  for (const key of previousEncryptionKeys()) {
    const id = fieldKeyId(key);
    if (seen.has(id)) continue;
    seen.add(id);
    keys.push(key);
  }
  return keys;
}

/**
 * Kunci HMAC lama sengaja dipertahankan untuk fieldHash(): hash NIK yang sudah
 * tersimpan harus tetap stabil walau APP_SIGNING_KEY ditambahkan.
 */
function legacySigningKey(): Buffer {
  if (cachedLegacySigningKey) return cachedLegacySigningKey;
  const secret = process.env.NEXTAUTH_SECRET;
  const fieldKey = process.env.FIELD_ENCRYPTION_KEY;
  const production = isProductionRuntime();
  const acceptable = (value: string | null | undefined): boolean =>
    isUsableKey(value) &&
    (production ? isProductionSecret(value) : !isExampleKey(value) && !isKnownCiSecret(value));
  const material = acceptable(secret)
    ? (secret as string)
    : acceptable(fieldKey)
      ? (fieldKey as string)
      : DEV_KEY_MATERIAL;
  cachedLegacySigningKey = createHash("sha256").update(`hmac-signing-v1|${material}`).digest();
  return cachedLegacySigningKey;
}

/**
 * APP_SIGNING_KEY berdiri sendiri: tidak diturunkan dari AUTH_SECRET,
 * NEXTAUTH_SECRET, maupun FIELD_ENCRYPTION_KEY.
 */
export function hasAppSigningKey(): boolean {
  return appSigningKey() !== null;
}

function appSigningKey(): Buffer | null {
  if (cachedAppSigningKey) return cachedAppSigningKey;
  const raw = process.env.APP_SIGNING_KEY;
  if (!isUsableKey(raw) || isExampleKey(raw) || isKnownCiSecret(raw)) return null;
  const authSecret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  const reused =
    raw?.trim() === process.env.FIELD_ENCRYPTION_KEY?.trim() || raw?.trim() === authSecret?.trim();
  if (reused || (isProductionRuntime() && !isProductionSecret(raw))) return null;
  cachedAppSigningKey = createHash("sha256").update(`app-signing-key-v1|${raw}`).digest();
  return cachedAppSigningKey;
}

function signingKey(): Buffer {
  return appSigningKey() ?? legacySigningKey();
}

function hmacKey(): Buffer {
  if (cachedHmacKey) return cachedHmacKey;
  cachedHmacKey = createHmac("sha256", legacySigningKey()).update("field-hash-v1").digest();
  return cachedHmacKey;
}

interface EncryptedParts {
  version: "v1" | "v2";
  kid?: string;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

function parseParts(payload: string): EncryptedParts {
  const parts = payload.split(":");
  const version = parts[0];
  if (version === V1_PREFIX && parts.length === 4) {
    return {
      version: "v1",
      iv: Buffer.from(parts[1], "hex"),
      tag: Buffer.from(parts[2], "hex"),
      ciphertext: Buffer.from(parts[3], "hex")
    };
  }
  if (version === V2_PREFIX && parts.length === 5 && /^[0-9a-f]{12}$/i.test(parts[1])) {
    return {
      version: "v2",
      kid: parts[1].toLowerCase(),
      iv: Buffer.from(parts[2], "hex"),
      tag: Buffer.from(parts[3], "hex"),
      ciphertext: Buffer.from(parts[4], "hex")
    };
  }
  throw new Error("Format field terenkripsi tidak valid.");
}

function decryptWithKey(parts: EncryptedParts, key: Buffer): string {
  if (parts.iv.length !== 12 || parts.tag.length !== 16) {
    throw new Error("Format field terenkripsi tidak valid.");
  }
  const decipher = createDecipheriv(ALGORITHM, key, parts.iv);
  decipher.setAuthTag(parts.tag);
  return Buffer.concat([decipher.update(parts.ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Enkripsi nilai sensitif. Format baru:
 * v2:<kid>:<iv>:<tag>:<ciphertext> (semua heksadesimal).
 */
export function encryptField(plaintext: string): string {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    V2_PREFIX,
    fieldKeyId(key),
    iv.toString("hex"),
    tag.toString("hex"),
    encrypted.toString("hex")
  ].join(":");
}

/**
 * Dekripsi format v2 (dengan kid) dan v1 (warisan). Teks lama tanpa prefix
 * hanya diterima di pengembangan.
 */
export function decryptField(payload: string): string {
  if (!payload.startsWith(`${V1_PREFIX}:`) && !payload.startsWith(`${V2_PREFIX}:`)) {
    if (isProductionRuntime()) {
      throw new Error("Data field tidak terenkripsi. Migrasikan data sebelum produksi.");
    }
    return payload;
  }

  const parts = parseParts(payload);
  if (parts.version === "v2") {
    const key = candidateEncryptionKeys().find((candidate) => fieldKeyId(candidate) === parts.kid);
    if (!key) throw new Error("Kunci enkripsi untuk kid tersebut tidak tersedia.");
    return decryptWithKey(parts, key);
  }

  let lastError: unknown;
  for (const key of candidateEncryptionKeys()) {
    try {
      return decryptWithKey(parts, key);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Gagal mendekripsi field.");
}

/** Enkripsi data PHI; memakai format versi yang sama dengan encryptField. */
export function encryptPhi(plaintext: string): string {
  return encryptField(plaintext);
}

/** Dekripsi data PHI (v1 atau v2). */
export function decryptPhi(payload: string): string {
  return decryptField(payload);
}

/** Hash deterministik untuk deteksi duplikat NIK tanpa menyimpan NIK plaintext. */
export function fieldHash(value: string): string {
  return createHmac("sha256", hmacKey()).update(value).digest("hex");
}

/** Tanda tangan HMAC untuk payload job antrean dan integrity audit. */
export function signPayload(value: string): string {
  return createHmac("sha256", signingKey()).update(`payload-signature-v1|${value}`).digest("hex");
}

function legacySignature(value: string): Buffer {
  return createHmac("sha256", legacySigningKey()).update(`payload-signature-v1|${value}`).digest();
}

/** Verifikasi tanda tangan dengan perbandingan konstan (mendukung kunci lama). */
export function verifyPayloadSignature(value: string, signature: string): boolean {
  const actual = Buffer.from(signature, "hex");
  if (actual.length !== 32) return false;
  const expected = Buffer.from(signPayload(value), "hex");
  if (expected.length === actual.length && timingSafeEqual(expected, actual)) return true;
  if (!hasAppSigningKey()) return false;
  const previous = legacySignature(value);
  return previous.length === actual.length && timingSafeEqual(previous, actual);
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
