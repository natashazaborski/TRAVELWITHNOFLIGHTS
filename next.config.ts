import type { NextConfig } from "next";
import { analyticsRewrites } from "./lib/analytics/config";

const nextConfig: NextConfig = {
  // cacheComponents and partialPrefetching (create-next-app defaults) are off:
  // on Cloudflare Workers (OpenNext) the prerendered home page hung with
  // "This promise was created by a request that has since ended", after
  // Next.js warned it "cannot guarantee that Cache Components will run as
  // expected due to the current runtime's implementation of setTimeout()".
  // The app does not use "use cache".
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },

  // PostHog through our own domain so ad blockers do not hide traffic.
  // https://posthog.com/docs/advanced/proxy/nextjs
  async rewrites() {
    return analyticsRewrites(process.env.NEXT_PUBLIC_POSTHOG_HOST);
  },
  // PostHog API paths end in "/" (e.g. /e/); without this every event
  // costs an extra 308 redirect round trip.
  skipTrailingSlashRedirect: true,
};

// NEXT_PUBLIC_ values are copied into the browser bundle. Never ship anything
// but a PostHog project token (phc_…): a secret key (phs_…) or personal key
// (phx_…) here would be published to every visitor. Drop it instead, which
// turns analytics off, and say so in the build output.
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
if (posthogKey && !posthogKey.startsWith("phc_")) {
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  console.warn(
    "\n⚠ NEXT_PUBLIC_POSTHOG_KEY is not a PostHog project token (phc_…), so it was " +
      "left out of the build and analytics is off. Use the token from PostHog > " +
      "Project settings > Project token.\n",
  );
}

export default nextConfig;
