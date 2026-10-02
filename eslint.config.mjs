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
    // Bundle minificado de tercero versionado dentro de la skill `impeccable`:
    // no es código propio y no se edita a mano. El resto de .agents/ sigue
    // sujeto a lint.
    ".agents/skills/impeccable/scripts/modern-screenshot.umd.js",
  ]),
]);

export default eslintConfig;
