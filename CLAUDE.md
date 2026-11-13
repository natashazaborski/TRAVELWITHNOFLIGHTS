# CLAUDE.md

## PRODUCT
[APP NAME] is a free web app that shows every way to travel between two places in the USA without flying. The user enters "Departure" and "Arriving", chooses "Leave at" or "Arrive by" with a date and time, and gets real itineraries combining intercity bus, train, ferry, and local transit, with walking between stops. The audience is people whose flights were cancelled and who need to get somewhere by a deadline, mostly on a phone, often stressed. Speed and trust matter more than features.

## HARD RULES
1. Never invent, mock, estimate, or hardcode schedule data in production code. Every departure and arrival time comes from the routing provider. If the provider returns nothing, show "no routes found", never a guess.
2. No flights or airports as transport, in results, icons, copy, or empty states.
3. Every leg carries: mode, operator name, origin stop, destination stop, start and end time with IANA timezone, source feed, and feed date.
4. Times are displayed in the local timezone of the stop where they occur, with the zone abbreviation. "Leave at" input is interpreted in the departure place's timezone. "Arrive by" input is interpreted in the arrival place's timezone. Trips crossing midnight show "+1 day" or "+2 days".
5. A transfer between two different operators under 20 minutes is excluded. Under 45 minutes is flagged "tight connection".
6. No accounts, no login, no payments.
7. All routing goes through the RoutingProvider interface in lib/routing. UI code never calls a routing API directly.
8. Analytics records city-level data only. Never record street addresses or precise user coordinates.
9. Mobile first. Every screen must work at 375px width and load fast on a weak connection.

## STACK
Next.js App Router, TypeScript strict mode, Tailwind, MapLibre GL JS, PostHog, Upstash Redis, Vitest. Deployed on Vercel. Routing provider is Transitland now and self-hosted MOTIS later, switched by the ROUTING_PROVIDER env var.

## WORKING STYLE
Before using any external API, read its current documentation and confirm endpoints and parameters. Do not rely on memory. Write tests for routing normalization and time handling. After each task, run typecheck, lint, and tests, and tell me what you could not verify.
