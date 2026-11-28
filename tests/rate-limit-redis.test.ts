import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  production: false,
  evalCalls: [] as Array<[string, number, string, string]>
}));

vi.mock("@/lib/env", () => ({
  isProductionRuntime: () => state.production
}));

vi.mock("ioredis", () => ({
  default: class MockRedis {
    status = "ready";
    on(): void {}
    disconnect(): void {}
    async quit(): Promise<void> {}
    async eval(...args: [string, number, string, string]): Promise<[number, number]> {
      state.evalCalls.push(args);
      return [1, 60_000];
    }
  }
}));

import { checkRateLimit, closeRateLimitRedis } from "../lib/rateLimit";

const watchedEnv = [
  "RATE_LIMIT_MODE",
  "RATE_LIMIT_REDIS_URL",
  "REDIS_URL",
  "ALLOW_INSECURE_MEMORY_RATE_LIMIT"
] as const;
const originalEnv = new Map<string, string | undefined>(
  watchedEnv.map((key) => [key, process.env[key]])
);

beforeEach(() => {
  state.production = false;
  state.evalCalls.length = 0;
  delete process.env.RATE_LIMIT_REDIS_URL;
  delete process.env.REDIS_URL;
  delete process.env.ALLOW_INSECURE_MEMORY_RATE_LIMIT;
  process.env.RATE_LIMIT_MODE = "memory";
});

afterEach(async () => {
  await closeRateLimitRedis();
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Regresi rate limit Redis", () => {
  it("INCR dan PEXPIRE dikirim sebagai satu skrip Lua atomik", async () => {
    process.env.RATE_LIMIT_MODE = "redis";
    process.env.REDIS_URL = "redis://localhost:6379";

    const result = await checkRateLimit("atomic-key", 5, 1_000);

    expect(result).toMatchObject({ allowed: true, backend: "redis", remaining: 4 });
    expect(state.evalCalls).toHaveLength(1);
    const [script, keyCount, key, windowMs] = state.evalCalls[0] as [
      string,
      number,
      string,
      string
    ];
    expect(keyCount).toBe(1);
    expect(key).toBe("rl:atomic-key");
    expect(windowMs).toBe("1000");
    expect(script).toContain("redis.call('INCR'");
    expect(script).toContain("redis.call('PEXPIRE'");
    expect((script.match(/redis\.call/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("produksi fail-closed ketika Redis tidak tersedia", async () => {
    state.production = true;
    process.env.RATE_LIMIT_MODE = "memory";

    const result = await checkRateLimit("fail-closed-key", 5, 1_000);

    expect(result).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
    expect(state.evalCalls).toHaveLength(0);
  });

  it("fallback memori produksi hanya aktif bila eksplisit diizinkan", async () => {
    state.production = true;
    process.env.RATE_LIMIT_MODE = "memory";
    process.env.ALLOW_INSECURE_MEMORY_RATE_LIMIT = "true";

    await expect(checkRateLimit("opt-in-key", 5, 1_000)).resolves.toMatchObject({
      allowed: true,
      backend: "memory"
    });
  });
});
