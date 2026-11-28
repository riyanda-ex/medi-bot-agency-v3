/**
 * Smoke load test tanpa dependency: target URL, concurrency tertentu, latensi p95/p99.
 * Contoh: TARGET_URL=http://localhost:3000 npm run perf:check
 */
const target = (process.env.TARGET_URL ?? "http://localhost:3000").replace(/\/$/, "");
const durationMs = Number(process.env.DURATION_SECONDS ?? 15) * 1000;
const concurrency = Number(process.env.CONCURRENCY ?? 5);
const sloP95Ms = Number(process.env.SLO_P95_MS ?? 1000);
const maxErrorRate = Number(process.env.MAX_ERROR_RATE ?? 0.01);
const path = process.env.LOAD_PATH ?? "/api/health";

if (
  !Number.isFinite(durationMs) ||
  durationMs <= 0 ||
  !Number.isFinite(concurrency) ||
  concurrency <= 0
) {
  console.error("DURATION_SECONDS dan CONCURRENCY harus angka positif.");
  process.exit(2);
}

const latencies = [];
let failures = 0;
let total = 0;
const deadline = Date.now() + durationMs;

async function worker() {
  while (Date.now() < deadline) {
    const started = performance.now();
    total += 1;
    try {
      const response = await fetch(`${target}${path}`, {
        signal: AbortSignal.timeout(5000),
        headers: { "x-request-id": `load-${Date.now()}-${Math.random().toString(36).slice(2)}` }
      });
      await response.arrayBuffer();
      if (!response.ok) failures += 1;
    } catch {
      failures += 1;
    }
    latencies.push(performance.now() - started);
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
latencies.sort((a, b) => a - b);
const percentile = (p) =>
  latencies[Math.min(latencies.length - 1, Math.ceil((p / 100) * latencies.length) - 1)] ?? 0;
const errorRate = total > 0 ? failures / total : 1;
const result = {
  target,
  path,
  total,
  failures,
  errorRate: Number(errorRate.toFixed(4)),
  p50Ms: Math.round(percentile(50)),
  p95Ms: Math.round(percentile(95)),
  p99Ms: Math.round(percentile(99)),
  sloP95Ms,
  maxErrorRate
};
console.log(JSON.stringify(result, null, 2));
if (latencies.length === 0 || result.p95Ms > sloP95Ms || errorRate > maxErrorRate) {
  console.error("Load check gagal: p95/error rate melewati SLO.");
  process.exit(1);
}
