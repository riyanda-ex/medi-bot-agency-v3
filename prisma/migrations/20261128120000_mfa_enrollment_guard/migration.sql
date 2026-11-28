-- Pendaftaran MFA disimpan server-side agar klien tidak bisa memilih secret sendiri.

ALTER TABLE "User" ADD COLUMN "mfaPendingSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "mfaPendingRecoveryHash" TEXT;
ALTER TABLE "User" ADD COLUMN "mfaPendingExpiresAt" DATETIME;
