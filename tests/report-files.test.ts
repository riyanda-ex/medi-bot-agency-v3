import { describe, expect, it } from "vitest";
import { resolveReportPath } from "../lib/reportFiles";
import { wibDateKey, wibDayRange } from "../lib/date";
import path from "node:path";

describe("reportFiles", () => {
  it("allows report path inside reports dir", () => {
    const p = path.join(process.cwd(), "reports", "a.pdf");
    expect(resolveReportPath(p)).toBe(p);
  });
  it("rejects path traversal", () => {
    expect(() => resolveReportPath(path.join(process.cwd(), "reports", "..", ".env"))).toThrow();
  });
  it("allows filenames starting with two dots as long as they stay in reports", () => {
    const p = path.join(process.cwd(), "reports", "..laporan.xlsx");
    expect(resolveReportPath(p)).toBe(p);
  });
  it("only allows pdf and xlsx report extensions", () => {
    const html = path.join(process.cwd(), "reports", "laporan.html");
    expect(() => resolveReportPath(html)).toThrow(/Ekstensi/);
  });
});

describe("WIB date helper", () => {
  it("uses UTC+7 calendar day, not UTC ISO date", () => {
    const lateUtc = new Date("2026-11-28T20:30:00.000Z");
    expect(wibDateKey(lateUtc)).toBe("2026-11-29");
    expect(wibDateKey(new Date("2026-11-28T16:30:00.000Z"))).toBe("2026-11-28");
  });
  it("returns a 24h UTC range shifted by WIB offset", () => {
    const { start, end } = wibDayRange(new Date("2026-11-28T20:30:00.000Z"));
    expect(start.toISOString()).toBe("2026-11-28T17:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-29T17:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(24 * 3_600_000);
  });
});
