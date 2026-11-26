/**
 * AGENT 3 - BUG HUNTER
 * Scan source: API tanpa auth, password hardcode, query lambat, kunci bocor,
 * console.log yang membocorkan NIK. Klasifikasi P0-P3.
 * Untuk P0/P1 agent ini MENULIS file perbaikan nyata di /fixes/ beserta tes.
 */

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { writeAgentLog } from "@/lib/agentLog";

export type Severity = "P0" | "P1" | "P2" | "P3";

export interface Finding {
  severity: Severity;
  category: string;
  file: string;
  line: number;
  excerpt: string;
  recommendation: string;
}

const SCAN_DIRS = ["app", "agents", "lib", "components"];
const SCAN_EXTENSIONS = [".ts", ".tsx"];

interface Rule {
  severity: Severity;
  category: string;
  pattern: RegExp;
  recommendation: string;
}

const RULES: Rule[] = [
  {
    severity: "P0",
    category: "Kredensial hardcode",
    pattern: /(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"']{6,}["']/i,
    recommendation: "Pindahkan nilai ke .env dan validasi lewat fixes/env-loader.ts."
  },
  {
    severity: "P0",
    category: "Kunci penyedia bocor",
    pattern: /(gho_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{20,})/,
    recommendation: "Cabut kunci segera, rotasi, dan simpan hanya di environment variable."
  },
  {
    severity: "P0",
    category: "Endpoint tanpa auth",
    pattern: /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)/,
    recommendation: "Bungkus handler dengan fixes/api-auth-guard.ts."
  },
  {
    severity: "P1",
    category: "console.log berpotensi bocor NIK",
    pattern: /console\.log\([^\n]*(nik|phone|diagnosa|patient)/i,
    recommendation: "Ganti dengan fixes/safe-logger.ts yang melakukan masking."
  },
  {
    severity: "P1",
    category: "Query dinamis berpotensi lambat/injeksi",
    pattern: /\$queryRawUnsafe|\$executeRawUnsafe|query\s*\(\s*`[^`]*\$\{/,
    recommendation: "Gunakan query Prisma parametrik dan indeks yang sesuai."
  },
  {
    severity: "P2",
    category: "Tipe any",
    pattern: /:\s*any\b|as\s+any\b/,
    recommendation: "Ganti dengan tipe konkret atau unknown + validasi Zod."
  },
  {
    severity: "P3",
    category: "TODO/placeholder",
    pattern: /\/\/\s*TODO|FIXME/,
    recommendation: "Lengkapi implementasi atau hapus penanda."
  }
];

async function collectFiles(dir: string, root: string, output: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".next") {
        await collectFiles(full, root, output);
      }
    } else if (SCAN_EXTENSIONS.includes(path.extname(entry.name))) {
      output.push(path.relative(root, full).replaceAll("\\", "/"));
    }
  }
}

export async function scanCodebase(root: string = process.cwd()): Promise<Finding[]> {
  const files: string[] = [];
  for (const dir of SCAN_DIRS) {
    await collectFiles(path.join(/* turbopackIgnore: true */ root, dir), root, files);
  }

  const findings: Finding[] = [];
  for (const file of files) {
    const content = await readFile(path.join(/* turbopackIgnore: true */ root, file), "utf8");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const rule of RULES) {
        if (!rule.pattern.test(line)) continue;
        if (
          rule.category === "Endpoint tanpa auth" &&
          !line.includes("getServerSession") &&
          !content.includes("getServerSession")
        ) {
          findings.push({
            severity: rule.severity,
            category: rule.category,
            file,
            line: index + 1,
            excerpt: line.trim().slice(0, 160),
            recommendation: rule.recommendation
          });
        } else if (rule.category !== "Endpoint tanpa auth") {
          findings.push({
            severity: rule.severity,
            category: rule.category,
            file,
            line: index + 1,
            excerpt: line.trim().slice(0, 160),
            recommendation: rule.recommendation
          });
        }
      }
    }
  }
  return findings;
}

