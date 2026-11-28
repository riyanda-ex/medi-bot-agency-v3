import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const unusedVarsOptions = { argsIgnorePattern: "^_", varsIgnorePattern: "^_" };

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", unusedVarsOptions]
    }
  },
  {
    files: ["app/**/*.{js,jsx,ts,tsx}", "lib/**/*.{js,jsx,ts,tsx}", "agents/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", unusedVarsOptions]
    }
  },
  {
    files: ["scripts/**/*.{js,mjs,ts}", "tests/**/*.{js,ts}", "fixes/**/*.{js,ts}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", unusedVarsOptions]
    }
  },
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "node_modules/**",
    "next-env.d.ts"
  ])
]);

export default eslintConfig;
