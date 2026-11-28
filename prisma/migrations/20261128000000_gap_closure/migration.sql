-- Gap-closure: MFA, reset kata sandi, approval sekali pakai, DSR, retensi 25 tahun,
-- dan tanda tangan elektronik rekam medis. SQLite (development/test).

ALTER TABLE "User" ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "mfaSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "mfaRecoveryHash" TEXT;

ALTER TABLE "Patient" ADD COLUMN "legalHold" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "MedicalRecord" ADD COLUMN "signedBy" TEXT;
ALTER TABLE "MedicalRecord" ADD COLUMN "signedRole" TEXT;
ALTER TABLE "MedicalRecord" ADD COLUMN "signedAt" DATETIME;
ALTER TABLE "MedicalRecord" ADD COLUMN "signature" TEXT;

CREATE TABLE "ApprovalUse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "approvalId" TEXT NOT NULL,
    "consumptionKey" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "usedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "ApprovalUse_approvalId_consumptionKey_key" ON "ApprovalUse"("approvalId", "consumptionKey");
CREATE INDEX "ApprovalUse_approvalId_idx" ON "ApprovalUse"("approvalId");

CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_createdAt_idx" ON "PasswordResetToken"("userId", "createdAt");

CREATE TABLE "DataSubjectRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "notes" TEXT,
    "openKey" TEXT,
    CONSTRAINT "DataSubjectRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DataSubjectRequest_openKey_key" ON "DataSubjectRequest"("openKey");
CREATE INDEX "DataSubjectRequest_patientId_requestedAt_idx" ON "DataSubjectRequest"("patientId", "requestedAt");
CREATE INDEX "DataSubjectRequest_status_dueAt_idx" ON "DataSubjectRequest"("status", "dueAt");

-- Indeks untuk filter panas yang dipakai dashboard/audit/urgent caller.
CREATE INDEX "UrgentCall_patientId_createdAt_idx" ON "UrgentCall"("patientId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX "Patient_createdAt_idx" ON "Patient"("createdAt");
