import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_JOB_BACKOFF_MS,
  DEFAULT_MAX_JOB_ATTEMPTS,
  QUEUE_NAME,
  buildJobOptions,
  deadLetterReplayJobId,
  getQueueMetrics,
  isDeadLetterJobDue,
  jobRetryPolicy,
  recordQueueMetric,
  resetQueueMetricsForTests,
  schedulerOwner,
  shouldOwnScheduler,
  signJobPayload,
  urgentFollowupJobSchema,
  validateDeadLetterEntry,
  verifyJobPayload,
  type DeadLetterEntry
} from "../lib/queue";

const envKeys = [
  "LOG_LEVEL",
  "SYNC_MODE",
  "QUEUE_MODE",
  "REDIS_URL",
  "ENABLE_SCHEDULER",
  "SCHEDULER_OWNER",
  "QUEUE_MAX_ATTEMPTS",
  "QUEUE_BACKOFF_DELAY_MS"
] as const;

const originalEnv = new Map<string, string | undefined>(
  envKeys.map((key) => [key, process.env[key]])
);

beforeEach(() => {
  for (const key of envKeys) delete process.env[key];
  process.env.LOG_LEVEL = "error";
  process.env.SYNC_MODE = "true";
  resetQueueMetricsForTests();
});

afterEach(() => {
  resetQueueMetricsForTests();
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("queue: retry terbatas dan dead-letter", () => {
  it("memakai batas retry/backoff bawaan bila env tidak diisi", () => {
    expect(jobRetryPolicy()).toEqual({
      attempts: DEFAULT_MAX_JOB_ATTEMPTS,
      backoffMs: DEFAULT_JOB_BACKOFF_MS
    });
    const options = buildJobOptions({ delayMs: 2500, jobId: "job-1" });
    expect(options.attempts).toBe(DEFAULT_MAX_JOB_ATTEMPTS);
    expect(options.backoff).toEqual({ type: "exponential", delay: DEFAULT_JOB_BACKOFF_MS });
    expect(options.delay).toBe(2500);
    expect(options.jobId).toBe("job-1");
  });

  it("membatasi nilai retry/backoff dari env agar tidak tak terhingga", () => {
    process.env.QUEUE_MAX_ATTEMPTS = "99";
    process.env.QUEUE_BACKOFF_DELAY_MS = "0";
    expect(jobRetryPolicy()).toEqual({ attempts: 10, backoffMs: 1 });

    process.env.QUEUE_MAX_ATTEMPTS = "bukan-angka";
    expect(jobRetryPolicy().attempts).toBe(DEFAULT_MAX_JOB_ATTEMPTS);
  });

  it("hanya job yang retry-nya habis yang masuk DLQ", () => {
    expect(isDeadLetterJobDue({ attemptsMade: 1, opts: { attempts: 3 } })).toBe(false);
    expect(isDeadLetterJobDue({ attemptsMade: 3, opts: { attempts: 3 } })).toBe(true);
    process.env.QUEUE_MAX_ATTEMPTS = "2";
    expect(isDeadLetterJobDue({ attemptsMade: 2 })).toBe(true);
    expect(isDeadLetterJobDue({ attemptsMade: 1 })).toBe(false);
  });

  it("counter metrik bertambah dan bisa direset", () => {
    expect(getQueueMetrics()["queue.test.metric"]).toBeUndefined();
    recordQueueMetric("test.metric", { source: "unit" });
    recordQueueMetric("queue.test.metric");
    expect(getQueueMetrics()["queue.test.metric"]).toBe(2);
  });
});

describe("queue: satu pemilik cron", () => {
  it("auto memilih web saat sync dan worker saat redis aktif", () => {
    process.env.ENABLE_SCHEDULER = "true";
    process.env.SCHEDULER_OWNER = "auto";
    expect(schedulerOwner()).toBe("auto");

    process.env.QUEUE_MODE = "sync";
    expect(shouldOwnScheduler("web")).toBe(true);
    expect(shouldOwnScheduler("worker")).toBe(false);

    process.env.QUEUE_MODE = "redis";
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    expect(shouldOwnScheduler("web")).toBe(false);
    expect(shouldOwnScheduler("worker")).toBe(true);
  });

  it("override eksplisit tidak pernah mengaktifkan kedua jalur sekaligus", () => {
    process.env.ENABLE_SCHEDULER = "true";
    process.env.SCHEDULER_OWNER = "worker";
    expect(shouldOwnScheduler("web")).toBe(false);
    expect(shouldOwnScheduler("worker")).toBe(true);

    process.env.SCHEDULER_OWNER = "web";
    expect(shouldOwnScheduler("web")).toBe(true);
    expect(shouldOwnScheduler("worker")).toBe(false);
  });

  it("none, nilai invalid, dan ENABLE_SCHEDULER=false bersifat fail-closed", () => {
    process.env.ENABLE_SCHEDULER = "true";
    process.env.SCHEDULER_OWNER = "none";
    expect(shouldOwnScheduler("web")).toBe(false);
    expect(shouldOwnScheduler("worker")).toBe(false);

    process.env.SCHEDULER_OWNER = "dua-duanya";
    expect(schedulerOwner()).toBe("none");

    process.env.SCHEDULER_OWNER = "auto";
    process.env.ENABLE_SCHEDULER = "false";
    expect(shouldOwnScheduler("web")).toBe(false);
    expect(shouldOwnScheduler("worker")).toBe(false);
  });
});

describe("queue: payload job", () => {
  it("tanda tangan HMAC menolak payload yang diubah", () => {
    const envelope = signJobPayload({ patientId: "p1", dedupeKey: "k1" });
    expect(verifyJobPayload(envelope)).toEqual({ patientId: "p1", dedupeKey: "k1" });
    expect(() =>
      verifyJobPayload({
        data: { patientId: "p1", dedupeKey: "k2" },
        signature: envelope.signature
      })
    ).toThrow();
  });

  it("schema urgent.followup menerima kunci dedupe", () => {
    const parsed = urgentFollowupJobSchema.parse({
      patientId: "p1",
      triageLogId: "new-triage-id",
      stageOffset: 120,
      dedupeKey: "a".repeat(32)
    });
    expect(parsed.dedupeKey).toBe("a".repeat(32));
    expect(() =>
      urgentFollowupJobSchema.parse({ patientId: "p1", dedupeKey: "x".repeat(65) })
    ).toThrow();
  });

  it("ID replay DLQ deterministik agar konkuren tidak mengirim dua kali", () => {
    expect(deadLetterReplayJobId("dlq-1")).toBe("dlq-replay:dlq-1");
    expect(deadLetterReplayJobId("dlq-1")).toBe(deadLetterReplayJobId("dlq-1"));
  });

  it("replay DLQ menolak payload tanpa tanda tangan yang valid", () => {
    const envelope = signJobPayload({ patientId: "p1", triageLogId: "triage-1" });
    const entry: DeadLetterEntry = {
      sourceQueue: QUEUE_NAME,
      jobId: "source-1",
      jobName: "urgent.followup",
      data: envelope,
      attemptsMade: 3,
      error: "gagal",
      failedAt: "2026-11-28T00:00:00.000Z"
    };

    expect(() => validateDeadLetterEntry(entry)).not.toThrow();
    expect(() =>
      validateDeadLetterEntry({
        ...entry,
        data: { data: { patientId: "p2", triageLogId: "triage-1" }, signature: envelope.signature }
      })
    ).toThrow(/Tanda tangan job tidak valid/);
    expect(() => validateDeadLetterEntry({ ...entry, sourceQueue: "other" })).toThrow(
      /antrean lain/
    );
    expect(() => validateDeadLetterEntry({ ...entry, jobName: "unknown.job" })).toThrow(
      /tidak dikenal/
    );
    expect(() =>
      validateDeadLetterEntry({ ...entry, replayedAt: "2026-11-28T01:00:00.000Z" })
    ).toThrow(/sudah direplay/);
  });
});
