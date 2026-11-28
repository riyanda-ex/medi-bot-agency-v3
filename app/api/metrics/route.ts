import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getQueueMetrics } from "@/lib/queue";

/** Endpoint Prometheus tanpa PHI. Token terpisah dari sesi aplikasi. */
export async function GET(request: Request): Promise<NextResponse> {
  const configured = process.env.METRICS_TOKEN ?? "";
  const provided = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  const configuredHash = createHash("sha256").update(configured).digest();
  const providedHash = createHash("sha256")
    .update(provided ?? "")
    .digest();
  if (
    !configured ||
    !provided ||
    configuredHash.length !== providedHash.length ||
    !timingSafeEqual(configuredHash, providedHash)
  ) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const started = process.uptime();
  const memory = process.memoryUsage();
  const lines = [
    "# HELP medibot_up Service is running.",
    "# TYPE medibot_up gauge",
    "medibot_up 1",
    "# HELP medibot_process_uptime_seconds Process uptime in seconds.",
    "# TYPE medibot_process_uptime_seconds gauge",
    `medibot_process_uptime_seconds ${started.toFixed(3)}`,
    "# HELP medibot_process_resident_memory_bytes Resident memory.",
    "# TYPE medibot_process_resident_memory_bytes gauge",
    `medibot_process_resident_memory_bytes ${memory.rss}`,
    "# HELP medibot_queue_metric Queue counters since process start.",
    "# TYPE medibot_queue_metric counter"
  ];

  for (const [name, value] of Object.entries(getQueueMetrics())) {
    const safe = name.replace(/[^a-zA-Z0-9_]/g, "_");
    lines.push(`medibot_queue_metric{name="${safe}"} ${value}`);
  }

  return new NextResponse(`${lines.join("\n")}\n`, {
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
