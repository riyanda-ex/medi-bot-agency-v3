import { prisma } from "@/lib/prisma";

export interface ProxyTokenShape {
  sub?: string;
  role?: unknown;
  invalid?: unknown;
  tokenVersion?: number;
}

/**
 * `getToken()` di proxy hanya membaca cookie; callback JWT NextAuth tidak dijalankan di sana.
 * Karena itu status/role/tokenVersion harus diverifikasi ulang ke DB sebelum halaman dibuka.
 */
export async function isProxySessionValid(token: ProxyTokenShape | null): Promise<boolean> {
  if (!token || token.invalid === true || !token.sub) return false;
  try {
    const user = await prisma.user.findUnique({
      where: { id: token.sub },
      select: { role: true, status: true, tokenVersion: true }
    });
    if (!user || user.status !== "AKTIF") return false;
    return user.tokenVersion === (token.tokenVersion ?? 0);
  } catch {
    // Fail-closed: saat DB bermasalah, jangan izinkan akses halaman terlindungi.
    return false;
  }
}
