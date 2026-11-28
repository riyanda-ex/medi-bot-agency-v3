import fs from "node:fs";
import path from "node:path";

const specPath = "openapi.yaml";
if (!fs.existsSync(specPath)) {
  console.error("openapi.yaml missing");
  process.exit(1);
}
const spec = fs.readFileSync(specPath, "utf8");

function collectRoutes(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectRoutes(full));
    } else if (entry.name === "route.ts" || entry.name === "route.tsx") {
      found.push(full);
    }
  }
  return found;
}

function toOpenApiPath(routeFile) {
  const segments = routeFile.split(path.sep).slice(0, -1);
  const apiIndex = segments.indexOf("api");
  const apiSegments = apiIndex >= 0 ? segments.slice(apiIndex) : segments;
  return `/${apiSegments
    .map((segment) => (/^\[(.+)\]$/.test(segment) ? `{${segment.slice(1, -1)}}` : segment))
    .join("/")}`;
}

const documented = new Set(
  collectRoutes("app/api")
    .map(toOpenApiPath)
    .filter((p) => p.startsWith("/api/"))
);

const required = [
  "/api/health:",
  "/api/ready:",
  "/api/chatbot:",
  "/api/triage:",
  "/api/reports/generate:",
  "/api/orchestrator/run:"
];

const missingRequired = required.filter((p) => !spec.includes(p));
const missingRoutes = [...documented].filter((p) => !spec.includes(`${p}:`));
const missing = [...new Set([...missingRequired, ...missingRoutes])];

if (missing.length) {
  console.error("OpenAPI missing paths:", missing.sort().join(", "));
  process.exit(1);
}
console.log(`OpenAPI check passed (${documented.size} route paths documented).`);
