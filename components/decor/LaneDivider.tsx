import { palette } from "@/lib/theme/palette";

/** Section divider drawn as a dashed white lane line. Decorative. */
export function LaneDivider({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="100%"
      height="4"
      className={`block ${className}`}
    >
      <line
        x1="0"
        y1="2"
        x2="100%"
        y2="2"
        stroke={palette.ink}
        strokeOpacity={0.55}
        strokeWidth={3}
        strokeDasharray="18 14"
      />
    </svg>
  );
}
