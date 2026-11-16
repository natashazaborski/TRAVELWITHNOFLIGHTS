import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(tsx?|css)$/.test(name) ? [p] : [];
  });
}

const ui = [
  ...files(path.join(root, "app")),
  ...files(path.join(root, "components")),
];

describe("visual identity constraints", () => {
  it("uses no gradients", () => {
    for (const f of ui) {
      expect(readFileSync(f, "utf8"), path.relative(root, f)).not.toMatch(
        /gradient/i,
      );
    }
  });

  it("has no plane imagery", () => {
    for (const f of ui) {
      const text = readFileSync(f, "utf8");
      expect(text, path.relative(root, f)).not.toMatch(
        /✈|🛩|🛫|🛬|airplane|aeroplane|aircraft/i,
      );
    }
  });

  it("does not use the old placeholder colours", () => {
    for (const f of ui) {
      expect(readFileSync(f, "utf8"), path.relative(root, f)).not.toMatch(
        /\b(?:bg|text|border|ring)-(?:gray|blue|red|amber|emerald|sky|purple)-\d{2,3}\b|bg-white/,
      );
    }
  });
});
