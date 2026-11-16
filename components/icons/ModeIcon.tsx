import type { LegMode } from "@/lib/routing/types";

/**
 * Original, simple line icons for each way of travelling. Drawn on a 24px
 * grid with the current text colour. Decorative: always pair with text.
 * Ground and water travel only: no flying imagery, highway shields, or
 * operator marks.
 */
const PATHS: Record<LegMode, React.ReactNode> = {
  // Side view of a coach: body, window band, door, two wheels.
  bus: (
    <>
      <rect x="2.5" y="5" width="19" height="11.5" rx="2.5" />
      <path d="M5 8.5h11.5v3H5z" />
      <path d="M19 8.5v6" />
      <circle cx="7" cy="18" r="1.75" />
      <circle cx="17" cy="18" r="1.75" />
    </>
  ),
  // Front of a train with headlights, on two rails.
  train: (
    <>
      <rect x="6" y="2.5" width="12" height="14" rx="3" />
      <path d="M8.5 5.5h7v4h-7z" />
      <circle cx="9.25" cy="13" r="0.9" />
      <circle cx="14.75" cy="13" r="0.9" />
      <path d="M8.5 16.5 6 21.5M15.5 16.5l2.5 5M7.25 19h9.5" />
    </>
  ),
  // Hull and cabin over a wave line.
  ferry: (
    <>
      <path d="M3 13h18l-2.5 4h-13z" />
      <path d="M7 13V9h8v4M9.5 9V6.5h2V9" />
      <path d="M2 20.5c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0" />
    </>
  ),
  // A streetcar with its overhead pole: city transit.
  local: (
    <>
      <rect x="5" y="6" width="14" height="11.5" rx="2" />
      <path d="M7 8.5h10v3.5H7z" />
      <path d="M12 6V3.5M9 3.5h6" />
      <path d="M8 17.5 7 20.5M16 17.5l1 3" />
    </>
  ),
  // A person mid-stride.
  walk: (
    <>
      <circle cx="13" cy="4" r="1.75" />
      <path d="m12.5 7.5-2 5.5 3 3v5" />
      <path d="M10.5 13 8.5 20.5" />
      <path d="m11.8 9.2-3.3 2.3M12.6 8.7l3 2.8" />
    </>
  ),
};

export function ModeIcon({
  mode,
  className = "size-5",
}: {
  mode: LegMode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      data-icon={mode}
    >
      {PATHS[mode]}
    </svg>
  );
}
