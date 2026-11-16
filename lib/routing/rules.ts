import type { Itinerary, ItineraryFlag, Leg, PlanMode } from "./types";

/** Transfers between different operators shorter than this are excluded. */
export const MIN_CROSS_OPERATOR_TRANSFER_MINUTES = 20;
/** Transfers between different operators shorter than this are flagged. */
export const TIGHT_CROSS_OPERATOR_TRANSFER_MINUTES = 45;
/** Itineraries this close in time over the same vehicles count as duplicates. */
export const DUPLICATE_TOLERANCE_MINUTES = 10;

const MINUTE = 60_000;
const ms = (iso: string) => Date.parse(iso);

export interface Transfer {
  /** Index in `legs` of the transit leg arrived on. */
  fromLeg: number;
  /** Index in `legs` of the next transit leg boarded. */
  toLeg: number;
  minutes: number;
  crossOperator: boolean;
}

/** Changes between consecutive transit legs, ignoring walks in between. */
export function transfersOf(legs: readonly Leg[]): Transfer[] {
  const transfers: Transfer[] = [];
  let prev = -1;
  legs.forEach((leg, i) => {
    if (leg.mode === "walk") return;
    if (prev >= 0) {
      const a = legs[prev]!;
      transfers.push({
        fromLeg: prev,
        toLeg: i,
        minutes: (ms(leg.start) - ms(a.end)) / MINUTE,
        crossOperator:
          normalizeOperator(a.operator) !== normalizeOperator(leg.operator),
      });
    }
    prev = i;
  });
  return transfers;
}

function normalizeOperator(name: string | null): string {
  return (name ?? "").trim().toLowerCase();
}

/**
 * CLAUDE.md rule 5. Returns null if the itinerary must be excluded, otherwise
 * the itinerary with "tightConnection" added when it applies.
 *
 * Transfers within one operator are not limited: the operator plans those
 * connections and usually holds or rebooks if one is late.
 */
export function applyTransferRules(itinerary: Itinerary): Itinerary | null {
  let tight = false;
  for (const t of transfersOf(itinerary.legs)) {
    if (t.minutes < 0) return null; // impossible connection
    if (!t.crossOperator) continue;
    if (t.minutes < MIN_CROSS_OPERATOR_TRANSFER_MINUTES) return null;
    if (t.minutes < TIGHT_CROSS_OPERATOR_TRANSFER_MINUTES) tight = true;
  }
  const flags: ItineraryFlag[] = itinerary.flags.filter(
    (f) => f !== "tightConnection",
  );
  if (tight) flags.push("tightConnection");
  return { ...itinerary, flags };
}

/** Identity of the vehicles ridden: operator, route, board and alight stops. */
function rideSignature(itinerary: Itinerary): string {
  return itinerary.legs
    .filter((l) => l.mode !== "walk")
    .map((l) =>
      [
        normalizeOperator(l.operator),
        l.routeName ?? "",
        l.fromStop.stopId ?? l.fromStop.name,
        l.toStop.stopId ?? l.toStop.name,
      ].join("|"),
    )
    .join(">");
}

/**
 * Removes near-identical itineraries: same vehicles between the same stops,
 * with departure and arrival each within 10 minutes. Common when the planner
 * returns variants that differ only by a walk or a few minutes of waiting.
 * Keeps the shortest one (then fewest transfers, then earliest found).
 */
export function dedupeItineraries(
  itineraries: readonly Itinerary[],
): Itinerary[] {
  const tolerance = DUPLICATE_TOLERANCE_MINUTES * MINUTE;
  const ranked = itineraries
    .map((it, order) => ({ it, order }))
    .sort(
      (a, b) =>
        a.it.durationMinutes - b.it.durationMinutes ||
        a.it.transfers - b.it.transfers ||
        a.order - b.order,
    );
  const kept: { it: Itinerary; order: number; sig: string }[] = [];
  for (const { it, order } of ranked) {
    const sig = rideSignature(it);
    const dup = kept.some(
      (k) =>
        k.sig === sig &&
        Math.abs(ms(k.it.departure) - ms(it.departure)) <= tolerance &&
        Math.abs(ms(k.it.arrival) - ms(it.arrival)) <= tolerance,
    );
    if (!dup) kept.push({ it, order, sig });
  }
  return kept.sort((a, b) => a.order - b.order).map((k) => k.it);
}

/**
 * Drops itineraries outside what the user asked for: leaving before the
 * requested time ("leaveAt") or arriving after the deadline ("arriveBy").
 */
export function withinRequest(
  itinerary: Itinerary,
  mode: PlanMode,
  requestedInstant: number,
): boolean {
  return mode === "leaveAt"
    ? ms(itinerary.departure) >= requestedInstant - MINUTE
    : ms(itinerary.arrival) <= requestedInstant;
}

/**
 * "leaveAt": earliest arrival first. "arriveBy": latest departure first.
 * Ties: shorter trip, then fewer transfers.
 */
export function sortItineraries(
  itineraries: readonly Itinerary[],
  mode: PlanMode,
): Itinerary[] {
  return [...itineraries].sort((a, b) => {
    const primary =
      mode === "leaveAt"
        ? ms(a.arrival) - ms(b.arrival)
        : ms(b.departure) - ms(a.departure);
    return (
      primary ||
      a.durationMinutes - b.durationMinutes ||
      a.transfers - b.transfers
    );
  });
}

/** Everything after provider normalization, in order. */
export function finalizeItineraries(
  itineraries: readonly Itinerary[],
  mode: PlanMode,
  requestedInstant: number,
): Itinerary[] {
  const passed = itineraries
    .filter((it) => withinRequest(it, mode, requestedInstant))
    .map(applyTransferRules)
    .filter((it): it is Itinerary => it !== null);
  return sortItineraries(dedupeItineraries(passed), mode);
}
