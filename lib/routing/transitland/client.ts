import { ProviderQuotaError, ProviderUnavailableError } from "../provider";

/**
 * Thin HTTP client for the Transitland APIs we use. Docs (read 2026-11-13):
 * - Transit routing: https://www.transit.land/documentation/routing-platform/transit-otp
 * - REST stops:      https://www.transit.land/documentation/rest-api/stops
 * - REST feed versions: https://www.transit.land/documentation/rest-api/feed_versions
 * - Quotas:          https://www.transit.land/plans-pricing/
 *
 * The docs do not state what HTTP status or headers signal an exhausted
 * quota. We treat 429 (and 402, or 403 mentioning a quota/limit) as quota
 * exhaustion, and log any rate-limit headers we see so this can be confirmed.
 */
export const TRANSITLAND_BASE_URL = "https://transit.land/api/v2";

/** Transit routes cost 2 routing units each (plans-pricing page). */
export const ROUTING_UNITS_PER_PLAN = 2;

export type UsageKind = "routing" | "rest";

export interface UsageEvent {
  kind: UsageKind;
  /** Routing units (2 per plan) or REST requests (1 each). */
  units: number;
  status: number;
  /** Any rate-limit / quota headers on the response. */
  quotaHeaders: Record<string, string>;
}

export interface TransitlandClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  onUsage?: (event: UsageEvent) => void | Promise<void>;
  planTimeoutMs?: number;
  restTimeoutMs?: number;
}

export type QueryParams = Record<string, string | number | boolean>;

export class TransitlandClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onUsage: (event: UsageEvent) => void | Promise<void>;
  private readonly planTimeoutMs: number;
  private readonly restTimeoutMs: number;

  constructor(options: TransitlandClientOptions) {
    if (!options.apiKey) {
      throw new ProviderUnavailableError("TRANSITLAND_API_KEY is not set");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? TRANSITLAND_BASE_URL;
    this.fetchImpl = options.fetch ?? fetch;
    this.onUsage = options.onUsage ?? (() => {});
    this.planTimeoutMs = options.planTimeoutMs ?? 25_000;
    this.restTimeoutMs = options.restTimeoutMs ?? 10_000;
  }

  /** GET /routing/otp/plan */
  plan(params: QueryParams): Promise<unknown> {
    return this.get("/routing/otp/plan", params, "routing", this.planTimeoutMs);
  }

  /** GET /rest/stops */
  stops(params: QueryParams): Promise<unknown> {
    return this.get("/rest/stops", params, "rest", this.restTimeoutMs);
  }

  /** GET /rest/feed_versions?sha1= */
  feedVersion(sha1: string): Promise<unknown> {
    return this.get(
      "/rest/feed_versions",
      { sha1 },
      "rest",
      this.restTimeoutMs,
    );
  }

  private async get(
    path: string,
    params: QueryParams,
    kind: UsageKind,
    timeoutMs: number,
  ): Promise<unknown> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        // Key in a header, not the URL, so it never lands in logs.
        headers: { apikey: this.apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new ProviderUnavailableError(`Transitland ${path} unreachable`, {
        cause,
      });
    }

    const quotaHeaders = pickQuotaHeaders(res.headers);
    // Usage tracking must never break a search.
    await Promise.resolve(
      this.onUsage({
        kind,
        units: kind === "routing" ? ROUTING_UNITS_PER_PLAN : 1,
        status: res.status,
        quotaHeaders,
      }),
    ).catch(() => {});

    if (res.ok) {
      try {
        return await res.json();
      } catch (cause) {
        throw new ProviderUnavailableError(`Transitland ${path}: bad JSON`, {
          cause,
        });
      }
    }

    const body = await res.text().catch(() => "");
    if (isQuotaResponse(res.status, body)) {
      const retryAfter = Number(res.headers.get("retry-after"));
      throw new ProviderQuotaError(
        `Transitland quota exhausted (${res.status})`,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderUnavailableError(
        `Transitland rejected the API key (${res.status}). Check TRANSITLAND_API_KEY.`,
      );
    }
    throw new ProviderUnavailableError(
      `Transitland ${path} failed: ${res.status} ${body.slice(0, 200)}`,
    );
  }
}

export function isQuotaResponse(status: number, body: string): boolean {
  if (status === 429 || status === 402) return true;
  return status === 403 && /quota|limit|exceeded/i.test(body);
}

function pickQuotaHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (/ratelimit|rate-limit|quota|retry-after|x-usage/i.test(name)) {
      out[name] = value;
    }
  });
  return out;
}
