import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, palette, usedPairs } from "@/lib/theme/palette";

const css = readFileSync(
  path.resolve(__dirname, "../../app/globals.css"),
  "utf8",
);

/** "inkMuted" -> "ink-muted" */
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe("palette", () => {
  it("matches the Tailwind theme tokens in globals.css", () => {
    for (const [name, hex] of Object.entries(palette)) {
      const m = new RegExp(`--color-${kebab(name)}:\\s*(#[0-9a-fA-F]{6})`).exec(
        css,
      );
      expect(m?.[1]?.toLowerCase(), `--color-${kebab(name)}`).toBe(
        hex.toLowerCase(),
      );
    }
  });

  it("computes WCAG contrast correctly", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it.each(usedPairs.map((p) => [p.fg, p.bg, p.min, p.where] as const))(
    "%s on %s meets %s:1 (%s)",
    (fg, bg, min) => {
      expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(
        min,
      );
    },
  );
});
