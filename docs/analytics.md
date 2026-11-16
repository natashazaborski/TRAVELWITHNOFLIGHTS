# Analytics

PostHog, set up so that no consent banner is needed and only city-level data
is recorded (CLAUDE.md rule 8). Code: [lib/analytics](../lib/analytics).

## How it is set up

| What                     | How                                                                                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No cookies               | `persistence: "memory"`: nothing in cookies, localStorage, or sessionStorage.                                                                                                                                              |
| Ad blockers              | The browser sends to `/lanes/…` on our own domain; `next.config.ts` rewrites it to PostHog.                                                                                                                                |
| Fast on weak connections | PostHog loads when the browser is idle, after the form is usable. No autocapture, session recording, surveys, or feature flags.                                                                                            |
| Automatic                | Page views (including client-side navigation), referrer, UTM parameters, device type, and country/region (PostHog GeoIP).                                                                                                  |
| Custom events            | Typed in [lib/analytics/events.ts](../lib/analytics/events.ts).                                                                                                                                                            |
| Blocked scripts          | `results_shown`, `no_results`, and `provider_error` are sent by the server from `/api/plan`, so they are counted even when the browser blocks PostHog. They are never sent from the browser, so nothing is double-counted. |

**What a "visitor" means here.** Without cookies, PostHog gives each full page
load a new anonymous ID. Going from the search form to the results is a
client-side navigation and keeps the same ID, so one ID is roughly one visit.
"Unique users" in PostHog therefore means visits, not people. A reload or a
shared link opened later counts as a new visit.

Server events carry the visitor's anonymous ID and session ID when the browser
sends them (`x-posthog-distinct-id` / `x-posthog-session-id` on `/api/plan`), so
they join the same visit. When analytics is blocked, the server uses a random ID
for that one search.

### Events

| Event                | Sent from | Properties                                                                                                          |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `search_submitted`   | browser   | `from_city`, `from_state`, `to_city`, `to_state`, `mode` (`leaveAt` / `arriveBy`), `hours_until_trip`               |
| `results_shown`      | server    | `option_count`, `fastest_minutes`, `modes_present`, `cache_hit`                                                     |
| `no_results`         | server    | `from_city`, `from_state`, `to_city`, `to_state`                                                                    |
| `itinerary_expanded` | browser   | `rank`, `duration_minutes`, `transfers`, `modes`                                                                    |
| `booking_clicked`    | browser   | `operator`, `rank`                                                                                                  |
| `share_clicked`      | browser   | none                                                                                                                |
| `provider_error`     | server    | `type`: `quota` (provider limit reached, users see "busy"), `unavailable` (provider down or erroring), `unexpected` |

`no_results` also carries the states, because city names repeat (Portland, OR
and Portland, ME).

## One-time setup in PostHog

1. **Project token.** `NEXT_PUBLIC_POSTHOG_KEY` must be the _project token_,
   which starts with `phc_` (Project settings → Project token). A `phs_` key is
   a secret key and must never be in a `NEXT_PUBLIC_` variable: the build drops
   any key that is not `phc_…` and analytics stays off. Set
   `NEXT_PUBLIC_POSTHOG_HOST` to `https://us.i.posthog.com` or
   `https://eu.i.posthog.com` to match the project's region.
2. **Discard client IP data.** Settings → Project → IP data capture
   configuration → turn on "Discard client IP data". GeoIP still runs first, so
   country and region still work.
3. **Drop precise location from GeoIP.** PostHog's GeoIP adds approximate
   latitude, longitude, and postal code, which are finer than city level. Under
   Data pipelines → Transformations, add a custom transformation that runs
   **after** GeoIP:

   ```hog
   let returnEvent := event
   returnEvent.properties := returnEvent.properties ?? {}
   returnEvent.properties.$geoip_latitude := null
   returnEvent.properties.$geoip_longitude := null
   returnEvent.properties.$geoip_postal_code := null
   returnEvent.properties.$geoip_accuracy_radius := null
   return returnEvent
   ```

   Check one event in Activity afterwards to confirm those properties are empty.

4. **Check GeoIP after the first deploy.** The rewrite forwards the visitor's
   `X-Forwarded-For` header to PostHog. If every visitor shows the same city or
   region (a Cloudflare data centre), the IP is not getting through: tell me and
   I'll switch the proxy to a route handler that sets the header explicitly.

## Dashboards to create

Create one dashboard, "Trips", with these insights. "Unique users" means
visits (see above).

### 1. Visitors per hour

- **Trends**, event `$pageview`, **Unique users**, interval **Hour**, range
  **Last 7 days**.
- Add a second series: `search_submitted`, **Total count**, to see how many
  visits turn into a search.
- Why: shows traffic spikes, e.g. when a storm grounds flights.

### 2. Traffic sources

- The built-in **Web analytics** page already has Channels, Referring domains,
  UTM source / medium / campaign, Devices, and Countries / Regions. Pin the
  ones you want.
- As a dashboard insight: **Trends**, event `$pageview`, **Unique users**,
  breakdown **Referring domain** (`$referring_domain`), then duplicate it with
  breakdown `utm_source`. Display: **Table**, last 30 days.

### 3. Top 20 city pairs

**SQL** insight, displayed as a table:

```sql
SELECT
  concat(properties.from_city, ', ', properties.from_state) AS from_place,
  concat(properties.to_city, ', ', properties.to_state) AS to_place,
  count() AS searches
FROM events
WHERE event = 'search_submitted'
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY from_place, to_place
ORDER BY searches DESC
LIMIT 20
```

### 4. City pairs with no results

The same query on the server event, so it includes visitors who block
analytics:

```sql
SELECT
  concat(properties.from_city, ', ', properties.from_state) AS from_place,
  concat(properties.to_city, ', ', properties.to_state) AS to_place,
  count() AS searches_with_no_results
FROM events
WHERE event = 'no_results'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY from_place, to_place
ORDER BY searches_with_no_results DESC
LIMIT 50
```

Use this to find gaps in the timetable data (or places that need a station
fallback).

### 5. Search-to-booking-click rate

- **Funnel**: step 1 `search_submitted`, step 2 `booking_clicked`, aggregated by
  **Unique users** (visits), conversion window **1 hour**, last 30 days.
- Add a breakdown on `mode` to compare "Leave at" with "Arrive by".
- Optional middle step `itinerary_expanded` to see where people drop off.
- Limitation: someone who opens a shared results link never fires
  `search_submitted`, so their booking clicks are outside this funnel.

### 6. Provider errors

- **Trends**, event `provider_error`, **Total count**, breakdown `type`,
  interval **Hour**, last 7 days.
- Error rate as a formula: series A = `provider_error`, B = `results_shown`,
  C = `no_results`, formula `A / (A + B + C)`.
- Add an **alert** on the `quota` breakdown: the Transitland Explorer plan
  allows 1,000 routing requests a month, and once it is used up every search
  says "busy".

### Useful extras

- **Share of visitors blocking analytics**: compare `results_shown + no_results`
  (server) with `search_submitted` (browser) over the same period. If the
  server count is much higher, many visitors block the script.
- **Cache hit rate**: Trends on `results_shown`, breakdown `cache_hit`.
- **Lead time**: Trends on `search_submitted`, **Property value → Median** of
  `hours_until_trip`. Low values mean people searching for right now.
