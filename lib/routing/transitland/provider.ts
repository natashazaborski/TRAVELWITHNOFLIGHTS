import { formatPlaceLabel } from "@/lib/places/format";
import { localToInstant } from "@/lib/time/zoned";
import { boundingBox, distanceKm, type LatLon } from "../geo";
import { ProviderUnavailableError, type RoutingProvider } from "../provider";
import { finalizeItineraries } from "../rules";
import type {
  Itinerary,
  PlanRequest,
  PlanResult,
  StationFallbackNote,
} from "../types";
import type { TransitlandClient } from "./client";
import {
  feedVersionsUsed,
  normalizeItineraries,
  type FeedInfo,
} from "./normalize";
import {
  feedVersionsResponse,
  otpPlanResponse,
  stopsResponse,
  type OtpItinerary,
} from "./schema";

/**
 * Longest trip we ask for. The docs default maxTripTime to 4 hours and state
 * no maximum. Coast to coast by train or bus takes 2.5 to 3.5 days, so ask
 * for 4 days. The real server-side cap must be confirmed with live calls
 * (scripts/record-transitland.mts) and this lowered if it is rejected.
 */
export const MAX_TRIP_SECONDS = 4 * 24 * 3600;
/** Docs default is 10; no maximum stated. */
export const MAX_ITINERARIES = 10;
/** Walking from a city centre to the first stop (docs default 800 m). */
export const MAX_WALKING_METERS = 1200;
/** Radius for the station fallback (CLAUDE.md task spec). */
export const STATION_SEARCH_RADIUS_KM = 40;

/**
 * GTFS route types for intercity rail, coach, and ferry stops, used for the
 * station fallback. Intercity buses whose feeds use plain type 3 cannot be
 * told apart from city buses this way (see operators.ts).
 */
const INTERCITY_ROUTE_TYPES = [
  2,
  4,
  ...range(100, 117),
  ...range(200, 209),
  1000,
  1200,
];

/** Minimal cache interface: Redis in production, a Map in tests. */
export interface KeyValueCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export interface TransitlandProviderDeps {
  client: TransitlandClient;
  timezoneAt: (lat: number, lon: number, fallback: string) => string;
  /** Long-lived cache for feed version info (immutable per SHA1). */
  cache?: KeyValueCache;
  log?: (event: string, data: Record<string, unknown>) => void;
}

const FEED_INFO_TTL_SECONDS = 30 * 24 * 3600;

export class TransitlandProvider implements RoutingProvider {
  readonly name = "transitland";

  constructor(private readonly deps: TransitlandProviderDeps) {}

  async plan(request: PlanRequest): Promise<PlanResult> {
    const zone =
      request.mode === "leaveAt" ? request.from.timezone : request.to.timezone;
    const requestedInstant = localToInstant(request.dateTime, zone);

    const direct = await this.search(
      request,
      request.from,
      request.to,
      requestedInstant,
    );
    if (direct.length > 0) {
      return {
        status: "ok",
        itineraries: direct,
        notes: [],
        provider: this.name,
      };
    }

    // Nothing from the city centres. Retry from the nearest intercity
    // stations (rail, coach, ferry) within 40 km of each end.
    const [fromStation, toStation] = await Promise.all([
      this.nearestStation(request.from),
      this.nearestStation(request.to),
    ]);
    if (!fromStation && !toStation) return this.noRoutes();

    const notes: StationFallbackNote[] = [];
    if (fromStation) notes.push(stationNote("from", request.from, fromStation));
    if (toStation) notes.push(stationNote("to", request.to, toStation));

    const retried = await this.search(
      request,
      fromStation ?? request.from,
      toStation ?? request.to,
      requestedInstant,
    );
    this.log("transitland_station_fallback", {
      from: fromStation?.name ?? null,
      to: toStation?.name ?? null,
      itineraries: retried.length,
    });
    return retried.length > 0
      ? { status: "ok", itineraries: retried, notes, provider: this.name }
      : this.noRoutes();
  }

  private noRoutes(): PlanResult {
    return {
      status: "noRoutes",
      itineraries: [],
      notes: [],
      provider: this.name,
    };
  }

