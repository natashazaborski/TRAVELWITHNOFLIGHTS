# TRAVELWITHNOFLIGHTS

A free web app that shows every way to travel between two places in the USA without flying: intercity bus, train, ferry, and local transit, with walking between stops. It is built for people whose flights were cancelled and who need to arrive by a deadline.

Product rules and conventions are in [CLAUDE.md](CLAUDE.md). Read them before contributing.

> Status: scaffold only. No features are built yet.

## Requirements

- Node.js 22 or newer (developed on Node 24)
- npm

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your local environment file:

   ```bash
   cp .env.example .env.local
   ```

   Then fill in the values:

   | Variable                   | Used for                                                  | Exposed to browser |
   | -------------------------- | --------------------------------------------------------- | ------------------ |
   | `ROUTING_PROVIDER`         | `transitland` (current) or `motis` (self-hosted, later)   | No                 |
   | `TRANSITLAND_API_KEY`      | Transitland API access                                    | No                 |
   | `MOTIS_BASE_URL`           | Self-hosted MOTIS instance, when `ROUTING_PROVIDER=motis` | No                 |
   | `NEXT_PUBLIC_POSTHOG_KEY`  | PostHog project key (city-level analytics only)           | Yes                |
   | `NEXT_PUBLIC_POSTHOG_HOST` | PostHog API host                                          | Yes                |
   | `UPSTASH_REDIS_REST_URL`   | Upstash Redis cache                                       | No                 |
   | `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis cache                                       | No                 |

   `.env.local` is gitignored. Never commit real keys.

3. Start the dev server:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000. For mobile checks, use your browser's device mode at 375px width.

## Scripts

| Command                | What it does                                 |
| ---------------------- | -------------------------------------------- |
| `npm run dev`          | Start the dev server                         |
| `npm run build`        | Production build                             |
| `npm run start`        | Serve the production build                   |
| `npm run typecheck`    | Generate Next.js route types, then run `tsc` |
| `npm run lint`         | ESLint                                       |
| `npm run format`       | Format all files with Prettier               |
| `npm run format:check` | Check formatting without writing             |
| `npm test`             | Run Vitest once                              |
| `npm run test:watch`   | Run Vitest in watch mode                     |
| `npm run check`        | Typecheck, lint, format check, and tests     |
| `npm run build:places` | Re-download GeoNames and rebuild place data  |

## Project layout

```
app/              Pages (Next.js App Router)
app/api/          Route handlers (server-side; the only place routing providers are called from)
lib/routing/      RoutingProvider interface and provider implementations (Transitland, MOTIS)
lib/places/       City search over GeoNames data (server-only entry: lib/places/index.ts)
lib/analytics/    PostHog wrapper (city-level data only)
lib/time/         Timezone and date handling
components/       React components
scripts/          Build-time scripts (run directly with Node 24)
tests/            Vitest tests (*.test.ts / *.test.tsx)
```

## Place data

City search uses the GeoNames `cities1000` dump: US places with population over 1,000, plus county seats. The data is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), which requires attribution. The site footer ([components/SiteFooter.tsx](components/SiteFooter.tsx)) provides it, so keep the footer on every page.

The generated file `lib/places/data/us-places.json` is committed, so builds never depend on GeoNames being up. To refresh it:

```bash
npm run build:places             # downloads into .cache/geonames (gitignored)
npm run build:places -- --cached # rebuilds from the cached download
```

The search API is `GET /api/places?q=<text>`, which returns at most 8 results ranked by match quality, then population.

Tests run in a Node environment by default. For a component test, add `// @vitest-environment jsdom` at the top of the file.

**Windows + Git Bash:** if every test fails with "Vitest failed to find the current suite", your shell is in the project through a lowercase drive path (`/c/Users/...`), which makes Vitest load itself twice. Run `cd "C:/Users/..."` (uppercase drive) or use PowerShell.

## Stack

Next.js (App Router), TypeScript (strict), Tailwind CSS, MapLibre GL JS, PostHog, Upstash Redis, Vitest. Deployed on Vercel.

## Deployment

Deployed on Vercel. Set the same environment variables from `.env.example` in the Vercel project settings.
