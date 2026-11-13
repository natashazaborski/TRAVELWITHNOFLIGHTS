import type { Place } from "./types";

/** "City, ST", e.g. "Portland, OR". */
export function formatPlaceLabel(place: Pick<Place, "name" | "state">): string {
  return `${place.name}, ${place.state}`;
}