  private async search(
    request: PlanRequest,
    from: LatLon,
    to: LatLon,
    requestedInstant: number,
  ): Promise<Itinerary[]> {
    const [date, time] = splitLocal(request.dateTime);
    const body = await this.deps.client.plan({
      fromPlace: `${from.lat},${from.lon}`,
      toPlace: `${to.lat},${to.lon}`,
      date,
      time,
      arriveBy: request.mode === "arriveBy",
      maxItineraries: MAX_ITINERARIES,
      maxTripTime: MAX_TRIP_SECONDS,
      maxWalkingDistance: MAX_WALKING_METERS,
      // Never plan on a substitute weekday from outside a feed's service
      // period: that would be a guessed schedule (CLAUDE.md rule 1).
      useFallbackDates: false,
    });

    const parsed = otpPlanResponse.safeParse(body);
    if (!parsed.success) {
      throw new ProviderUnavailableError(
        "Unexpected Transitland plan response",
        {
          cause: parsed.error,
        },
      );
    }
    const raw: OtpItinerary[] = parsed.data.plan?.itineraries ?? [];
    if (raw.length === 0) {
      if (parsed.data.error) {
        this.log("transitland_plan_error", { error: parsed.data.error });
      }
      return [];
    }

    const feeds = await this.feedInfo(feedVersionsUsed(raw));
    const fallbackZone = (lat: number, lon: number) =>
      distanceKm({ lat, lon }, request.from) <=
      distanceKm({ lat, lon }, request.to)
        ? request.from.timezone
        : request.to.timezone;

    const { itineraries, dropped } = normalizeItineraries(raw, {
      feeds,
      timezoneAt: (lat, lon) =>
        this.deps.timezoneAt(lat, lon, fallbackZone(lat, lon)),
      originLabel: formatPlaceLabel(request.from),
      destinationLabel: formatPlaceLabel(request.to),
      // The searched city's own zone when the search starts/ends there
      // (not at a fallback station).
      originZone: from === request.from ? request.from.timezone : undefined,
      destinationZone: to === request.to ? request.to.timezone : undefined,
    });
    const final = finalizeItineraries(
      itineraries,
      request.mode,
      requestedInstant,
    );
    this.log("transitland_plan", {
      raw: raw.length,
      normalized: itineraries.length,
      final: final.length,
      dropped,
    });
    return final;
  }

  /** Feed Onestop ID and fetch date for each feed version SHA1. */
  private async feedInfo(shas: string[]): Promise<Map<string, FeedInfo>> {
    const entries = await Promise.all(
      shas.map(async (sha1): Promise<[string, FeedInfo]> => {
        const key = `transitland:feed-version:${sha1}`;
        const cached = await this.deps.cache?.get<FeedInfo>(key);
        if (cached) return [sha1, cached];

        const parsed = feedVersionsResponse.safeParse(
          await this.deps.client.feedVersion(sha1),
        );
        const fv = parsed.success
          ? parsed.data.feed_versions.find((f) => f.sha1 === sha1)
          : undefined;
        if (!fv) {
          // Without the feed date we cannot meet rule 3; fail the search
          // rather than show legs with unknown provenance.
          throw new ProviderUnavailableError(`Feed version ${sha1} not found`);
        }
        const info: FeedInfo = {
          feedId: fv.feed.onestop_id,
          feedDate: fv.fetched_at.slice(0, 10),
        };
        await this.deps.cache?.set(key, info, FEED_INFO_TTL_SECONDS);
        return [sha1, info];
      }),
    );
    return new Map(entries);
  }

  /** Nearest rail, coach, or ferry stop within 40 km, or null. */
  private async nearestStation(center: LatLon): Promise<{
    name: string;
    lat: number;
    lon: number;
    distanceKm: number;
  } | null> {
    // The stops API caps `radius` at 10 km, so search a 40 km bounding box
    // and filter by true distance.
    const bbox = boundingBox(center, STATION_SEARCH_RADIUS_KM)
      .map((n) => n.toFixed(5))
      .join(",");
    const parsed = stopsResponse.safeParse(
      await this.deps.client.stops({
        bbox,
        served_by_route_types: INTERCITY_ROUTE_TYPES.join(","),
        limit: 100,
      }),
    );
    if (!parsed.success) {
      throw new ProviderUnavailableError(
        "Unexpected Transitland stops response",
        {
          cause: parsed.error,
        },
      );
    }
    let best: {
      name: string;
      lat: number;
      lon: number;
      distanceKm: number;
    } | null = null;
    for (const s of parsed.data.stops) {
      const [lon, lat] = s.geometry.coordinates;
      const d = distanceKm(center, { lat, lon });
      if (d > STATION_SEARCH_RADIUS_KM) continue;
      if (!best || d < best.distanceKm) {
        best = {
          name: s.stop_name?.trim() || "Unnamed station",
          lat,
          lon,
          distanceKm: d,
        };
      }
    }
    return best;
  }

  private log(event: string, data: Record<string, unknown>) {
    this.deps.log?.(event, data);
  }
}

function stationNote(
  end: "from" | "to",
  place: PlanRequest["from"],
  station: { name: string; distanceKm: number },
): StationFallbackNote {
  const placeLabel = formatPlaceLabel(place);
  const km = Math.round(station.distanceKm * 10) / 10;
  const message =
    end === "from"
      ? `No trips start near the centre of ${placeLabel}. Showing trips from ${station.name}, ${km} km away. You will need to get to the station.`
      : `No trips end near the centre of ${placeLabel}. Showing trips to ${station.name}, ${km} km away. You will need to get from the station.`;
  return {
    kind: "stationFallback",
    end,
    placeLabel,
    stationName: station.name,
    distanceKm: km,
    message,
  };
}

/** "2026-11-14T09:00" -> ["2026-11-14", "09:00:00"] */
function splitLocal(local: string): [string, string] {
  const [date, time] = local.split("T") as [string, string];
  return [date, time.length === 5 ? `${time}:00` : time];
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
