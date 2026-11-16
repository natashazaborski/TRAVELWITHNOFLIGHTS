/**
 * Server-side analytics events, sent from route handlers straight to
 * PostHog's capture API. Used for events that must be counted even when the
 * browser blocks analytics scripts.
 *
 * Docs: https://posthog.com/docs/api/capture (POST /i/v0/e/)
 *       https://posthog.com/docs/libraries/node (anonymous events,
 *       $process_person_profile; GeoIP is off for server events)
 *
 * Plain fetch rather than posthog-node: one request per event, nothing to
 * flush, and it runs the same on Node and Cloudflare Workers.
 */
import { DISTINCT_ID_HEADER, posthogHosts, SESSION_ID_HEADER } from "./config";
import type { ServerEventName, ServerEvents } from "./events";

/** Ids posthog-js generates are UUIDs; accept only short, plain tokens. */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface AnalyticsIdentity {
  distinctId: string;
  sessionId: string | null;
}

/**
 * The visitor's anonymous PostHog ids from the request headers, if the
 * browser sent them; otherwise a fresh random id for this one search.
 */
export function identityFrom(headers: Headers): AnalyticsIdentity {
  const distinct = headers.get(DISTINCT_ID_HEADER);
  const session = headers.get(SESSION_ID_HEADER);
  return {
    distinctId:
      distinct && SAFE_ID.test(distinct) ? distinct : crypto.randomUUID(),
    sessionId: session && SAFE_ID.test(session) ? session : null,
  };
}

export interface CaptureOptions {
  key?: string;
  host?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Sends one event. Resolves to whether PostHog accepted it; never throws.
 * Does nothing without a project token.
 */
export async function captureServerEvent<E extends ServerEventName>(
  event: E,
  properties: ServerEvents[E],
  identity: AnalyticsIdentity,
  {
    key = process.env.NEXT_PUBLIC_POSTHOG_KEY,
    host = process.env.NEXT_PUBLIC_POSTHOG_HOST,
    fetchImpl = fetch,
    timeoutMs = 3000,
  }: CaptureOptions = {},
): Promise<boolean> {
  if (!key || !key.startsWith("phc_")) return false;
  const body = {
    api_key: key,
    event,
    distinct_id: identity.distinctId,
    timestamp: new Date().toISOString(),
    properties: {
      ...properties,
      ...(identity.sessionId ? { $session_id: identity.sessionId } : {}),
      // Anonymous event: no person profile.
      $process_person_profile: false,
      // The request comes from our server, so its IP says nothing about the
      // visitor. Never send or look up an IP from here.
      $geoip_disable: true,
      $lib: "no-fly-routes-server",
    },
  };
  try {
    const res = await fetchImpl(`${posthogHosts(host).api}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
