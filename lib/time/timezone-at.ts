// Pure JavaScript, no file system access, so it runs on Cloudflare Workers.
import tzlookup from "@photostructure/tz-lookup";

/**
 * IANA timezone at a coordinate.
 *
 * Used only for transit stops: the routing provider returns no timezone or
 * UTC offset with its legs (Transitland docs, checked 2026-11-13), and
 * cities already carry their timezone in the GeoNames data.
 *
 * tz-lookup trades some accuracy for size; errors cluster within a few km of
 * zone borders. Spot-checked against US border stops (Gary / Michigan City /
 * South Bend IN, Mandan ND, Pensacola FL, El Paso TX, Ontario OR) and all
 * were correct; see tests/time/timezone-at.test.ts.
 *
 * Offshore points can resolve to a nautical "Etc/GMT+N" zone with no
 * daylight saving time; `fallback` is returned instead.
 */
export function timezoneAt(lat: number, lon: number, fallback: string): string {
  let zone: string;
  try {
    zone = tzlookup(lat, lon);
  } catch {
    return fallback;
  }
  if (!zone || zone.startsWith("Etc/")) return fallback;
  return zone;
}
