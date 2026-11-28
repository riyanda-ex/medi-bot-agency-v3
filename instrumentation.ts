/**
 * Next.js 16 memanggil `register` sekali saat server instance dimulai dan
 * menunggu sampai selesai sebelum menerima request. Validasi konfigurasi
 * produksi dilakukan di sini agar secret placeholder tidak bisa dipakai
 * untuk memalsukan JWT/HMAC walaupun endpoint tertentu belum dipanggil.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertSecureEnvironment } = await import("./lib/env");
  assertSecureEnvironment();

  if (process.env.ENABLE_SCHEDULER !== "true") return;
  const { startScheduler } = await import("./agents/orchestrator");
  startScheduler();
}
