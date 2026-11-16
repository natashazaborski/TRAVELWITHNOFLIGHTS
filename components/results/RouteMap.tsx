"use client";

import dynamic from "next/dynamic";
import { useId, useState } from "react";
import { Sep } from "@/components/ui/Sep";
import type { Itinerary } from "@/lib/routing/types";

const RouteMapCanvas = dynamic(() => import("./RouteMapCanvas"), {
  ssr: false,
  loading: () => (
    <div className="bg-surface text-ink-muted flex h-72 items-center justify-center rounded-xl md:h-96">
      Loading map…
    </div>
  ),
});

/**
 * Map of the selected itinerary. Collapsed by default on phones (so the map
 * library isn't downloaded unless asked for), open by default on wider
 * screens.
 */
export function RouteMap({
  itinerary,
  caption,
}: {
  itinerary: Itinerary;
  caption: string;
}) {
  // Open by default on wide screens only. This component renders only in
  // the browser (after results load), so window is available.
  const [open, setOpen] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 768px)").matches,
  );
  const id = useId();

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-base font-extrabold">
          Map{" "}
          <span className="text-ink-muted font-normal">
            <Sep />
            {caption}
          </span>
        </h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen((o) => !o)}
          className="border-line bg-raised text-ink hover:border-ink min-h-11 shrink-0 rounded-lg border px-3 text-base font-bold"
        >
          {open ? "Hide map" : "Show map"}
        </button>
      </div>
      <div id={`${id}-panel`} hidden={!open}>
        {open && <RouteMapCanvas itinerary={itinerary} />}
      </div>
    </section>
  );
}
