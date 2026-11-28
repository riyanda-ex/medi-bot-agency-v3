import { describe, expect, it } from "vitest";
import {
  addYears,
  canAnonymizePatient,
  consentRetentionUntil,
  dsrDueAt,
  DSR_SLA_HOURS,
  latestVisitDate
} from "../lib/privacy";
import { generateResetToken, hashResetToken } from "../lib/passwordReset";

describe("kebijakan retensi dan SLA", () => {
  it("25 tahun dihitung dari kunjungan terakhir", () => {
    const last = new Date("2026-03-15T00:00:00.000Z");
    const until = consentRetentionUntil(last);
    expect(until.getUTCFullYear()).toBe(2051);
    expect(until.getUTCMonth()).toBe(2);
  });

  it("retensi 30 hari tanpa kunjungan tidak diperpanjang sweep berulang", () => {
    const now = new Date("2026-11-28T00:00:00.000Z");
    const first = consentRetentionUntil(null, now);
    const again = consentRetentionUntil(null, new Date("2026-12-05T00:00:00.000Z"), first);
    expect(again.getTime()).toBe(first.getTime());
    expect(
      canAnonymizePatient(
        {
          consentStatus: "REVOKED",
          consentRevokedAt: now,
          retentionUntil: first,
          legalHold: false,
          deletedAt: null
        },
        new Date("2026-12-28T00:00:00.000Z")
      )
    ).toBe(true);
  });

  it("29 Februari digeser aman ke 28 Februari", () => {
    expect(addYears(new Date("2024-02-29T00:00:00.000Z"), 1).toISOString()).toBe(
      "2025-02-28T00:00:00.000Z"
    );
  });

  it("SLA hak subjek data 3x24 jam", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(DSR_SLA_HOURS).toBe(72);
    expect(dsrDueAt(now).toISOString()).toBe("2026-01-04T00:00:00.000Z");
  });

  it("mengambil kunjungan paling baru", () => {
    const latest = latestVisitDate([
      { visitDate: new Date("2024-01-01T00:00:00Z") },
      { visitDate: new Date("2025-06-01T00:00:00Z") }
    ]);
    expect(latest?.getUTCFullYear()).toBe(2025);
  });

  it("melarang anonimisasi saat legal hold atau retensi belum habis", () => {
    const base = {
      consentStatus: "REVOKED",
      consentRevokedAt: new Date("2020-01-01T00:00:00Z"),
      retentionUntil: new Date("2045-01-01T00:00:00Z"),
      deletedAt: null
    };
    expect(canAnonymizePatient(base, new Date("2026-01-01T00:00:00Z"))).toBe(false);
    expect(
      canAnonymizePatient({ ...base, legalHold: true }, new Date("2050-01-01T00:00:00Z"))
    ).toBe(false);
    expect(canAnonymizePatient(base, new Date("2050-01-01T00:00:00Z"))).toBe(true);
  });
});

describe("token reset kata sandi", () => {
  it("hash stabil untuk token sama dan berbeda untuk token lain", () => {
    const token = generateResetToken();
    expect(hashResetToken(token)).toBe(hashResetToken(token));
    expect(hashResetToken(token)).not.toBe(hashResetToken(generateResetToken()));
    expect(token).not.toContain(hashResetToken(token));
  });
});
