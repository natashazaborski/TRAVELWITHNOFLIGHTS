import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Must come last: turns off stylistic rules that conflict with Prettier.
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    // Cloudflare (OpenNext / Wrangler) build output
    ".open-next/**",
    ".wrangler/**",
    // Copied from node_modules (scripts/copy-maplibre-worker.mjs)
    "public/maplibre-gl-worker.mjs",
  ]),
]);

export default eslintConfig;
