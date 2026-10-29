import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/onnx/ort*.mjs",
    ".tmp/**",
    "scripts/.tmp/**",
    "tests/**",
    "scripts/check-*.cjs",
    "scripts/audit-*",
    "scripts/tutorial-test-support.cjs",
    "vitest.config.mts",
  ]),
]);

export default eslintConfig;
