import { describe, expect, it } from "vitest";
import { safeLog } from "./safe-logger";
import { isRoleAllowed, requirePermission } from "./api-auth-guard";
import { loadEnv } from "./env-loader";

describe("Fix files dari Bug Hunter", () => {
  it("safeLog tidak membocorkan NIK", () => {
    const spy = console.info;
    let captured = "";
    console.info = (value: string) => {
      captured = value;
    };
    safeLog("info", "NIK 3501010101010001");
    console.info = spy;
    expect(captured).not.toContain("3501010101010001");
    expect(captured).toContain("[REDACTED]");
  });

  it("guard memblokir resepsionis membaca diagnosis", () => {
    expect(isRoleAllowed("RESEPSIONIS", "diagnosis:read")).toBe(false);
    expect(isRoleAllowed("DOKTER", "diagnosis:read")).toBe(true);
    expect(() => requirePermission("RESEPSIONIS", "diagnosis:read")).toThrow();
  });

  it("env-loader menolak kunci pendek", () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: "file:./dev.db",
        NEXTAUTH_SECRET: "short",
        FIELD_ENCRYPTION_KEY: "short"
      })
    ).toThrow();
  });
});
