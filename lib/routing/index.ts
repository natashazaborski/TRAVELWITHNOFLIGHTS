// Server-only entry point for routing. Route handlers call planTrip(); UI
// code never imports a provider or calls a routing API (CLAUDE.md rule 7).
import { localToInstant } from "@/lib/time/zoned";
import { timezoneAt } from "@/lib/time/timezone-at";
import {
  getRedis,
  log,
  PLAN_CACHE_TTL_SECONDS,
  planCacheKey,
  recordProviderUsage,
  redisCache,
} from "./infra";
import { ProviderUnavailableError, type RoutingProvider } from "./provider";
import { sortItineraries, withinRequest } from "./rules";
import { TransitlandClient } from "./transitland/client";
import { TransitlandProvider } from "./transitland/provider";
import type { PlanRequest, PlanResult } from "./types";

export { ProviderQuotaError, ProviderUnavailableError } from "./provider";
export type { RoutingProvider } from "./provider";
export type * from "./types";

let provider: RoutingProvider | undefined;

/** The provider selected by ROUTING_PROVIDER ("transitland" by default). */
export function getRoutingProvider(): RoutingProvider {
  if (provider) return provider;
  const name = (process.env.ROUTING_PROVIDER ?? "transitland").toLowerCase();
  switch (name) {
    case "transitland": {
      const redis = getRedis();
      provider = new TransitlandProvider({
        client: new TransitlandClient({
          apiKey: process.env.TRANSITLAND_API_KEY ?? "",
          onUsage: recordProviderUsage,
        }),
        timezoneAt,
        cache: redis ? redisCache(redis) : undefined,
        log,
      });
      return provider;
    }
    case "motis":
      throw new ProviderUnavailableError(
        "ROUTING_PROVIDER=motis is not implemented yet",
      );
    default:
      throw new ProviderUnavailableError(`Unknown ROUTING_PROVIDER "${name}"`);
  }
}

/**
 * Plans a trip through the configured provider, with a 15-minute Redis cache.
 * Cached results are re-filtered against the exact requested time, because
 * the cache key rounds the time down to a 15-minute bucket.
 */
export async function planTrip(
  request: PlanRequest,
  routing: RoutingProvider = getRoutingProvider(),
): Promise<PlanOutcome> {
  const redis = getRedis();
  const cache = redis ? redisCache(redis) : null;
  const key = planCacheKey(routing.name, request);

  const cached = await cache?.get<PlanResult>(key);
  if (cached) {
    log("plan_cache_hit", { provider: routing.name });
    return { result: refilter(cached, request), cacheHit: true };
  }

  const result = await routing.plan(request);
  await cache?.set(key, result, PLAN_CACHE_TTL_SECONDS);
  return { result, cacheHit: false };
}

export interface PlanOutcome {
  result: PlanResult;
  /** True when the result came from the 15-minute cache. */
  cacheHit: boolean;
}

function refilter(result: PlanResult, request: PlanRequest): PlanResult {
  const zone =
    request.mode === "leaveAt" ? request.from.timezone : request.to.timezone;
  const instant = localToInstant(request.dateTime, zone);
  const itineraries = sortItineraries(
    result.itineraries.filter((it) => withinRequest(it, request.mode, instant)),
    request.mode,
  );
  return itineraries.length > 0
    ? { ...result, itineraries }
    : { ...result, status: "noRoutes", itineraries: [], notes: [] };
}
