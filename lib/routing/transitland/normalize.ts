import { createHash } from "node:crypto";
import { classifyOtpMode, classifyRouteType } from "../modes";
import { bookingUrlFor } from "../operators";
import { decodePolyline } from "../polyline";
import type { Itinerary, Leg, LegStop } from "../types";
import type { OtpItinerary, OtpLeg } from "./schema";

export interface FeedInfo {
  /** Feed Onestop ID, e.g. "f-9q9-amtrak". */
  feedId: string;
  /** Date the feed version was fetched, "YYYY-MM-DD". */
  feedDate: string;
}

export interface NormalizeContext {
  /** Feed info by feed version SHA1, prefetched for every transit leg. */
  feeds: ReadonlyMap<string, FeedInfo>;
  /** IANA timezone at a stop's coordinate (the provider sends none). */
  timezoneAt: (lat: number, lon: number) => string;
  /** Names for the trip's start and end points, e.g. "Portland, OR". */
  originLabel: string;
  destinationLabel: string;
  /**
   * Timezones of the trip's start and end points when those points are the
   * searched cities (from the GeoNames data). Omitted when a search starts
   * or ends at a fallback station; its stop coordinates are used instead.
   */
  originZone?: string;
  destinationZone?: string;
}

export type DropReason =
  | "air"
  | "unsupportedMode"
  | "missingOperator"
  | "missingFeed"
  | "badTimes"
  | "noTransit";

export interface NormalizeOutcome {
  itineraries: Itinerary[];
  dropped: Partial<Record<DropReason, number>>;
}

class Drop extends Error {
  constructor(readonly reason: DropReason) {
    super(reason);
  }
}

/**
 * Converts Transitland itineraries to ours. Drops any itinerary that has an
 * air leg (rule 2), an unscheduled or unknown mode, a transit leg without its
 * operator or source feed (rule 3), or times that do not add up. Transfer
 * rules, dedupe, and sorting happen later (lib/routing/rules.ts).
 */
export function normalizeItineraries(
  raw: readonly OtpItinerary[],
  ctx: NormalizeContext,
): NormalizeOutcome {
  const itineraries: Itinerary[] = [];
  const dropped: NormalizeOutcome["dropped"] = {};
  for (const it of raw) {
    try {
      itineraries.push(normalizeItinerary(it, ctx));
    } catch (e) {
      if (!(e instanceof Drop)) throw e;
      dropped[e.reason] = (dropped[e.reason] ?? 0) + 1;
    }
  }
  return { itineraries, dropped };
}

function normalizeItinerary(
  raw: OtpItinerary,
  ctx: NormalizeContext,
): Itinerary {
  const legs = raw.legs.map((leg, i) =>
    normalizeLeg(leg, ctx, i === 0, i === raw.legs.length - 1),
  );
  if (!legs.some((l) => l.mode !== "walk")) throw new Drop("noTransit");

  // Legs must run forward in time and not overlap.
  for (let i = 0; i < raw.legs.length; i++) {
    const leg = raw.legs[i]!;
    if (leg.endTime < leg.startTime) throw new Drop("badTimes");
    const next = raw.legs[i + 1];
    if (next && next.startTime < leg.endTime) throw new Drop("badTimes");
  }

  const first = raw.legs[0]!;
  const last = raw.legs[raw.legs.length - 1]!;
  const transitCount = legs.filter((l) => l.mode !== "walk").length;
  const departure = new Date(first.startTime).toISOString();
  const arrival = new Date(last.endTime).toISOString();

  return {
    id: itineraryId(legs),
    legs,
    departure,
    arrival,
    durationMinutes: Math.round((last.endTime - first.startTime) / 60_000),
    transfers: Math.max(0, transitCount - 1),
    flags: [],
  };
}

function normalizeLeg(
  raw: OtpLeg,
  ctx: NormalizeContext,
  isFirst: boolean,
  isLast: boolean,
): Leg {
  const fromStop = stop(raw.from, isFirst ? ctx.originLabel : null);
  const toStop = stop(raw.to, isLast ? ctx.destinationLabel : null);
  const geometry = raw.legGeometry?.points
    ? safeDecode(raw.legGeometry.points)
    : null;
  const times = {
    start: new Date(raw.startTime).toISOString(),
    end: new Date(raw.endTime).toISOString(),
    // A trip's own start/end point (no stop id) is the searched city: use
    // its GeoNames timezone. Every stop is looked up by coordinate.
    timezoneStart:
      isFirst && !fromStop.stopId && ctx.originZone
        ? ctx.originZone
        : ctx.timezoneAt(fromStop.lat, fromStop.lon),
    timezoneEnd:
      isLast && !toStop.stopId && ctx.destinationZone
        ? ctx.destinationZone
        : ctx.timezoneAt(toStop.lat, toStop.lon),
  };

  const isTransit = raw.transitLeg ?? raw.mode.toUpperCase() !== "WALK";
  if (!isTransit) {
    if (raw.mode.toUpperCase() !== "WALK") throw new Drop("unsupportedMode");
    return {
      mode: "walk",
      operator: null,
      routeName: null,
      fromStop,
      toStop,
      ...times,
      feedId: null,
      feedDate: null,
      bookingUrl: null,
      geometry,
    };
  }

  const operator = raw.agencyName?.trim() || null;
  const modeClass =
    raw.routeType != null
      ? classifyRouteType(raw.routeType, operator)
      : classifyOtpMode(raw.mode, operator);
  if (modeClass === "air") throw new Drop("air");
  if (modeClass === "unsupported") throw new Drop("unsupportedMode");
  if (!operator) throw new Drop("missingOperator");

  const feed = raw.feedVersionSha1
    ? ctx.feeds.get(raw.feedVersionSha1)
    : undefined;
  if (!feed) throw new Drop("missingFeed");

  return {
    mode: modeClass,
    operator,
    routeName: raw.routeShortName?.trim() || raw.routeLongName?.trim() || null,
    fromStop,
    toStop,
    ...times,
    feedId: feed.feedId,
    feedDate: feed.feedDate,
    bookingUrl: bookingUrlFor(operator),
    geometry,
  };
}

function stop(raw: OtpLeg["from"], endpointLabel: string | null): LegStop {
  const stopId = raw.stopId?.trim() || null;
  return {
    // Unnamed street points at the ends of a trip get the place's label
    // rather than the planner's generic "Origin" / "Destination".
    name:
      (stopId ? raw.name?.trim() : null) ||
      endpointLabel ||
      raw.name?.trim() ||
      "Unnamed stop",
    lat: raw.lat,
    lon: raw.lon,
    stopId,
  };
}

function safeDecode(points: string) {
  try {
    return decodePolyline(points);
  } catch {
    return null;
  }
}

function itineraryId(legs: readonly Leg[]): string {
  const signature = legs
    .map((l) =>
      [
        l.mode,
        l.operator,
        l.routeName,
        l.fromStop.stopId,
        l.toStop.stopId,
        l.start,
        l.end,
      ].join("|"),
    )
    .join(">");
  return createHash("sha1").update(signature).digest("hex").slice(0, 16);
}

/** Feed version SHA1s used by transit legs, for prefetching feed info. */
export function feedVersionsUsed(raw: readonly OtpItinerary[]): string[] {
  const shas = new Set<string>();
  for (const it of raw) {
    for (const leg of it.legs) {
      if (leg.feedVersionSha1) shas.add(leg.feedVersionSha1);
    }
  }
  return [...shas];
}
