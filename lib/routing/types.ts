import type { Place } from "@/lib/places/types";

export type PlanMode = "leaveAt" | "arriveBy";

export interface PlanRequest {
  from: Place;
  to: Place;
  /**
   * Local wall-clock time, "YYYY-MM-DDTHH:mm" with no offset. Interpreted in
   * `from.timezone` for "leaveAt" and `to.timezone` for "arriveBy".
   */
  dateTime: string;
  mode: PlanMode;
}

export type LegMode = "bus" | "train" | "ferry" | "local" | "walk";

export interface LegStop {
  name: string;
  lat: number;
  lon: number;
  /** Provider stop id; null for a street location such as a city centre. */
  stopId: string | null;
}

/** GeoJSON LineString, coordinates as [lon, lat]. */
export interface LineString {
  type: "LineString";
  coordinates: [number, number][];
}

export interface Leg {
  mode: LegMode;
  /** Operator (GTFS agency) name. Null only for walking legs. */
  operator: string | null;
  /** Route short or long name, e.g. "Coast Starlight". Null for walking. */
  routeName: string | null;
  fromStop: LegStop;
  toStop: LegStop;
  /** ISO 8601 instant in UTC, e.g. "2026-11-14T17:05:00.000Z". */
  start: string;
  end: string;
  /** IANA timezone where the leg starts / ends (from stop coordinates). */
  timezoneStart: string;
  timezoneEnd: string;
  /** Source GTFS feed (Transitland Onestop ID). Null only for walking. */
  feedId: string | null;
  /** Date the feed version was fetched, "YYYY-MM-DD". Null only for walking. */
  feedDate: string | null;
  /** Operator's official booking homepage, if known. Never a deep link. */
  bookingUrl: string | null;
  geometry: LineString | null;
}

export type ItineraryFlag = "tightConnection";

export interface Itinerary {
  id: string;
  legs: Leg[];
  /** ISO instant of the first leg's start. Zone: legs[0].timezoneStart. */
  departure: string;
  /** ISO instant of the last leg's end. Zone: legs.at(-1).timezoneEnd. */
  arrival: string;
  durationMinutes: number;
  /** Number of changes between transit vehicles. */
  transfers: number;
  flags: ItineraryFlag[];
}

/** Explains that a search used a station instead of the city centre. */
export interface StationFallbackNote {
  kind: "stationFallback";
  end: "from" | "to";
  placeLabel: string;
  stationName: string;
  distanceKm: number;
  message: string;
}

export type PlanNote = StationFallbackNote;

export type PlanStatus = "ok" | "noRoutes";

export interface PlanResult {
  status: PlanStatus;
  itineraries: Itinerary[];
  notes: PlanNote[];
  provider: string;
}
