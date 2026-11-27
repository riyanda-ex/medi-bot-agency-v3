import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 })),
  rateLimitResponse: (r: unknown) => new Response(JSON.stringify(r), { status: 429 })
}));
vi.mock("@/lib/audit", () => ({ getRequestIp: () => "1.2.3.4" }));

import {
  enforceRateLimit,
  enforceSameOrigin,
  getClientIp,
  isSameOrigin
} from "../lib/requestGuard";
import { checkRateLimit } from "../lib/rateLimit";

describe("requestGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("getClientIp delegates", () => {
    expect(getClientIp(new Request("http://x"))).toBe("1.2.3.4");
  });
  it("enforceRateLimit allows", async () => {
    await expect(enforceRateLimit("k", 1, 1000)).resolves.toBeNull();
  });
  it("enforceRateLimit blocks", async () => {
    (
      checkRateLimit as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 3 });
    const res = await enforceRateLimit("k", 1, 1000);
    expect(res?.status).toBe(429);
  });
  it("isSameOrigin allows missing origin", () => {
    expect(isSameOrigin(new Request("http://localhost/api/x", { method: "POST" }))).toBe(true);
  });
  it("isSameOrigin blocks cross origin", () => {
    const req = new Request("http://localhost/api/x", { headers: { origin: "https://evil.test" } });
    expect(isSameOrigin(req)).toBe(false);
  });
  it("enforceSameOrigin returns 403", () => {
    const req = new Request("http://localhost/api/x", { headers: { origin: "https://evil.test" } });
    const res = enforceSameOrigin(req);
    expect(res?.status).toBe(403);
  });
});
