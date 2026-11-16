import { isIntercityBusOperator } from "./operators";
import type { LegMode } from "./types";

/**
 * Result of classifying a transit leg:
 * - a LegMode we can show,
 * - "air": an air service leg; the whole itinerary must be dropped (rule 2),
 * - "unsupported": no fixed schedule or unknown type (taxi, demand-response);
 *   the itinerary is dropped rather than shown with a guessed mode.
 */
export type ModeClass = Exclude<LegMode, "walk"> | "air" | "unsupported";

/**
 * Maps a GTFS route_type (basic 0-12 or extended 100-1700) to our modes.
 * https://gtfs.org/documentation/schedule/reference/#routestxt
 * https://developers.google.com/transit/gtfs/reference/extended-route-types
 *
 * GTFS does not separate intercity from local buses: Greyhound and FlixBus
 * feeds use type 3 like any city bus. A bus is "bus" (intercity) when its
 * type is a coach type (200-209) or its operator is a known intercity
 * operator; otherwise it is "local".
 */
export function classifyRouteType(
  routeType: number,
  operator: string | null,
): ModeClass {
  // Basic types
  switch (routeType) {
    case 0: // tram, light rail
    case 1: // subway, metro
    case 5: // cable tram
    case 6: // aerial lift, gondola
    case 7: // funicular
    case 11: // trolleybus
    case 12: // monorail
      return "local";
    case 2: // rail (intercity or long distance, commuter)
      return "train";
    case 3: // bus
      return isIntercityBusOperator(operator) ? "bus" : "local";
    case 4: // ferry
      return "ferry";
  }

  // Extended types
  if (routeType >= 100 && routeType <= 117) return "train"; // railway services
  if (routeType >= 200 && routeType <= 209) return "bus"; // coach services
  if (routeType >= 400 && routeType <= 405) return "local"; // urban railway
  if (routeType >= 700 && routeType <= 716) {
    return isIntercityBusOperator(operator) ? "bus" : "local"; // bus services
  }
  if (routeType === 800) return "local"; // trolleybus
  if (routeType >= 900 && routeType <= 906) return "local"; // tram
  if (routeType === 1000 || routeType === 1200) return "ferry"; // water, ferry
  if (routeType >= 1100 && routeType <= 1199) return "air"; // air service
  if (routeType === 1300 || routeType === 1400) return "local"; // aerial, funicular
  return "unsupported"; // 1500 taxi, 1700 misc, anything unknown
}

/**
 * Fallback when a leg has no route_type: the OTP-style mode string.
 */
export function classifyOtpMode(
  mode: string,
  operator: string | null,
): ModeClass {
  switch (mode.toUpperCase()) {
    case "RAIL":
      return "train";
    case "BUS":
    case "COACH":
      return isIntercityBusOperator(operator) || mode === "COACH"
        ? "bus"
        : "local";
    case "FERRY":
      return "ferry";
    case "TRAM":
    case "SUBWAY":
    case "CABLE_CAR":
    case "GONDOLA":
    case "FUNICULAR":
    case "TROLLEYBUS":
    case "MONORAIL":
      return "local";
    case "AIRPLANE":
    case "AIR":
      return "air";
    default:
      return "unsupported";
  }
}
