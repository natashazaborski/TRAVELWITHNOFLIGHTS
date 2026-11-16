import { after, type NextRequest } from "next/server";
import { z } from "zod";
import {
  noResultsProps,
  resultsShownProps,
  type ProviderErrorType,
  type ServerEventName,
  type ServerEvents,
} from "@/lib/analytics/events";
import {
  captureServerEvent,
  identityFrom,
  type AnalyticsIdentity,
} from "@/lib/analytics/server";
import { getPlaceById } from "@/lib/places";
import {
  planTrip,
  ProviderQuotaError,
  ProviderUnavailableError,
  type PlanRequest,
} from "@/lib/routing";
import { checkPlanRateLimit, clientIp, log } from "@/lib/routing/infra";
import {
  planBodySchema,
  type PlanApiError,
} from "@/lib/routing/request-schema";
import { localToInstant } from "@/lib/time/zoned";

/** How far ahead and behind a search may be (feeds rarely cover more). */
const MAX_DAYS_AHEAD = 90;
const MAX_HOURS_BEHIND = 24;

/**
 * Sends an analytics event after the response has gone out, so it never
 * slows a search. Outside a request (unit tests) it is sent immediately.
 */
function track<E extends ServerEventName>(
  identity: AnalyticsIdentity,
  event: E,
  properties: ServerEvents[E],
) {
  const send = () => captureServerEvent(event, properties, identity);
  try {
    after(send);
  } catch {
    void send();
  }
}

function error(body: PlanApiError, httpStatus: number, headers?: HeadersInit) {
  return Response.json(body, { status: httpStatus, headers });
}

/**
 * POST /api/plan
 * Body: { from: { id }, to: { id }, dateTime: "YYYY-MM-DDTHH:mm", mode }
 * `from` / `to` may be full place objects from /api/places; only `id` is used,
 * and the place is looked up on the server so clients cannot send arbitrary
 * coordinates.
 */
export async function POST(request: NextRequest) {
  const limit = await checkPlanRateLimit(clientIp(request.headers));
  if (!limit.allowed) {
    return error(
      {
        status: "rateLimited",
        message: "Too many searches. Please wait a moment and try again.",
        retryAfterSeconds: limit.retryAfterSeconds,
      },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return error({ status: "invalid", message: "Body must be JSON." }, 400);
  }
  const parsed = planBodySchema.safeParse(json);
  if (!parsed.success) {
    return error(
      {
        status: "invalid",
        message: "Invalid search.",
        issues: z.flattenError(parsed.error),
      },
      400,
    );
  }

  const from = getPlaceById(parsed.data.from.id);
  const to = getPlaceById(parsed.data.to.id);
  if (!from || !to) {
    return error({ status: "invalid", message: "Unknown place." }, 400);
  }
  if (from.id === to.id) {
    return error(
      {
        status: "invalid",
        message: "Departure and arrival are the same place.",
      },
      400,
    );
  }

  const planRequest: PlanRequest = {
    from,
    to,
    dateTime: parsed.data.dateTime,
    mode: parsed.data.mode,
  };
  const instant = localToInstant(
    planRequest.dateTime,
    planRequest.mode === "leaveAt" ? from.timezone : to.timezone,
  );
  const now = Date.now();
  if (
    instant < now - MAX_HOURS_BEHIND * 3600_000 ||
    instant > now + MAX_DAYS_AHEAD * 86400_000
  ) {
    return error(
      {
        status: "invalid",
        message: `Pick a time between yesterday and ${MAX_DAYS_AHEAD} days from now.`,
      },
      400,
    );
  }

  const identity = identityFrom(request.headers);
  const providerError = (type: ProviderErrorType) =>
    track(identity, "provider_error", { type });

  try {
    const { result, cacheHit } = await planTrip(planRequest);
    // City-level and aggregate only (CLAUDE.md rule 8).
    if (result.itineraries.length > 0) {
      track(identity, "results_shown", resultsShownProps(result, cacheHit));
    } else {
      track(identity, "no_results", noResultsProps(from, to));
    }
    // City-level only (CLAUDE.md rule 8).
    log("plan_result", {
      from: `${from.name}, ${from.state}`,
      to: `${to.name}, ${to.state}`,
      mode: planRequest.mode,
      status: result.status,
      itineraries: result.itineraries.length,
    });
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof ProviderQuotaError) {
      providerError("quota");
      log("plan_busy", { reason: e.message });
      return error(
        {
          status: "busy",
          message:
            "Lots of people are searching right now. Please try again in a minute.",
          retryAfterSeconds: e.retryAfterSeconds,
        },
        503,
        e.retryAfterSeconds
          ? { "Retry-After": String(e.retryAfterSeconds) }
          : undefined,
      );
    }
    if (e instanceof ProviderUnavailableError) {
      providerError("unavailable");
      log("plan_unavailable", { reason: e.message });
      return error(
        {
          status: "unavailable",
          message: "We couldn't reach the timetable service. Please try again.",
        },
        502,
      );
    }
    providerError("unexpected");
    throw e;
  }
}
