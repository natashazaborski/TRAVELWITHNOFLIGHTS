// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ModeIcon } from "@/components/icons/ModeIcon";
import { RouteLine } from "@/components/route/RouteLine";
import type { LegMode } from "@/lib/routing/types";
import { palette } from "@/lib/theme/palette";

afterEach(cleanup);

const MODES: LegMode[] = ["bus", "train", "ferry", "local", "walk"];

describe("RouteLine", () => {
  it("draws one segment per leg, sized by weight", () => {
    const { container } = render(
      <RouteLine
        segments={[
          { mode: "walk", weight: 5 },
          { mode: "bus", weight: 60 },
          { mode: "train", weight: 120 },
        ]}
      />,
    );
    const line = container.querySelector('[data-route-line="horizontal"]')!;
    expect(line.getAttribute("aria-hidden")).toBe("true");
    const segs = [...line.children] as HTMLElement[];
    expect(segs.map((s) => s.dataset.mode)).toEqual(["walk", "bus", "train"]);
    expect(segs.map((s) => s.style.flexGrow)).toEqual(["5", "60", "120"]);
  });

  it("draws each mode with its own signature", () => {
    const { container } = render(
      <RouteLine segments={MODES.map((mode) => ({ mode, weight: 1 }))} />,
    );
    const seg = (m: LegMode) => container.querySelector(`[data-mode="${m}"]`)!;
    // Bus: road surface plus a dashed lane-yellow centre line.
    expect(seg("bus").querySelector("rect")?.getAttribute("fill")).toBe(
      palette.road,
    );
    const centre = seg("bus").querySelector("line")!;
    expect(centre.getAttribute("stroke")).toBe(palette.lane);
    expect(centre.getAttribute("stroke-dasharray")).toBe("8 6");
    // Train: evenly spaced ticks under a solid rail.
    const [ticks, rail] = [...seg("train").querySelectorAll("line")];
    expect(ticks!.getAttribute("stroke-dasharray")).toBe("2 5");
    expect(rail!.getAttribute("stroke-dasharray")).toBeNull();
    // Ferry: a blue wave pattern.
    const wave = seg("ferry").querySelector("pattern path")!;
    expect(wave.getAttribute("stroke")).toBe(palette.waterLight);
    expect(wave.getAttribute("d")).toMatch(/q.*t/);
    // Local: one thinner solid line; walk: round dots.
    expect(seg("local").querySelectorAll("line")).toHaveLength(1);
    const dots = seg("walk").querySelector("line")!;
    expect(dots.getAttribute("stroke-linecap")).toBe("round");
    expect(dots.getAttribute("stroke-dasharray")).toMatch(/^0 /);
  });

  it("runs vertically for the timeline", () => {
    const { container } = render(
      <RouteLine
        segments={[{ mode: "train", weight: 1 }]}
        orientation="vertical"
      />,
    );
    const line = container.querySelector('[data-route-line="vertical"]')!;
    expect((line as HTMLElement).style.width).toBe("14px");
    const rail = line.querySelectorAll("line")[1]!;
    expect(rail.getAttribute("y2")).toBe("100%");
  });

  it("only animates when asked, via a class gated on reduced motion", () => {
    const { container, rerender } = render(
      <RouteLine segments={[{ mode: "bus", weight: 1 }]} />,
    );
    expect(container.querySelector(".route-animate")).toBeNull();
    rerender(<RouteLine segments={[{ mode: "bus", weight: 1 }]} animated />);
    expect(
      container.querySelector(".route-animate .route-dash"),
    ).not.toBeNull();
  });

  it("gives every ferry segment its own pattern id", () => {
    const { container } = render(
      <RouteLine
        segments={[
          { mode: "ferry", weight: 1 },
          { mode: "ferry", weight: 1 },
        ]}
      />,
    );
    const ids = [...container.querySelectorAll("pattern")].map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("ModeIcon", () => {
  it.each(MODES)("%s is a decorative, currentColor line icon", (mode) => {
    const { container } = render(<ModeIcon mode={mode} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.dataset.icon).toBe(mode);
    expect(svg.children.length).toBeGreaterThan(0);
  });
});
