import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 1,
    retryAfterSeconds: 0,
    backend: "memory"
  })),
  rateLimitResponse: (r: unknown) => new Response(JSON.stringify(r), { status: 429 })
}));
vi.mock("@/lib/audit", () => ({ getRequestIp: () => "1.2.3.4" }));

import {
  enforceBodySize,
  enforceRateLimit,
  enforceSameOrigin,
  getClientIp,
  hasCsrfHeader,
  isCookieAuthenticated,
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

  it("cookie POST tanpa Origin/CSRF ditolak", () => {
    const req = new Request("http://localhost/api/x", {
      method: "POST",
      headers: { cookie: "authjs.session-token=abc" }
    });
    expect(isCookieAuthenticated(req)).toBe(true);
    expect(hasCsrfHeader(req)).toBe(false);
    expect(isSameOrigin(req)).toBe(false);
    expect(enforceSameOrigin(req)?.status).toBe(403);
  });

  it("cookie POST dengan Origin sama atau header CSRF diizinkan", () => {
    const withOrigin = new Request("http://localhost/api/x", {
      method: "POST",
      headers: { cookie: "authjs.session-token=abc", origin: "http://localhost" }
    });
    const withCsrf = new Request("http://localhost/api/x", {
      method: "POST",
      headers: { cookie: "authjs.session-token=abc", "x-csrf-token": "token" }
    });
    expect(isSameOrigin(withOrigin)).toBe(true);
    expect(isSameOrigin(withCsrf)).toBe(true);
  });

  it("klien bearer tanpa Origin tetap diizinkan", () => {
    const req = new Request("http://localhost/api/x", {
      method: "POST",
      headers: { authorization: "Bearer abc" }
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("enforceBodySize menolak payload besar", async () => {
    const big = new Request("http://localhost/api/x", {
      method: "POST",
      body: "x".repeat(100)
    });
    const small = new Request("http://localhost/api/x", {
      method: "POST",
      body: "x".repeat(5)
    });
    expect((await enforceBodySize(big, 10)).response?.status).toBe(413);
    const guarded = await enforceBodySize(small, 10);
    expect(guarded.response).toBeNull();
    expect(await guarded.request.text()).toBe("x".repeat(5));
  });
});
