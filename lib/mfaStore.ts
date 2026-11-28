/**
 * Operasi MFA yang harus bersifat atomik terhadap penyimpanan.
 *
 * `consumeRecoveryCode` murni menghitung hash baru; di sini hash lama dipakai
 * sebagai syarat UPDATE agar dua permintaan konkuren tidak bisa memakai kode
 * pemulihan yang sama dua kali.
 */

import { consumeRecoveryCode } from "@/lib/mfa";
import { prisma } from "@/lib/prisma";

export async function consumeRecoveryCodeForUser(
  userId: string,
  stored: string | null,
  code: string
): Promise<boolean> {
  const result = consumeRecoveryCode(stored, code);
  if (!result.ok) return false;

  const claimed = await prisma.user.updateMany({
    where: { id: userId, mfaEnabled: true, mfaRecoveryHash: stored },
    data: { mfaRecoveryHash: result.remaining || null }
  });
  return claimed.count === 1;
}
