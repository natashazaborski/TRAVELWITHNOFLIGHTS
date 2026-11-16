/**
 * The custom analytics events and their properties. Client-safe.
 *
 * City-level data only (CLAUDE.md rule 8): city and state names, counts,
 * durations, and modes. Never street addresses, stop coordinates, or any
 * precise location of the person using the app.
 */
import type { Place } from "@/lib/places/types";
import type {
  Itinerary,
  LegMode,
  PlanMode,
  PlanResult,
} from "@/lib/routing/types";

/** Sent from the browser. */
export interface ClientEvents {
  search_submitted: {
    from_city: string;
    from_state: string;
    to_city: string;
    to_state: string;
    mode: PlanMode;
    /** Hours from now until the requested time; negative if in the past. */
    hours_until_trip: number;
  };
  itinerary_expanded: {
    /** 1-based position in the list as currently sorted. */
    rank: number;
    duration_minutes: number;
    transfers: number;
    modes: LegMode[];
  };
  booking_clicked: { operator: string; rank: number };
  share_clicked: Record<string, never>;
}

/**
 * Sent from /api/plan, so they are counted even when the browser blocks
 * analytics scripts. Never sent from the browser, so nothing is counted twice.
 */
export interface ServerEvents {
  results_shown: {
    option_count: number;
    fastest_minutes: number;
    modes_present: LegMode[];
    cache_hit: boolean;
  };
  /** States are included because city names repeat (Portland, OR / ME). */
  no_results: {
    from_city: string;
    from_state: string;
    to_city: string;
    to_state: string;
  };
  provider_error: { type: ProviderErrorType };
}

/**
 * quota: the routing provider's limit was reached ("busy" for the user).
 * unavailable: the provider could not be reached or answered with an error.
 * unexpected: anything else that failed while planning.
 */
export type ProviderErrorType = "quota" | "unavailable" | "unexpected";

export type ClientEventName = keyof ClientEvents;
export type ServerEventName = keyof ServerEvents;

const MODE_ORDER: LegMode[] = ["walk", "local", "bus", "train", "ferry"];

/** Distinct modes, in a fixed order so dashboards group them consistently. */
export function distinctModes(itineraries: Itinerary[]): LegMode[] {
  const seen = new Set(itineraries.flatMap((it) => it.legs.map((l) => l.mode)));
  return MODE_ORDER.filter((m) => seen.has(m));
}

export function searchSubmittedProps(
  from: Pick<Place, "name" | "state">,
  to: Pick<Place, "name" | "state">,
  mode: PlanMode,
  tripInstantMs: number,
  nowMs: number,
): ClientEvents["search_submitted"] {
  return {
    from_city: from.name,
    from_state: from.state,
    to_city: to.name,
    to_state: to.state,
    mode,
    hours_until_trip: Math.round((tripInstantMs - nowMs) / 360_000) / 10,
  };
}

export function itineraryExpandedProps(
  itinerary: Itinerary,
  rank: number,
): ClientEvents["itinerary_expanded"] {
  return {
    rank,
    duration_minutes: itinerary.durationMinutes,
    transfers: itinerary.transfers,
    modes: distinctModes([itinerary]),
  };
}

export function resultsShownProps(
  result: PlanResult,
  cacheHit: boolean,
): ServerEvents["results_shown"] {
  return {
    option_count: result.itineraries.length,
    fastest_minutes: Math.min(
      ...result.itineraries.map((it) => it.durationMinutes),
    ),
    modes_present: distinctModes(result.itineraries),
    cache_hit: cacheHit,
  };
}

export function noResultsProps(
  from: Pick<Place, "name" | "state">,
  to: Pick<Place, "name" | "state">,
): ServerEvents["no_results"] {
  return {
    from_city: from.name,
    from_state: from.state,
    to_city: to.name,
    to_state: to.state,
  };
}
