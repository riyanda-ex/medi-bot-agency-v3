import fs from "node:fs";

const spec = fs.readFileSync("openapi.yaml", "utf8");
const required = [
  "/api/health:",
  "/api/ready:",
  "/api/chatbot:",
  "/api/triage:",
  "/api/reports/generate:",
  "/api/orchestrator/run:"
];
const missing = required.filter((p) => !spec.includes(p));
if (!fs.existsSync("openapi.yaml")) {
  console.error("openapi.yaml missing");
  process.exit(1);
}
if (missing.length) {
  console.error("OpenAPI missing paths:", missing.join(", "));
  process.exit(1);
}
console.log("OpenAPI check passed.");
