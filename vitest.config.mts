import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "fixes/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["lib/**/*.ts", "agents/**/*.ts"],
      exclude: ["**/*.d.ts", "**/*.test.ts"],
      thresholds: {
        lines: 35,
        functions: 40,
        statements: 35,
        branches: 30
      }
    }
  }
});
