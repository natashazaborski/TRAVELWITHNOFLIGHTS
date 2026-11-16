/**
 * Starts PostHog in the browser. Called from instrumentation-client.ts.
 *
 * Docs: https://posthog.com/docs/libraries/next-js
 *       https://posthog.com/docs/libraries/js/config
 *       https://posthog.com/docs/libraries/js/persistence
 *
 * - persistence "memory": no cookies, localStorage, or sessionStorage, so no
 *   consent banner. Each full page load is a new anonymous visitor; moving
 *   from the search form to results is a client-side navigation and keeps the
 *   same one, so search-to-booking funnels work within a visit.
 * - Sent through ANALYTICS_PROXY_PATH (a same-origin rewrite).
 * - Page views (on every client-side navigation, via `defaults`), referrer,
 *   UTM parameters, and device type are captured automatically. Country and
 *   region come from PostHog's GeoIP lookup of the request.
 * - No autocapture, session recording, surveys, or feature flags: fewer
 *   requests on weak connections, and nothing captured that we did not choose.
 * - Loaded after the page is idle, so it never delays the search form.
 */
import { setAnalyticsClient } from "./client";
import { ANALYTICS_PROXY_PATH, posthogHosts } from "./config";

/** PostHog project tokens (safe in the browser) start with "phc_". */
export function isProjectToken(key: string | undefined): key is string {
  return typeof key === "string" && key.startsWith("phc_");
}

export function initAnalytics(
  key: string | undefined = process.env.NEXT_PUBLIC_POSTHOG_KEY,
  host: string | undefined = process.env.NEXT_PUBLIC_POSTHOG_HOST,
): void {
  if (typeof window === "undefined" || !key) return;
  if (!isProjectToken(key)) {
    console.warn(
      "NEXT_PUBLIC_POSTHOG_KEY is not a PostHog project token (phc_…); analytics is off.",
    );
    return;
  }

  const start = () => {
    import("posthog-js")
      .then(({ default: posthog }) => {
        posthog.init(key, {
          api_host: ANALYTICS_PROXY_PATH,
          ui_host: posthogHosts(host).ui,
          defaults: "2026-08-30",
          persistence: "memory",
          person_profiles: "identified_only",
          autocapture: false,
          disable_session_recording: true,
          disable_surveys: true,
          advanced_disable_flags: true,
        });
        setAnalyticsClient(posthog);
      })
      .catch(() => {
        // Blocked or offline: the app works without analytics.
      });
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(start, { timeout: 4000 });
  } else {
    setTimeout(start, 1500);
  }
}
