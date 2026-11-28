/**
 * Satu sumber zona waktu untuk seluruh aplikasi: WIB (UTC+7).
 * UI approval dan scheduler laporan wajib memakai helper yang sama agar
 * resourceId approval REPORT tidak beda hari antara pukul 00:00–07:00 WIB.
 */

const WIB_OFFSET_MS = 7 * 3_600_000;

/** Kunci tanggal WIB (`YYYY-MM-DD`), bukan tanggal UTC. */
export function wibDateKey(date: Date = new Date()): string {
  return new Date(date.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** Rentang UTC untuk satu hari kalender WIB. */
export function wibDayRange(date: Date = new Date()): { start: Date; end: Date } {
  const [year, month, day] = wibDateKey(date).split("-").map(Number);
  return {
    start: new Date(Date.UTC(year as number, (month as number) - 1, day as number, -7)),
    end: new Date(Date.UTC(year as number, (month as number) - 1, (day as number) + 1, -7))
  };
}
