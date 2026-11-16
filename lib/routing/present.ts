/**
 * Presentation helpers for itineraries. Pure and client-safe: everything is
 * derived from provider data; nothing here creates or estimates times.
 */
import { transfersOf, TIGHT_CROSS_OPERATOR_TRANSFER_MINUTES } from "./rules";
import type { Itinerary, Leg, LegMode } from "./types";

const MINUTE = 60_000;
const ms = (iso: string) => Date.parse(iso);

export type SortKey = "arrival" | "duration" | "transfers";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "arrival", label: "Earliest arrival" },
  { key: "duration", label: "Shortest total time" },
  { key: "transfers", label: "Fewest transfers" },
];

export function parseSortKey(value: string | null): SortKey {
  return value === "duration" || value === "transfers" ? value : "arrival";
}

/** Sorted copy. Ties fall through to the other two criteria. */
export function sortForDisplay(
  itineraries: readonly Itinerary[],
  key: SortKey,
): Itinerary[] {
  const byArrival = (a: Itinerary, b: Itinerary) =>
    ms(a.arrival) - ms(b.arrival);
  const byDuration = (a: Itinerary, b: Itinerary) =>
    a.durationMinutes - b.durationMinutes;
  const byTransfers = (a: Itinerary, b: Itinerary) => a.transfers - b.transfers;
  const order =
    key === "arrival"
      ? [byArrival, byDuration, byTransfers]
      : key === "duration"
        ? [byDuration, byArrival, byTransfers]
        : [byTransfers, byArrival, byDuration];
  return [...itineraries].sort((a, b) => {
    for (const cmp of order) {
      const d = cmp(a, b);
      if (d !== 0) return d;
    }
    return 0;
  });
}

/** Minutes between arrival and an arrive-by deadline (negative if late). */
export function spareMinutes(itinerary: Itinerary, deadline: number): number {
  return Math.floor((deadline - ms(itinerary.arrival)) / MINUTE);
}

/**
 * For "Arrive by": the itinerary that leaves latest while still arriving by
 * the deadline. Ties go to the earlier arrival. Null if none is on time.
 */
export function latestOnTimeDeparture(
  itineraries: readonly Itinerary[],
  deadline: number,
): Itinerary | null {
  let best: Itinerary | null = null;
  for (const it of itineraries) {
    if (ms(it.arrival) > deadline) continue;
    if (
      !best ||
      ms(it.departure) > ms(best.departure) ||
      (ms(it.departure) === ms(best.departure) &&
        ms(it.arrival) < ms(best.arrival))
    ) {
      best = it;
    }
  }
  return best;
}

export interface RouteSegment {
  mode: LegMode;
  minutes: number;
  /** Share of the summed leg durations, 0..1. */
  fraction: number;
}

/** One segment per leg, sized by that leg's duration. */
export function routeSegments(itinerary: Itinerary): RouteSegment[] {
  const minutes = itinerary.legs.map((l) =>
    Math.max(0, (ms(l.end) - ms(l.start)) / MINUTE),
  );
  const total = minutes.reduce((a, b) => a + b, 0) || 1;
  return itinerary.legs.map((l, i) => ({
    mode: l.mode,
    minutes: minutes[i]!,
    fraction: minutes[i]! / total,
  }));
}

export interface TransferInfo {
  /** Index of the transit leg arrived on; the change happens after it. */
  afterLeg: number;
  /** Index of the next transit leg boarded. */
  beforeLeg: number;
  /** Time from arriving to departing again, walking included. */
  waitMinutes: number;
  /** Walking time inside that window. */
  walkMinutes: number;
  stopName: string;
  fromOperator: string | null;
  toOperator: string | null;
  /** Different operators and under 45 minutes (CLAUDE.md rule 5). */
  tight: boolean;
}

export function transferDetails(itinerary: Itinerary): TransferInfo[] {
  const legs = itinerary.legs;
  return transfersOf(legs).map((t) => {
    const walkMinutes = legs
      .slice(t.fromLeg + 1, t.toLeg)
      .filter((l) => l.mode === "walk")
      .reduce((sum, l) => sum + (ms(l.end) - ms(l.start)) / MINUTE, 0);
    return {
      afterLeg: t.fromLeg,
      beforeLeg: t.toLeg,
      waitMinutes: Math.round(t.minutes),
      walkMinutes: Math.round(walkMinutes),
      stopName: legs[t.fromLeg]!.toStop.name,
      fromOperator: legs[t.fromLeg]!.operator,
      toOperator: legs[t.toLeg]!.operator,
      tight:
        t.crossOperator && t.minutes < TIGHT_CROSS_OPERATOR_TRANSFER_MINUTES,
    };
  });
}

/**
 * The oldest feed date among the itinerary's transit legs ("YYYY-MM-DD"),
 * i.e. the most out-of-date schedule the trip relies on.
 */
export function schedulesAsOf(itinerary: Itinerary): string | null {
  const dates = itinerary.legs
    .map((l) => l.feedDate)
    .filter((d): d is string => !!d)
    .sort();
  return dates[0] ?? null;
}

/** Legs that should show a booking button: first leg of each operator. */
export function bookingLegIndexes(legs: readonly Leg[]): Set<number> {
  const seen = new Set<string>();
  const out = new Set<number>();
  legs.forEach((leg, i) => {
    if (!leg.bookingUrl || !leg.operator) return;
    const key = leg.operator.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.add(i);
  });
  return out;
}

export const MODE_LABEL: Record<LegMode, string> = {
  train: "Train",
  bus: "Intercity bus",
  ferry: "Ferry",
  local: "Local transit",
  walk: "Walk",
};

/** "45 min", "9 h 35 min", "2 d 3 h" */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
  return `${mins} min`;
}

export function formatTransfers(n: number): string {
  if (n === 0) return "Direct";
  return n === 1 ? "1 transfer" : `${n} transfers`;
}

/** "2026-11-02" -> "Nov 2, 2026" (a calendar date, no timezone involved). */
export function formatFeedDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
