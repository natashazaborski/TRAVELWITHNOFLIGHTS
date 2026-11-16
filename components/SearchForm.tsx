"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { track } from "@/lib/analytics/client";
import { searchSubmittedProps } from "@/lib/analytics/events";
import type { PlaceResult, PlacesApiResponse } from "@/lib/places/types";
import {
  parseSearch,
  serializeSearch,
  type SearchState,
} from "@/lib/routing/search-url";
import type { PlanMode } from "@/lib/routing/types";
import {
  localToInstant,
  nowInZone,
  systemTimeZone,
  zoneAbbreviation,
  zoneLongName,
} from "@/lib/time/zoned";
import { LaneDivider } from "./decor/LaneDivider";
import { PlaceInput } from "./PlaceInput";

interface FieldErrors {
  from?: string;
  to?: string;
  when?: string;
}

export interface SearchFormProps {
  /** Current URL query string (without "?"), used to prefill the form. */
  query: string;
  /** Navigates to a URL, e.g. "/results?from=…". */
  navigate: (href: string) => void;
}

/**
 * The search form. A query string in the URL (from "Edit search" on the
 * results page, or a shared link) prefills it. Submitting goes to
 * /results with the full search in the URL.
 */
export function SearchForm({ query, navigate }: SearchFormProps) {
  const [from, setFrom] = useState<PlaceResult | null>(null);
  const [to, setTo] = useState<PlaceResult | null>(null);
  const [mode, setMode] = useState<PlanMode>("leaveAt");
  // null = follow "now" in the relevant city's timezone until edited.
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const [chosenTime, setChosenTime] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  const ids = useId();
  const helpId = `${ids}-help`;
  const whenErrorId = `${ids}-when-error`;

  // "Leave at" is in the departure city's zone, "Arrive by" in the arrival
  // city's (CLAUDE.md rule 4). Before a city is chosen, use the device's.
  const referencePlace = mode === "leaveAt" ? from : to;
  const referenceZone = referencePlace?.timezone ?? systemTimeZone();
  const now = nowInZone(referenceZone, nowMs);
  const date = chosenDate ?? now.date;
  const time = chosenTime ?? now.time;

  // Refresh "now" when the user comes back to the tab.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setNowMs(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Prefill from the URL: mode, date, and time right away (adjusting state
  // during render when the query changes), places once they are looked up.
  const [appliedQuery, setAppliedQuery] = useState<string | null>(null);
  if (query !== appliedQuery) {
    setAppliedQuery(query);
    const state = parseSearch(new URLSearchParams(query));
    if (query.includes("mode=")) {
      setMode(state.mode);
      setChosenDate(state.date);
      setChosenTime(state.time);
    }
  }
  useEffect(() => {
    const state = parseSearch(new URLSearchParams(query));
    if (state.fromId === null && state.toId === null) return;
    let cancelled = false;
    placesById([state.fromId, state.toId]).then((found) => {
      if (cancelled) return;
      setFrom(found.find((p) => p.id === state.fromId) ?? null);
      setTo(found.find((p) => p.id === state.toId) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!from) e.from = "Choose a departure city from the suggestions.";
    if (!to) e.to = "Choose an arrival city from the suggestions.";
    if (from && to && from.id === to.id) {
      e.to = "Arriving must be a different place from Departure.";
    }
    if (!date || !time) e.when = "Choose a date and time.";
    return e;
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const e = validate();
    setErrors(e);
    if (e.from) return fromRef.current?.focus();
    if (e.to) return toRef.current?.focus();
    if (e.when) return dateRef.current?.focus();

    const state: SearchState = {
      fromId: from!.id,
      toId: to!.id,
      mode,
      date,
      time,
    };
    track(
      "search_submitted",
      searchSubmittedProps(
        from!,
        to!,
        mode,
        localToInstant(`${date}T${time}`, referenceZone),
        Date.now(),
      ),
    );
    setSubmitting(true);
    navigate(
      `/results?${serializeSearch(state, { from: from!.label, to: to!.label })}`,
    );
  }

  function swap() {
    setFrom(to);
    setTo(from);
    setErrors({});
  }

  const inputClass =
    "min-h-12 w-full rounded-lg border border-line bg-raised px-3 text-base text-ink";

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div className="relative space-y-3">
        <PlaceInput
          ref={fromRef}
          label="Departure"
          value={from}
          onChange={(p) => {
            setFrom(p);
            setErrors((e) => ({ ...e, from: undefined }));
          }}
          error={errors.from}
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={swap}
            aria-label="Swap departure and arrival"
            className="border-line bg-raised text-lane hover:border-lane -my-3 flex size-12 items-center justify-center rounded-full border-2"
          >
            <svg
              aria-hidden="true"
              focusable="false"
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 4v15M4.5 7.5 8 4l3.5 3.5M16 20V5m3.5 11.5L16 20l-3.5-3.5" />
            </svg>
          </button>
        </div>
        <PlaceInput
          ref={toRef}
          label="Arriving"
          value={to}
          onChange={(p) => {
            setTo(p);
            setErrors((e) => ({ ...e, to: undefined }));
          }}
          error={errors.to}
        />
      </div>

      <LaneDivider />

      <fieldset>
        <legend className="sr-only">Leave at or arrive by</legend>
        <div className="border-line bg-raised grid grid-cols-2 gap-1 rounded-xl border p-1">
          {(
            [
              ["leaveAt", "Leave at"],
              ["arriveBy", "Arrive by"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className="text-ink has-checked:bg-lane has-checked:text-asphalt has-focus-visible:outline-lane flex min-h-12 cursor-pointer items-center justify-center rounded-lg text-base font-bold has-focus-visible:outline-3 has-focus-visible:outline-offset-2"
            >
              <input
                type="radio"
                name="mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                aria-describedby={helpId}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor={`${ids}-date`}
            className="text-ink mb-1 block text-sm font-bold"
          >
            Date
          </label>
          <input
            ref={dateRef}
            id={`${ids}-date`}
            type="date"
            required
            value={date}
            onChange={(e) => {
              setChosenDate(e.target.value);
              setChosenTime(time);
              setErrors((x) => ({ ...x, when: undefined }));
            }}
            aria-invalid={errors.when ? true : undefined}
            aria-describedby={errors.when ? `${whenErrorId} ${helpId}` : helpId}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor={`${ids}-time`}
            className="text-ink mb-1 block text-sm font-bold"
          >
            Time
          </label>
          <input
            id={`${ids}-time`}
            type="time"
            required
            value={time}
            onChange={(e) => {
              setChosenTime(e.target.value);
              setChosenDate(date);
              setErrors((x) => ({ ...x, when: undefined }));
            }}
            aria-invalid={errors.when ? true : undefined}
            aria-describedby={errors.when ? `${whenErrorId} ${helpId}` : helpId}
            className={inputClass}
          />
        </div>
      </div>
      {errors.when && (
        <p id={whenErrorId} className="text-danger -mt-2 text-sm font-semibold">
          {errors.when}
        </p>
      )}
      <p id={helpId} className="text-ink-muted -mt-2 text-sm">
        {zoneHelpText(mode, referencePlace, date, time)}
      </p>

      <button
        type="submit"
        disabled={submitting}
        className="bg-lane text-asphalt hover:bg-lane-bright min-h-14 w-full rounded-xl px-4 text-lg font-extrabold tracking-wide uppercase disabled:cursor-wait disabled:opacity-70"
      >
        Search
      </button>
    </form>
  );
}

/** Helper text naming the zone the chosen time is in (rule 4). */
export function zoneHelpText(
  mode: PlanMode,
  place: PlaceResult | null,
  date: string,
  time: string,
): string {
  const base =
    mode === "arriveBy"
      ? "Time is in the arrival city's timezone."
      : "Time is in the departure city's timezone.";
  if (!place) return base;
  let instant = Date.now();
  try {
    instant = localToInstant(`${date}T${time}`, place.timezone);
  } catch {
    // Incomplete date or time: describe the zone as of now.
  }
  return `${base} ${place.label} is on ${zoneLongName(instant, place.timezone)} (${zoneAbbreviation(instant, place.timezone)}).`;
}

async function placesById(ids: (number | null)[]): Promise<PlaceResult[]> {
  const wanted = ids.filter((id): id is number => id !== null);
  if (wanted.length === 0) return [];
  try {
    const res = await fetch(`/api/places?id=${wanted.join(",")}`);
    return res.ok ? ((await res.json()) as PlacesApiResponse).results : [];
  } catch {
    return [];
  }
}
