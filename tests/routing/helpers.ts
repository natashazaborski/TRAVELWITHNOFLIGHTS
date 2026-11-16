import type { Itinerary, Leg, LegMode } from "@/lib/routing/types";

/** Test-only builder. Times are "HH:MM" on 2026-11-14 UTC unless full ISO. */
export function leg(
  mode: LegMode,
  start: string,
  end: string,
  opts: Partial<Leg> & { from?: string; to?: string } = {},
): Leg {
  const t = (s: string) => (s.includes("T") ? s : `2026-11-14T${s}:00.000Z`);
  const { from = "A", to = "B", ...rest } = opts;
  const transit = mode !== "walk";
  return {
    mode,
    operator: transit ? "Amtrak" : null,
    routeName: transit ? "Route 1" : null,
    fromStop: { name: from, lat: 0, lon: 0, stopId: transit ? from : null },
    toStop: { name: to, lat: 0, lon: 0, stopId: transit ? to : null },
    start: t(start),
    end: t(end),
    timezoneStart: "UTC",
    timezoneEnd: "UTC",
    feedId: transit ? "f-test" : null,
    feedDate: transit ? "2026-11-01" : null,
    bookingUrl: null,
    geometry: null,
    ...rest,
  };
}

export function itinerary(legs: Leg[], id = "it"): Itinerary {
  const departure = legs[0]!.start;
  const arrival = legs[legs.length - 1]!.end;
  return {
    id,
    legs,
    departure,
    arrival,
    durationMinutes: (Date.parse(arrival) - Date.parse(departure)) / 60_000,
    transfers: Math.max(0, legs.filter((l) => l.mode !== "walk").length - 1),
    flags: [],
  };
}
