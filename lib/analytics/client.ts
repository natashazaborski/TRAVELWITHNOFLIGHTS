/**
 * Typed wrapper for analytics from the browser. Components call track();
 * nothing else in the UI touches PostHog directly.
 *
 * PostHog loads after the page is interactive (see init.ts), so events sent
 * before it is ready are queued. If analytics never loads (no key, or the
 * script is blocked), track() does nothing and never throws.
 */
import type { PostHog } from "posthog-js";
import { DISTINCT_ID_HEADER, SESSION_ID_HEADER } from "./config";
import type { ClientEventName, ClientEvents } from "./events";

type Capturer = Pick<PostHog, "capture" | "get_distinct_id" | "get_session_id">;

const MAX_QUEUED = 20;

let client: Capturer | null = null;
let queue: [ClientEventName, object][] = [];

export function track<E extends ClientEventName>(
  event: E,
  properties: ClientEvents[E],
): void {
  if (!client) {
    if (queue.length < MAX_QUEUED) queue.push([event, properties]);
    return;
  }
  try {
    client.capture(event, properties);
  } catch {
    // Analytics must never break the app.
  }
}

/** Called once PostHog has initialised. Sends anything queued before then. */
export function setAnalyticsClient(next: Capturer | null): void {
  client = next;
  if (!client) return;
  const pending = queue;
  queue = [];
  for (const [event, properties] of pending) {
    try {
      client.capture(event, properties);
    } catch {
      // ignore
    }
  }
}

/**
 * Headers for /api/plan, so the events the server sends for this search
 * join the visitor's anonymous, per-page-load session. Empty if analytics
 * is not running.
 */
export function analyticsHeaders(): Record<string, string> {
  if (!client) return {};
  try {
    const headers: Record<string, string> = {};
    const distinctId = client.get_distinct_id();
    const sessionId = client.get_session_id();
    if (distinctId) headers[DISTINCT_ID_HEADER] = distinctId;
    if (sessionId) headers[SESSION_ID_HEADER] = sessionId;
    return headers;
  } catch {
    return {};
  }
}

/** Test helper. */
export function resetAnalyticsForTests(): void {
  client = null;
  queue = [];
}
