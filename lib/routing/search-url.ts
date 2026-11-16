/**
 * Search state <-> URL query string, so any search can be shared or
 * reloaded. Client-safe: no server imports.
 *
 *   ?from=5746545-portland-or&to=5809844-seattle-wa&mode=arriveBy
 *    &date=2026-11-17&time=18:00
 *
 * Places are identified by GeoNames id; the slug after the id is only for
 * people reading the link and is ignored when parsing.
 */
import type { PlanMode } from "./types";

export interface SearchState {
  fromId: number | null;
  toId: number | null;
  mode: PlanMode;
  /** "YYYY-MM-DD" */
  date: string | null;
  /** "HH:MM", 24-hour */
  time: string | null;
}

export const EMPTY_SEARCH: SearchState = {
  fromId: null,
  toId: null,
  mode: "leaveAt",
  date: null,
  time: null,
};

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function placeId(value: string | null): number | null {
  const m = value ? /^(\d{1,10})(?:-|$)/.exec(value) : null;
  return m ? Number(m[1]) : null;
}

export function parseSearch(params: URLSearchParams): SearchState {
  const date = params.get("date");
  const time = params.get("time");
  return {
    fromId: placeId(params.get("from")),
    toId: placeId(params.get("to")),
    mode: params.get("mode") === "arriveBy" ? "arriveBy" : "leaveAt",
    date: date && DATE.test(date) ? date : null,
    time: time && TIME.test(time) ? time : null,
  };
}

/** True when the state describes a search that can be run. */
export function isCompleteSearch(state: SearchState): boolean {
  return (
    state.fromId !== null &&
    state.toId !== null &&
    state.fromId !== state.toId &&
    state.date !== null &&
    state.time !== null
  );
}

/** "Portland, OR" -> "portland-or" */
export function slugify(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function serializeSearch(
  state: SearchState,
  labels: { from?: string; to?: string } = {},
): string {
  const params = new URLSearchParams();
  const place = (id: number, label?: string) =>
    label ? `${id}-${slugify(label)}` : String(id);
  if (state.fromId !== null)
    params.set("from", place(state.fromId, labels.from));
  if (state.toId !== null) params.set("to", place(state.toId, labels.to));
  params.set("mode", state.mode);
  if (state.date) params.set("date", state.date);
  if (state.time) params.set("time", state.time);
  return params.toString();
}
