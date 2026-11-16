import { useId } from "react";
import type { LegMode } from "@/lib/routing/types";
import { palette } from "@/lib/theme/palette";

/**
 * The signature element: a trip drawn as the ways it travels.
 *
 *   bus    a road with a dashed yellow centre line
 *   train  a rail with evenly spaced ticks (sleepers)
 *   ferry  a blue wave
 *   local  a thinner solid line
 *   walk   dots
 *
 * One component for cards (horizontal, sized by leg duration), the
 * timeline (vertical, one leg), and the decorative band on the home page.
 *
 * Each leg is its own SVG measured in CSS pixels (no viewBox), so dashes,
 * ticks, dots, and waves keep their shape at any width instead of stretching.
 * Lengths along the line use percentages; across it, pixels.
 */
export interface RouteLineSegment {
  mode: LegMode;
  /** Relative length, e.g. the leg's duration in minutes. */
  weight: number;
}

export interface RouteLineProps {
  segments: RouteLineSegment[];
  orientation?: "horizontal" | "vertical";
  /** Thickness across the line, in px. */
  thickness?: number;
  /** Gap between segments, in px. */
  gap?: number;
  /** Marching lane dashes (decorative band only; off with reduced motion). */
  animated?: boolean;
  className?: string;
}

export function RouteLine({
  segments,
  orientation = "horizontal",
  thickness = 14,
  gap = 3,
  animated = false,
  className = "",
}: RouteLineProps) {
  const horizontal = orientation === "horizontal";
  return (
    <div
      aria-hidden="true"
      data-route-line={orientation}
      className={`flex ${horizontal ? "w-full flex-row" : "h-full flex-col"} ${animated ? "route-animate" : ""} ${className}`}
      style={{
        gap,
        [horizontal ? "height" : "width"]: thickness,
      }}
    >
      {segments.map((s, i) => (
        <div
          key={i}
          data-mode={s.mode}
          className={horizontal ? "min-w-2" : "min-h-2"}
          style={{ flexGrow: Math.max(s.weight, 0.0001), flexBasis: 0 }}
        >
          <LegGlyph
            mode={s.mode}
            thickness={thickness}
            horizontal={horizontal}
          />
        </div>
      ))}
    </div>
  );
}

/** Draws one leg filling its box. */
function LegGlyph({
  mode,
  thickness: t,
  horizontal,
}: {
  mode: LegMode;
  thickness: number;
  horizontal: boolean;
}) {
  const patternId = useId();
  const c = t / 2;
  // A line along the full length at `across` px from the edge.
  const along = (across: number) =>
    horizontal
      ? { x1: "0", y1: across, x2: "100%", y2: across }
      : { x1: across, y1: "0", x2: across, y2: "100%" };

  let body: React.ReactNode;
  switch (mode) {
    case "bus":
      body = (
        <>
          <rect
            width="100%"
            height="100%"
            rx={Math.min(3, t / 4)}
            fill={palette.road}
          />
          <line
            {...along(c)}
            className="route-dash"
            stroke={palette.lane}
            strokeWidth={Math.max(1.5, t / 7)}
            strokeDasharray="8 6"
          />
        </>
      );
      break;
    case "train":
      body = (
        <>
          {/* Sleepers: short ticks across the track, evenly spaced. */}
          <line
            {...along(c)}
            stroke={palette.inkMuted}
            strokeWidth={t * 0.85}
            strokeDasharray="2 5"
          />
          {/* The rail itself. */}
          <line
            {...along(c)}
            stroke={palette.ink}
            strokeWidth={Math.max(2, t / 5)}
          />
        </>
      );
      break;
    case "ferry": {
      const wl = 16; // wavelength
      const amp = Math.max(2, t * 0.28);
      const sw = Math.max(2, t / 6);
      const wave = horizontal
        ? `M0 ${c} q${wl / 4} ${-amp} ${wl / 2} 0 t${wl / 2} 0`
        : `M${c} 0 q${-amp} ${wl / 4} 0 ${wl / 2} t0 ${wl / 2}`;
      body = (
        <>
          <defs>
            <pattern
              id={patternId}
              patternUnits="userSpaceOnUse"
              width={horizontal ? wl : t}
              height={horizontal ? t : wl}
            >
              <path
                d={wave}
                fill="none"
                stroke={palette.waterLight}
                strokeWidth={sw}
                strokeLinecap="round"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${patternId})`} />
        </>
      );
      break;
    }
    case "local":
      body = (
        <line
          {...along(c)}
          stroke={palette.inkMuted}
          strokeWidth={Math.max(2, t * 0.3)}
          strokeLinecap="round"
        />
      );
      break;
    case "walk":
      body = (
        <line
          {...along(c)}
          stroke={palette.ink}
          strokeWidth={Math.max(2.5, t * 0.3)}
          strokeLinecap="round"
          strokeDasharray={`0 ${Math.max(6, t * 0.6)}`}
        />
      );
      break;
  }

  return (
    <svg
      width="100%"
      height="100%"
      focusable="false"
      className="block overflow-visible"
      style={horizontal ? { height: t } : { width: t }}
    >
      {body}
    </svg>
  );
}
