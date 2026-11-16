/**
 * PostHog hosts and the first-party path the browser sends events to.
 * Used by next.config.ts (rewrites), instrumentation-client.ts, and the
 * server-side capture. Client-safe.
 *
 * Docs: https://posthog.com/docs/advanced/proxy/nextjs
 */

/**
 * Same-origin path that next.config.ts rewrites to PostHog, so ad blockers
 * that block posthog.com do not hide traffic. Deliberately not an obvious
 * name like /analytics or /posthog, which blockers match.
 */
export const ANALYTICS_PROXY_PATH = "/lanes";

export interface PosthogHosts {
  /** Ingestion API, e.g. https://us.i.posthog.com */
  api: string;
  /** Static assets and remote config, e.g. https://us-assets.i.posthog.com */
  assets: string;
  /** The PostHog app, for links such as the toolbar. */
  ui: string;
}

/**
 * Hosts for the project's region, from NEXT_PUBLIC_POSTHOG_HOST
 * ("https://us.i.posthog.com" or "https://eu.i.posthog.com"). The rewrite
 * targets must match the project's region or PostHog rejects events.
 */
export function posthogHosts(host: string | undefined): PosthogHosts {
  const region = /\/\/eu\./.test(host ?? "") ? "eu" : "us";
  return {
    api: `https://${region}.i.posthog.com`,
    assets: `https://${region}-assets.i.posthog.com`,
    ui: `https://${region}.posthog.com`,
  };
}

/** Rewrites for next.config.ts. Specific paths first, as PostHog documents. */
export function analyticsRewrites(host: string | undefined) {
  const { api, assets } = posthogHosts(host);
  return [
    {
      source: `${ANALYTICS_PROXY_PATH}/static/:path*`,
      destination: `${assets}/static/:path*`,
    },
    {
      source: `${ANALYTICS_PROXY_PATH}/array/:path*`,
      destination: `${assets}/array/:path*`,
    },
    {
      source: `${ANALYTICS_PROXY_PATH}/:path*`,
      destination: `${api}/:path*`,
    },
  ];
}

/** Headers the browser adds to /api/plan so server events join its session. */
export const DISTINCT_ID_HEADER = "x-posthog-distinct-id";
export const SESSION_ID_HEADER = "x-posthog-session-id";
