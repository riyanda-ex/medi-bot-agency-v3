/**
 * AGENT 3 - BUG HUNTER
 * Scan source: API tanpa auth, kredensial hardcode, query dinamis, tipe any,
 * TODO/placeholder. Klasifikasi P0-P3.
 * Artefak scan bersifat read-only; kode produksi tidak ditimpa otomatis.
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
// File ini memuat literal regex; memindainya menghasilkan false positive.
const EXCLUDED_FILES = new Set(["agents/bugHunter.ts"]);

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
    recommendation: "Pindahkan nilai ke environment variable dan validasi saat runtime."
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
    recommendation: "Pastikan handler memanggil getServerSession atau berada di proxy."
  },
  {
    severity: "P1",
    category: "console.log berpotensi bocor data",
    pattern: /console\.log\([^\n]*(nik|phone|diagnosa|patient)/i,
    recommendation: "Ganti dengan logging ringkasan tanpa nilai sensitif."
  },
  {
    severity: "P1",
    category: "Query dinamis",
    pattern: /\$queryRawUnsafe|\$executeRawUnsafe/,
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
    if (EXCLUDED_FILES.has(file)) continue;
    const content = await readFile(path.join(/* turbopackIgnore: true */ root, file), "utf8");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const rule of RULES) {
        if (!rule.pattern.test(line)) continue;
        if (rule.category === "Endpoint tanpa auth" && content.includes("getServerSession"))
          continue;
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
  return findings;
}

/** Artefak read-only: tidak pernah menimpa file sumber di /fixes. */
export async function writeFindingsArtifact(
  findings: Finding[],
  root = process.cwd()
): Promise<string[]> {
  const dir = path.join(root, "fixes");
  await mkdir(dir, { recursive: true });
  const counts = {
    P0: findings.filter((item) => item.severity === "P0").length,
    P1: findings.filter((item) => item.severity === "P1").length,
    P2: findings.filter((item) => item.severity === "P2").length,
    P3: findings.filter((item) => item.severity === "P3").length
  };
  await writeFile(
    path.join(dir, "findings.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        counts,
        criticalCount: counts.P0 + counts.P1,
        note: "Artefak read-only. Tidak menimpa file sumber; perubahan perlu review.",
        findings
      },
      null,
      2
    ),
    "utf8"
  );
  return ["fixes/findings.json"];
}

export async function runBugHunter(): Promise<{
  findings: Finding[];
  critical: number;
  fixFiles: string[];
}> {
  const startedAt = Date.now();
  const findings = await scanCodebase();
  const critical = findings.filter(
    (item) => item.severity === "P0" || item.severity === "P1"
  ).length;
  const artifact = await writeFindingsArtifact(findings);

  await writeAgentLog({
    agentName: "BUG_HUNTER",
    status: "SUCCESS",
    message: `Scan selesai: ${findings.length} temuan (${critical} kritis), artefak ${artifact.length}`,
    payload: JSON.stringify({
      counts: {
        P0: findings.filter((item) => item.severity === "P0").length,
        P1: findings.filter((item) => item.severity === "P1").length
      }
    }),
    durationMs: Date.now() - startedAt
  });

  return { findings, critical, fixFiles: artifact };
}
