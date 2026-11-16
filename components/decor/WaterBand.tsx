import { palette } from "@/lib/theme/palette";

/** A subtle band of water along the foot of the page. Decorative. */
export function WaterBand() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="100%"
      height="28"
      className="block"
    >
      <defs>
        <pattern
          id="water-band"
          patternUnits="userSpaceOnUse"
          width="40"
          height="28"
        >
          <rect width="40" height="28" fill={palette.water} />
          <path
            d="M0 9 q10 -6 20 0 t20 0"
            fill="none"
            stroke={palette.waterLight}
            strokeOpacity={0.45}
            strokeWidth={2}
          />
          <path
            d="M-10 19 q10 -5 20 0 t20 0 t20 0"
            fill="none"
            stroke={palette.waterLight}
            strokeOpacity={0.25}
            strokeWidth={2}
          />
        </pattern>
      </defs>
      <rect width="100%" height="28" fill="url(#water-band)" />
    </svg>
  );
}