const SAFE_LOGGER = `/**
 * Logger aman: masking NIK, nomor HP, dan kunci sebelum ditulis.
 * Dihasilkan oleh Bug Hunter untuk mengganti console.log mentah.
 */
const SENSITIVE = /(35\\d{14}|08\\d{8,}|gho_[A-Za-z0-9]+|sk-[A-Za-z0-9]+)/g;

export function safeLog(level: "info" | "warn" | "error", message: string, meta?: unknown): void {
  const redact = (value: string): string => value.replace(SENSITIVE, "[REDACTED]");
  const serialized = meta === undefined ? "" : JSON.stringify(meta).replace(SENSITIVE, "[REDACTED]");
  const line = \`[\${level.toUpperCase()}] \${redact(message)} \${serialized}\`.trim();
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
`;

const API_AUTH_GUARD = `/**
 * Guard handler API. Mengembalikan true bila role diizinkan.
 * Dihasilkan oleh Bug Hunter untuk endpoint yang sebelumnya tanpa auth.
 */
import { PERMISSIONS, type Role } from "../lib/rbac";

export function isRoleAllowed(role: Role, permission: string): boolean {
  return PERMISSIONS[role].includes(permission);
}

export function requirePermission(role: unknown, permission: string): void {
  const normalized = (role ?? "RESEPSIONIS") as Role;
  if (!isRoleAllowed(normalized, permission)) {
    throw new Error(\`Akses ditolak: \${permission} tidak tersedia untuk \${normalized}.\`);
  }
}
`;

const ENV_LOADER = `/**
 * Validasi environment variable. Gunakan sebelum memakai kredensial.
 * Dihasilkan oleh Bug Hunter untuk mencegah kunci hardcode.
 */
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NEXTAUTH_SECRET: z.string().min(16),
  FIELD_ENCRYPTION_KEY: z.string().min(16),
  ALLOW_REAL_OUTBOUND: z.enum(["true", "false"]).default("false")
});

export type ValidEnv = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined>): ValidEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(\`Environment tidak valid: \${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}\`);
  }
  return parsed.data;
}
`;

const FIXES_TEST = `import { describe, expect, it } from "vitest";
import { safeLog } from "./safe-logger";
import { isRoleAllowed, requirePermission } from "./api-auth-guard";
import { loadEnv } from "./env-loader";

describe("Fix files dari Bug Hunter", () => {
  it("safeLog tidak membocorkan NIK", () => {
    const spy = console.info;
    let captured = "";
    console.info = (value: string) => { captured = value; };
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
    expect(() => loadEnv({
      DATABASE_URL: "file:./dev.db",
      NEXTAUTH_SECRET: "short",
      FIELD_ENCRYPTION_KEY: "short"
    })).toThrow();
  });
});
`;

export async function writeFixFiles(findings: Finding[], root = process.cwd()): Promise<string[]> {
  const dir = path.join(root, "fixes");
  await mkdir(dir, { recursive: true });
  const critical = findings.filter((item) => item.severity === "P0" || item.severity === "P1");
  const files: Array<[string, string]> = [
    ["safe-logger.ts", SAFE_LOGGER],
    ["api-auth-guard.ts", API_AUTH_GUARD],
    ["env-loader.ts", ENV_LOADER],
    ["fixes.test.ts", FIXES_TEST]
  ];

  for (const [name, content] of files) {
    await writeFile(path.join(dir, name), content, "utf8");
  }
  await writeFile(
    path.join(dir, "findings.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), criticalCount: critical.length, findings }, null, 2),
    "utf8"
  );

  return files.map(([name]) => `fixes/${name}`).concat("fixes/findings.json");
}

export async function runBugHunter(): Promise<{
  findings: Finding[];
  critical: number;
  fixFiles: string[];
}> {
  const startedAt = Date.now();
  const findings = await scanCodebase();
  const critical = findings.filter((item) => item.severity === "P0" || item.severity === "P1").length;
  const fixFiles = critical > 0 ? await writeFixFiles(findings) : [];

  await writeAgentLog({
    agentName: "BUG_HUNTER",
    status: "SUCCESS",
    message: `Scan selesai: ${findings.length} temuan (${critical} kritis), ${fixFiles.length} file perbaikan`,
    payload: JSON.stringify(findings.slice(0, 20)),
    durationMs: Date.now() - startedAt
  });

  return { findings, critical, fixFiles };
}
