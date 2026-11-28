/**
 * Validasi konfigurasi lingkungan.
 * Nilai placeholder dari .env.example TIDAK boleh diterima saat runtime produksi.
 * Fungsi ini sengaja dipanggil saat runtime (bukan saat next build) agar build
 * tidak gagal pada mesin pengembangan yang masih memakai kunci contoh.
 */

const PLACEHOLDER_MARKERS = [
  "GANTI_",
  "GANTI ",
  "CHANGE_",
  "CHANGEME",
  "CI-ONLY",
  "PLACEHOLDER"
] as const;
// Nilai DEV-ONLY boleh dipakai di pengembangan agar data uji lama tetap bisa
// didekripsi, tetapi harus ditolak di produksi.
const INSECURE_MARKERS = [...PLACEHOLDER_MARKERS, "DEV-ONLY"] as const;

function includesMarker(value: string | null | undefined, markers: readonly string[]): boolean {
  if (!value) return true;
  const upper = value.trim().toUpperCase();
  return markers.some((marker) => upper.includes(marker));
}

/** Placeholder template yang jelas tidak boleh dipakai. */
export function isPlaceholderSecret(value: string | null | undefined): boolean {
  return includesMarker(value, PLACEHOLDER_MARKERS);
}

/** Placeholder + kunci DEV/CI: tidak boleh dipakai di produksi. */
export function isInsecureSecret(value: string | null | undefined): boolean {
  return includesMarker(value, INSECURE_MARKERS);
}

export function isStrongSecret(value: string | null | undefined, minimumBytes = 32): boolean {
  return !isPlaceholderSecret(value) && Buffer.byteLength(value ?? "", "utf8") >= minimumBytes;
}

export function isProductionSecret(value: string | null | undefined, minimumBytes = 32): boolean {
  return !isInsecureSecret(value) && Buffer.byteLength(value ?? "", "utf8") >= minimumBytes;
}

/** Produksi nyata: NODE_ENV=production dan bukan fase build Next.js. */
export function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build"
  );
}

/** Di produksi approval manusia tidak boleh dinonaktifkan lewat env. */
export function requireHumanApproval(): boolean {
  return isProductionRuntime() || process.env.REQUIRE_HUMAN_APPROVAL !== "false";
}

export interface EnvironmentCheck {
  production: boolean;
  outboundAllowed: boolean;
  approvalRequired: boolean;
  queueMode: "sync" | "redis";
}

/**
 * Tolak konfigurasi yang membuat JWT/kunci dapat dipalsukan.
 * Melempar error hanya pada runtime produksi; mode pengembangan tetap bisa
 * memakai nilai contoh dengan peringatan.
 */
export function assertSecureEnvironment(): EnvironmentCheck {
  const production = isProductionRuntime();
  const errors: string[] = [];

  if (production) {
    if (!isProductionSecret(process.env.NEXTAUTH_SECRET)) {
      errors.push("NEXTAUTH_SECRET harus acak, bukan nilai DEV/CI, dan minimal 32 byte");
    }
    if (!isProductionSecret(process.env.FIELD_ENCRYPTION_KEY)) {
      errors.push("FIELD_ENCRYPTION_KEY harus acak dan minimal 32 byte");
    }
    if (process.env.SYNC_MODE === "true") {
      errors.push("SYNC_MODE=true tidak boleh dipakai di produksi");
    }
    if (process.env.REQUIRE_HUMAN_APPROVAL === "false") {
      errors.push("REQUIRE_HUMAN_APPROVAL tidak boleh false di produksi");
    }
    if (!isStrongSecret(process.env.READY_TOKEN, 16)) {
      errors.push("READY_TOKEN wajib acak minimal 16 byte di produksi untuk /api/ready");
    }
    const nextAuthUrl = process.env.NEXTAUTH_URL ?? "";
    const isLocalhostHttp = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(nextAuthUrl);
    if (!nextAuthUrl.startsWith("https://") && !isLocalhostHttp) {
      errors.push("NEXTAUTH_URL produksi wajib https:// (http://localhost hanya untuk CI/lokal)");
    }
    // Rate limit terpusat wajib di produksi kecuali eksplisit diizinkan untuk single-instance.
    if (
      process.env.RATE_LIMIT_MODE === "memory" &&
      process.env.ALLOW_INSECURE_MEMORY_RATE_LIMIT !== "true"
    ) {
      errors.push(
        "RATE_LIMIT_MODE=memory tidak diizinkan di produksi; gunakan redis atau set ALLOW_INSECURE_MEMORY_RATE_LIMIT=true untuk single-instance yang dipahami risikonya"
      );
    }
    if (
      process.env.RATE_LIMIT_MODE === "redis" &&
      !(process.env.RATE_LIMIT_REDIS_URL || process.env.REDIS_URL)
    ) {
      errors.push("RATE_LIMIT_MODE=redis butuh RATE_LIMIT_REDIS_URL atau REDIS_URL");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Konfigurasi produksi tidak aman: ${errors.join("; ")}.`);
  }

  return {
    production,
    outboundAllowed: process.env.ALLOW_REAL_OUTBOUND === "true",
    approvalRequired: requireHumanApproval(),
    queueMode: process.env.QUEUE_MODE === "redis" ? "redis" : "sync"
  };
}
