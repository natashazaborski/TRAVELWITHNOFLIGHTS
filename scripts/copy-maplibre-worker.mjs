// Copies MapLibre's web worker into public/ so it is served at a stable URL.
// MapLibre 6 looks for its worker next to its own module by default, which
// does not exist once Next.js bundles the module. See components/results/RouteMap.tsx.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkg = path.dirname(require.resolve("maplibre-gl/package.json"));
const root = path.resolve(import.meta.dirname, "..");
mkdirSync(path.join(root, "public"), { recursive: true });
copyFileSync(
  path.join(pkg, "dist", "maplibre-gl-worker.mjs"),
  path.join(root, "public", "maplibre-gl-worker.mjs"),
);
