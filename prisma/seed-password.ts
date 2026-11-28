/** Password default untuk akun uji lokal seperti yang didokumentasikan di README. */
export const LOCAL_SEED_PASSWORD = "password123";

/**
 * `.env.example` menyimpan `SEED_PASSWORD=""` sebagai placeholder. Nilai kosong
 * (atau hanya spasi) harus diperlakukan seperti variabel yang tidak diisi,
 * supaya seed lokal memakai password uji yang terdokumentasi.
 *
 * Password kustom tidak di-trim agar spasi di dalamnya tetap dipertahankan.
 */
export function resolveSeedPassword(value: string | undefined): string {
  return value && value.trim().length > 0 ? value : LOCAL_SEED_PASSWORD;
}
