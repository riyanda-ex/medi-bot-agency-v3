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
  "DEV-ONLY",
  "PLACEHOLDER",
  "DUMMY",
  "SAMPLE",
  "EXAMPLE"
] as const;
// Nilai DEV-ONLY boleh dipakai di pengembangan agar data uji lama tetap bisa
// didekripsi, tetapi harus ditolak di produksi.
const INSECURE_MARKERS = [...PLACEHOLDER_MARKERS] as const;

/**
 * Penanda lingkungan CI yang dikenal. Bila aktif, kunci yang masih berupa nilai
 * bawaan CI/GitHub/GitLab ditolak walaupun panjangnya tampak memadai.
 */
export const CI_ENV_MARKERS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "BUILDKITE",
  "JENKINS_URL",
  "BUILD_ID",
  "VERCEL"
] as const;

const CI_SECRET_VALUES = new Set([
  "ci",
  "true",
  "1",
  "yes",
  "github_actions",
  "gitlab_ci",
  "buildkite",
  "circleci",
  "runner",
  "test",
  "testing",
  "dummy",
  "sample",
  "example",
  "secret"
]);

function includesMarker(value: string | null | undefined, markers: readonly string[]): boolean {
  if (!value) return true;
  const upper = value.trim().toUpperCase();
  return markers.some((marker) => upper.includes(marker));
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "";
}

/** Placeholder template yang jelas tidak boleh dipakai. */
export function isPlaceholderSecret(value: string | null | undefined): boolean {
  return includesMarker(value, PLACEHOLDER_MARKERS);
}

/** Placeholder + kunci DEV/CI: tidak boleh dipakai di produksi. */
export function isInsecureSecret(value: string | null | undefined): boolean {
  return includesMarker(value, INSECURE_MARKERS);
}

/** Lingkungan CI dikenal dari penanda standar (bukan dari isi secret). */
export function isKnownCiEnvironment(): boolean {
  return CI_ENV_MARKERS.some((marker) => isTruthyFlag(process.env[marker]));
}

/** Nilai kunci yang jelas hasil provision CI/default, bukan kunci acak. */
export function isKnownCiSecret(value: string | null | undefined): boolean {
  if (!value || !isKnownCiEnvironment()) return false;
  const normalized = value.trim().toLowerCase();
  if (CI_SECRET_VALUES.has(normalized)) return true;
  return /(^|[-_])ci([-_]|$)/.test(normalized) && Buffer.byteLength(value, "utf8") < 64;
}

export function isStrongSecret(value: string | null | undefined, minimumBytes = 32): boolean {
  return (
    !isPlaceholderSecret(value) &&
    !isKnownCiSecret(value) &&
    Buffer.byteLength(value ?? "", "utf8") >= minimumBytes
  );
}

export function isProductionSecret(value: string | null | undefined, minimumBytes = 32): boolean {
  return (
    !isInsecureSecret(value) &&
    !isKnownCiSecret(value) &&
    Buffer.byteLength(value ?? "", "utf8") >= minimumBytes
  );
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
  rateLimitMode: "redis" | "memory";
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
    const authSecret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
    if (!isProductionSecret(authSecret)) {
      errors.push(
        "NEXTAUTH_SECRET/AUTH_SECRET harus acak, bukan nilai DEV/CI, dan minimal 32 byte"
      );
    }
    if (!isProductionSecret(process.env.FIELD_ENCRYPTION_KEY)) {
      errors.push("FIELD_ENCRYPTION_KEY harus acak dan minimal 32 byte");
    }
    const appSigningKey = process.env.APP_SIGNING_KEY;
    const fieldKey = process.env.FIELD_ENCRYPTION_KEY;
    if (appSigningKey) {
      const sameSecret =
        appSigningKey.trim() === fieldKey?.trim() || appSigningKey.trim() === authSecret?.trim();
      if (!isProductionSecret(appSigningKey) || sameSecret) {
        errors.push("APP_SIGNING_KEY harus acak, berbeda dari auth/field key, dan minimal 32 byte");
      }
    }
    if (isKnownCiEnvironment()) {
      const ciSecrets = [authSecret, fieldKey, appSigningKey];
      if (ciSecrets.some((value) => isKnownCiSecret(value))) {
        errors.push(
          "CI environment terdeteksi: secret tidak boleh memakai nilai bawaan CI/GitHub/GitLab"
        );
      }
    }
    if (process.env.SYNC_MODE === "true") {
      errors.push("SYNC_MODE=true tidak boleh dipakai di produksi");
    }
    if (process.env.REQUIRE_HUMAN_APPROVAL === "false") {
      errors.push("REQUIRE_HUMAN_APPROVAL tidak boleh false di produksi");
    }
    const nextAuthUrl = process.env.NEXTAUTH_URL ?? "";
    const isLocalhostHttp = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(nextAuthUrl);
    if (!nextAuthUrl.startsWith("https://") && !isLocalhostHttp) {
      errors.push("NEXTAUTH_URL produksi wajib https:// (http://localhost hanya untuk CI/lokal)");
    }
    // Produksi wajib memakai Redis terpusat. Memory fallback (walaupun dengan
    // ALLOW_INSECURE_MEMORY_RATE_LIMIT) tidak lagi diterima: tidak aman untuk
    // multi-instance dan memudahkan bypass rate limit.
    if (process.env.RATE_LIMIT_MODE !== "redis") {
      errors.push("RATE_LIMIT_MODE=redis wajib dipakai di produksi");
    }
    if (!process.env.REDIS_URL) {
      errors.push("REDIS_URL wajib diisi di produksi untuk rate limit terpusat");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Konfigurasi produksi tidak aman: ${errors.join("; ")}.`);
  }

  return {
    production,
    outboundAllowed: process.env.ALLOW_REAL_OUTBOUND === "true",
    approvalRequired: requireHumanApproval(),
    queueMode: process.env.QUEUE_MODE === "redis" ? "redis" : "sync",
    rateLimitMode: process.env.RATE_LIMIT_MODE === "redis" ? "redis" : "memory"
  };
}
