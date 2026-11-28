/**
 * Guard destruktif untuk seed. Modul ini sengaja bebas efek samping agar bisa
 * diuji langsung: tidak membuka koneksi database dan tidak membaca .env.
 */
import { randomBytes } from "node:crypto";
import { isProductionRuntime, isProductionSecret } from "../lib/env";

const ALLOWED_SEED_ENVS = new Set(["development", "test"]);
const MIN_LOCAL_PASSWORD_BYTES = 12;

export type SeedEnvironment = "development" | "test" | "blocked";

export function detectSeedEnvironment(): SeedEnvironment {
  if (isProductionRuntime()) return "blocked";
  const nodeEnv = (process.env.NODE_ENV ?? "development").trim().toLowerCase();
  return ALLOWED_SEED_ENVS.has(nodeEnv) ? (nodeEnv as "development" | "test") : "blocked";
}

/**
 * Seed menghapus seluruh tabel. Penghapusan hanya boleh terjadi di
 * development/test DAN dengan konfirmasi eksplisit ALLOW_DESTRUCTIVE_SEED=1.
 */
export function assertDestructiveSeedAllowed(): void {
  if (isProductionRuntime()) {
    throw new Error(
      "[SEED] Seed destruktif diblokir di produksi. Jangan pernah menjalankan seed pada data pasien nyata."
    );
  }
  if (detectSeedEnvironment() === "blocked") {
    throw new Error("[SEED] Seed hanya diizinkan dengan NODE_ENV=development atau NODE_ENV=test.");
  }
  if (process.env.ALLOW_DESTRUCTIVE_SEED !== "1") {
    throw new Error(
      "[SEED] Set ALLOW_DESTRUCTIVE_SEED=1 secara eksplisit untuk mengizinkan penghapusan data uji."
    );
  }
}

/**
 * Kata sandi akun uji tidak pernah ditanam di kode. Jika tidak disediakan,
 * kata sandi acak dibuat dan dicetak sekali untuk sesi pengembangan tersebut.
 */
export function resolveSeedAdminPassword(): string {
  const configured = process.env.SEED_ADMIN_PASSWORD;
  if (configured) {
    if (isProductionRuntime() && !isProductionSecret(configured)) {
      throw new Error(
        "[SEED] SEED_ADMIN_PASSWORD produksi wajib acak, bukan placeholder/CI, minimal 32 byte."
      );
    }
    if (Buffer.byteLength(configured, "utf8") < MIN_LOCAL_PASSWORD_BYTES) {
      throw new Error(
        `[SEED] SEED_ADMIN_PASSWORD minimal ${MIN_LOCAL_PASSWORD_BYTES} byte untuk akun uji.`
      );
    }
    return configured;
  }

  if (isProductionRuntime()) {
    throw new Error("[SEED] SEED_ADMIN_PASSWORD wajib diisi di produksi.");
  }

  const generated = randomBytes(24).toString("base64url");
  console.log("[SEED] SEED_ADMIN_PASSWORD tidak diisi. Kata sandi uji dibuat acak (sekali):");
  console.log(`[SEED] ${generated}`);
  return generated;
}
