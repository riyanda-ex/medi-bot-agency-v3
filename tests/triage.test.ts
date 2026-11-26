import { describe, expect, it } from "vitest";
import { evaluateTriage, RED_KEYWORDS } from "../lib/triageRules";

const normal = {
  systolic: 120,
  diastolic: 80,
  glucose: 100,
  saturation: 98,
  pulse: 72,
  temperature: 36.8,
  potassium: 4.0,
  hemoglobin: 13,
  platelets: 250_000
};

describe("MEDI-BOT triage rules - 10 tes sesuai Definition of Done", () => {
  it("1. TD 190/120 harus MERAH dengan dua alasan", () => {
    const result = evaluateTriage({ ...normal, systolic: 190, diastolic: 120 });
    expect(result.level).toBe("MERAH");
    expect(result.reasons.some((reason) => reason.includes("190"))).toBe(true);
    expect(result.reasons.some((reason) => reason.includes("120"))).toBe(true);
  });

  it("2. Diastolik 115 saja sudah MERAH", () => {
    const result = evaluateTriage({ ...normal, diastolic: 115 });
    expect(result.level).toBe("MERAH");
    expect(result.reasons[0]).toContain("diastolik");
  });

  it("3. Gula 320 dan gula 45 keduanya MERAH", () => {
    expect(evaluateTriage({ ...normal, glucose: 320 }).level).toBe("MERAH");
    expect(evaluateTriage({ ...normal, glucose: 45 }).level).toBe("MERAH");
  });

  it("4. Saturasi 88 MERAH, saturasi 90 tidak MERAH", () => {
    expect(evaluateTriage({ ...normal, saturation: 88 }).level).toBe("MERAH");
    expect(evaluateTriage({ ...normal, saturation: 90 }).level).toBe("HIJAU");
  });

  it("5. Nadi 125 atau 38 MERAH, batas 120/40 tidak", () => {
    expect(evaluateTriage({ ...normal, pulse: 125 }).level).toBe("MERAH");
    expect(evaluateTriage({ ...normal, pulse: 38 }).level).toBe("MERAH");
    expect(evaluateTriage({ ...normal, pulse: 120 }).level).toBe("HIJAU");
    expect(evaluateTriage({ ...normal, pulse: 40 }).level).toBe("HIJAU");
  });

  it("6. Suhu 39.5, kalium 6.1, Hb 6.9, trombosit 49000 MERAH", () => {
    const result = evaluateTriage({
      ...normal,
      temperature: 39.5,
      potassium: 6.1,
      hemoglobin: 6.9,
      platelets: 49_000
    });
    expect(result.level).toBe("MERAH");
    expect(result.reasons).toHaveLength(4);
  });

  it("7. Kelima keyword MERAH terdeteksi dari anamnesis", () => {
    for (const keyword of RED_KEYWORDS) {
      const result = evaluateTriage({ ...normal, notes: `Pasien mengeluh ${keyword} sejak tadi.` });
      expect(result.level).toBe("MERAH");
      expect(result.reasons.join(" ")).toContain(keyword);
    }
  });

  it("8. Kontrol >7 hari, obat 3 hari, lab ringan = KUNING", () => {
    const result = evaluateTriage({
      ...normal,
      daysSinceControl: 8,
      chronicMedicationDaysLeft: 3,
      mildLabAbnormal: true
    });
    expect(result.level).toBe("KUNING");
    expect(result.reasons).toHaveLength(3);
  });

  it("9. Vital normal = HIJAU, lengkap, tidak perlu review", () => {
    const result = evaluateTriage(normal);
    expect(result.level).toBe("HIJAU");
    expect(result.dataComplete).toBe(true);
    expect(result.needsReview).toBe(false);
    expect(result.score).toBe(100);
  });

  it("10. Data kosong tetap HIJAU tetapi ditandai perlu review", () => {
    const result = evaluateTriage({});
    expect(result.level).toBe("HIJAU");
    expect(result.needsReview).toBe(true);
    expect(result.missingFields).toHaveLength(9);
    expect(result.score).toBe(0);
  });
});
