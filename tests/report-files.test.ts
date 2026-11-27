import { describe, expect, it } from "vitest";
import { resolveReportPath } from "../lib/reportFiles";
import path from "node:path";

describe("reportFiles", () => {
  it("allows report path inside reports dir", () => {
    const p = path.join(process.cwd(), "reports", "a.pdf");
    expect(resolveReportPath(p)).toBe(p);
  });
  it("rejects path traversal", () => {
    expect(() => resolveReportPath(path.join(process.cwd(), "reports", "..", ".env"))).toThrow();
  });
});
