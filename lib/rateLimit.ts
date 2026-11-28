/**
 * Rate limiting: Redis-backed fixed window when REDIS_URL/RATE_LIMIT_REDIS_URL is configured,
 * otherwise in-memory fallback for single-instance/dev.
 *
 * Di produksi fallback memori DIHAPUS: bila Redis tidak terkonfigurasi atau
 * gagal, permintaan ditolak (fail-closed) dengan Retry-After.
 */

import Redis from "ioredis";
import { isProductionRuntime } from "@/lib/env";
import { logger } from "@/lib/logger";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let redis: Redis | null = null;
let redisUnavailableUntil = 0;
let warnedMemoryInProd = false;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  backend: "redis" | "memory";
}

function getRedisUrl(): string | undefined {
  return process.env.RATE_LIMIT_REDIS_URL || process.env.REDIS_URL;
}

function shouldUseRedis(): boolean {
  if (process.env.RATE_LIMIT_MODE === "memory") return false;
  if (process.env.RATE_LIMIT_MODE === "redis") return Boolean(getRedisUrl());
  return process.env.NODE_ENV === "production"
    ? Boolean(getRedisUrl())
    : Boolean(process.env.RATE_LIMIT_REDIS_URL);
}

function getRedis(): Redis | null {
  const url = getRedisUrl();
  if (!url || !shouldUseRedis()) return null;
  if (Date.now() < redisUnavailableUntil) return null;
  if (redis) return redis;
  redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    lazyConnect: true,
    ...(process.env.REDIS_TLS === "true" ? { tls: {} } : {})
  });
  redis.on("error", () => {
    redisUnavailableUntil = Date.now() + 30_000;
  });
  return redis;
}

/** Hasil fail-closed saat backend terpusat tidak tersedia di produksi. */
export function unavailableRateLimitResult(windowMs: number): RateLimitResult {
  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
    backend: "redis"
  };
}

async function checkRedisRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult | null> {
  const client = getRedis();
  if (!client) return null;
  try {
    if (client.status === "wait") await client.connect();
    const redisKey = `rl:${key}`;
    const count = await client.incr(redisKey);
    if (count === 1) await client.pexpire(redisKey, windowMs);
    const pttl = await client.pttl(redisKey);
    const retryAfterSeconds =
      pttl > 0 ? Math.max(1, Math.ceil(pttl / 1000)) : Math.max(1, Math.ceil(windowMs / 1000));
    if (count > limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds, backend: "redis" };
    }
    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: 0,
      backend: "redis"
    };
  } catch (error) {
    redisUnavailableUntil = Date.now() + 30_000;
    logger.error("rate_limit.redis_error", {
      reason: (error as Error).message,
      production: isProductionRuntime()
    });
    try {
      client.disconnect();
    } catch {}
    redis = null;
    return null;
  }
}

function checkMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): RateLimitResult {
  if (isProductionRuntime() && !warnedMemoryInProd) {
    warnedMemoryInProd = true;
    logger.warn("rate_limit.memory_fallback_prod", {
      detail: "Rate limit memakai memori lokal di produksi; tidak aman untuk multi-instance"
    });
  }
  pruneRateLimits(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0, backend: "memory" };
  }
  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      backend: "memory"
    };
  }
  bucket.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: 0,
    backend: "memory"
  };
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): Promise<RateLimitResult> {
  if (isProductionRuntime()) {
    if (process.env.RATE_LIMIT_MODE !== "redis" || !getRedisUrl()) {
      logger.error("rate_limit.production_backend_missing", {
        detail: "RATE_LIMIT_MODE=redis dan REDIS_URL wajib di produksi"
      });
      return unavailableRateLimitResult(windowMs);
    }
    const redisResult = await checkRedisRateLimit(key, limit, windowMs);
    // Redis error tidak pernah jatuh ke memory fallback di produksi.
    return redisResult ?? unavailableRateLimitResult(windowMs);
  }

  const redisResult = await checkRedisRateLimit(key, limit, windowMs);
  if (redisResult) return redisResult;
  return checkMemoryRateLimit(key, limit, windowMs, now);
}

/** Bersihkan bucket lama agar Map tidak tumbuh tanpa batas. */
export function pruneRateLimits(now = Date.now()): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimitResponse(result: RateLimitResult): Response {
  return Response.json(
    {
      error: "Terlalu banyak permintaan. Coba lagi nanti.",
      retryAfterSeconds: result.retryAfterSeconds
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "Cache-Control": "no-store"
      }
    }
  );
}

export async function closeRateLimitRedis(): Promise<void> {
  if (redis) {
    try {
      await redis.quit();
    } catch {
      redis.disconnect();
    }
    redis = null;
  }
}
