// Server-only: Redis-backed caching, rate limiting, and quota tracking.
import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { UsageEvent } from "./transitland/client";
import type { KeyValueCache } from "./transitland/provider";
import type { PlanRequest } from "./types";

let redis: Redis | null | undefined;

/**
 * Upstash Redis from UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN, or
 * null when they are not set. Without Redis, caching, rate limiting, and
 * quota counting are off (logged once), and searches still work.
 */
export function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    log("redis_disabled", {
      reason: "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set",
    });
    redis = null;
  } else {
    redis = new Redis({ url, token });
  }
  return redis;
}

/** KeyValueCache over Redis. Errors are logged and treated as cache misses. */
export function redisCache(client: Redis): KeyValueCache {
  return {
    async get<T>(key: string) {
      try {
        return (await client.get<T>(key)) ?? null;
      } catch (error) {
        log("cache_error", { op: "get", error: String(error) });
        return null;
      }
    },
    async set<T>(key: string, value: T, ttlSeconds: number) {
      try {
        await client.set(key, value, { ex: ttlSeconds });
      } catch (error) {
        log("cache_error", { op: "set", error: String(error) });
      }
    },
  };
}

// ---------------------------------------------------------------- plan cache

export const PLAN_CACHE_TTL_SECONDS = 15 * 60;
export const PLAN_CACHE_BUCKET_MINUTES = 15;

/**
 * Cache key for a plan: provider, rounded origin and destination (2 decimals,
 * about 1 km), mode, and the local request time floored to 15 minutes.
 */
export function planCacheKey(provider: string, request: PlanRequest): string {
  const point = (p: { lat: number; lon: number }) =>
    `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  return [
    "plan:v1",
    provider,
    point(request.from),
    point(request.to),
    request.mode,
    timeBucket(request.dateTime),
  ].join(":");
}

/** "2026-11-14T09:52" -> "2026-11-14T09:45" */
export function timeBucket(local: string): string {
  const [date, time] = local.split("T") as [string, string];
  const [h, m] = time.split(":").map(Number) as [number, number];
  const floored =
    Math.floor(m / PLAN_CACHE_BUCKET_MINUTES) * PLAN_CACHE_BUCKET_MINUTES;
  return `${date}T${String(h).padStart(2, "0")}:${String(floored).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- rate limit

export const PLAN_RATE_LIMIT = { requests: 10, window: "1 m" } as const;

let planLimiter: Ratelimit | null | undefined;

function getPlanLimiter(): Ratelimit | null {
  if (planLimiter !== undefined) return planLimiter;
  const client = getRedis();
  planLimiter = client
    ? new Ratelimit({
        redis: client,
        limiter: Ratelimit.slidingWindow(
          PLAN_RATE_LIMIT.requests,
          PLAN_RATE_LIMIT.window,
        ),
        prefix: "ratelimit:plan",
        analytics: false,
      })
    : null;
  return planLimiter;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * 10 plan requests per minute per IP. The IP is hashed before it reaches
 * Redis, so no raw addresses are stored.
 */
export async function checkPlanRateLimit(
  ip: string,
): Promise<RateLimitDecision> {
  const limiter = getPlanLimiter();
  if (!limiter) return { allowed: true, retryAfterSeconds: 0 };
  const id = createHash("sha256").update(ip).digest("hex").slice(0, 32);
  const { success, reset } = await limiter.limit(id);
  return {
    allowed: success,
    retryAfterSeconds: success
      ? 0
      : Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
  };
}

/** Client IP from Vercel's proxy headers. */
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

// ---------------------------------------------------------------- quota usage

/**
 * Logs every Transitland call and keeps monthly totals in Redis, so quota
 * use is visible: routing units (2 per transit plan) and REST requests.
 */
export async function recordProviderUsage(event: UsageEvent): Promise<void> {
  const month = new Date().toISOString().slice(0, 7);
  const key = `usage:transitland:${event.kind}:${month}`;
  let monthTotal: number | null = null;
  const client = getRedis();
  if (client) {
    try {
      monthTotal = await client.incrby(key, event.units);
      if (monthTotal === event.units) await client.expire(key, 40 * 24 * 3600);
    } catch (error) {
      log("usage_counter_error", { error: String(error) });
    }
  }
  log("transitland_usage", {
    kind: event.kind,
    units: event.units,
    status: event.status,
    month,
    monthTotal,
    ...(Object.keys(event.quotaHeaders).length
      ? { quotaHeaders: event.quotaHeaders }
      : {}),
  });
}

/** Structured server log line. Never pass addresses or user coordinates. */
export function log(event: string, data: Record<string, unknown>): void {
  console.info(JSON.stringify({ event, ...data }));
}
