import { describe, expect, it } from "vitest";
import { auditCanonicalPayload, verifyAuditRows } from "../lib/auditIntegrity";
import { signPayload } from "../lib/crypto";

const base = {
  id: "audit-1",
  actorId: "user-1",
  role: "DOKTER",
  action: "PATIENT_READ",
  ipAddress: "127.0.0.1",
  targetPatientId: "patient-1",
  detail: "lihat rekam medis",
  signature: null
};

describe("verifikasi integritas audit log", () => {
  it("menerima baris yang ditandatangani dengan canonical yang benar", () => {
    const canonical = auditCanonicalPayload(base);
    const result = verifyAuditRows([{ ...base, signature: signPayload(canonical) }]);
    expect(result).toMatchObject({ checked: 1, valid: 1, unsigned: 0, invalid: 0 });
  });

  it("menolak baris tanpa tanda tangan", () => {
    const result = verifyAuditRows([{ ...base, signature: null }]);
    expect(result).toMatchObject({ checked: 1, unsigned: 1, invalidIds: ["audit-1"] });
  });

  it("menolak tanda tangan yang tidak cocok setelah detail diubah", () => {
    const canonical = auditCanonicalPayload(base);
    const result = verifyAuditRows([
      { ...base, detail: `${base.detail} (diubah)`, signature: signPayload(canonical) }
    ]);
    expect(result.invalid).toBe(1);
    expect(result.invalidIds).toContain("audit-1");
  });
});
