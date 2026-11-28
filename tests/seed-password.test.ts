import { describe, expect, it } from "vitest";
import { LOCAL_SEED_PASSWORD, resolveSeedPassword } from "../prisma/seed-password";

describe("resolveSeedPassword", () => {
  it("memakai password uji lokal bila variabel tidak diisi", () => {
    expect(resolveSeedPassword(undefined)).toBe(LOCAL_SEED_PASSWORD);
    expect(resolveSeedPassword("")).toBe(LOCAL_SEED_PASSWORD);
    expect(resolveSeedPassword("   ")).toBe(LOCAL_SEED_PASSWORD);
  });

  it("mempertahankan password kustom apa adanya", () => {
    const custom = "RahasiaKlinik2026!";
    expect(resolveSeedPassword(custom)).toBe(custom);
    expect(resolveSeedPassword(" password dengan spasi ")).toBe(" password dengan spasi ");
  });
});
