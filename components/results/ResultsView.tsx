"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { analyticsHeaders, track } from "@/lib/analytics/client";
import { itineraryExpandedProps } from "@/lib/analytics/events";
import type { PlaceResult, PlacesApiResponse } from "@/lib/places/types";
import {
  latestOnTimeDeparture,
  parseSortKey,
  sortForDisplay,
  SORT_OPTIONS,
  spareMinutes,
  type SortKey,
} from "@/lib/routing/present";
import type { PlanApiError } from "@/lib/routing/request-schema";
import { isCompleteSearch, parseSearch } from "@/lib/routing/search-url";
import type { Itinerary, PlanResult } from "@/lib/routing/types";
import {
  formatLocalDate,
  formatLocalTime,
  localToInstant,
} from "@/lib/time/zoned";
import { Sep } from "@/components/ui/Sep";
import { ItineraryCard } from "./ItineraryCard";
import { RouteMap } from "./RouteMap";

export const LOADING_MESSAGE =
  "Searching trains, buses, and ferries nationwide. This can take several seconds.";

type Status =
  | { kind: "loading" }
  | { kind: "done"; result: PlanResult }
  | { kind: "busy"; message: string }
  | { kind: "rateLimited"; message: string; retryAfterSeconds: number }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string };

export interface ResultsViewProps {
  /** Current URL query string (without "?"). */
  query: string;
  /** Replaces the query string without a new history entry (sort changes). */
  replaceQuery: (query: string) => void;
}

export function ResultsView({ query, replaceQuery }: ResultsViewProps) {
  const params = useMemo(() => new URLSearchParams(query), [query]);
  const search = useMemo(() => parseSearch(params), [params]);
  const sort = parseSortKey(params.get("sort"));
  const complete = isCompleteSearch(search);
  // Identity of the search itself; a sort change must not refetch.
  const searchKey = complete
    ? `${search.fromId}|${search.toId}|${search.mode}|${search.date}|${search.time}`
    : "";

  const [places, setPlaces] = useState<{
    from: PlaceResult | null;
    to: PlaceResult | null;
  }>({ from: null, to: null });
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A new search (or a retry) starts from a clean loading state. Adjusted
  // during render rather than in the effect, per React's guidance.
  const fetchKey = `${searchKey}#${attempt}`;
  const [startedKey, setStartedKey] = useState(fetchKey);
  if (fetchKey !== startedKey) {
    setStartedKey(fetchKey);
    setStatus({ kind: "loading" });
    setExpanded(new Set());
    setSelectedId(null);
  }

  useEffect(() => {
    if (!searchKey) return;
    const controller = new AbortController();
    const { signal } = controller;

    fetch(`/api/places?id=${search.fromId},${search.toId}`, { signal })
      .then((r) => (r.ok ? (r.json() as Promise<PlacesApiResponse>) : null))
      .then((body) => {
        if (!body) return;
        setPlaces({
          from: body.results.find((p) => p.id === search.fromId) ?? null,
          to: body.results.find((p) => p.id === search.toId) ?? null,
        });
      })
      .catch(() => {});

    fetch("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json", ...analyticsHeaders() },
      body: JSON.stringify({
        from: { id: search.fromId },
        to: { id: search.toId },
        dateTime: `${search.date}T${search.time}`,
        mode: search.mode,
      }),
      signal,
    })
      .then(async (res) => {
        const body = (await res.json()) as PlanResult | PlanApiError;
        if (signal.aborted) return;
        setStatus(statusFrom(res.status, body));
      })
      .catch(() => {
        if (signal.aborted) return;
        setStatus({
          kind: "error",
          message: "Couldn't connect. Check your connection and try again.",
        });
      });
    return () => controller.abort();
    // searchKey captures every search field used above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, attempt]);

  const editHref = `/?${withoutSort(params)}`;

  if (!complete) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-extrabold">
          This search link is incomplete
        </h1>
        <p className="text-ink-muted">
          It needs a departure, an arrival, a date, and a time.
        </p>
        <Link
          href={editHref}
          className="bg-lane text-asphalt hover:bg-lane-bright inline-flex min-h-12 items-center rounded-xl px-5 text-lg font-extrabold"
        >
          Start a search
        </Link>
      </div>
    );
  }

  const referencePlace = search.mode === "leaveAt" ? places.from : places.to;
  const deadline =
    search.mode === "arriveBy" && places.to
      ? localToInstant(`${search.date}T${search.time}`, places.to.timezone)
      : null;

  return (
    <div className="space-y-5">
      <SummaryBar
        from={places.from}
        to={places.to}
        search={search}
        referenceZone={referencePlace?.timezone ?? null}
        optionCount={
          status.kind === "done" ? status.result.itineraries.length : null
        }
        editHref={editHref}
      />

      <div role="status" aria-live="polite">
        {status.kind === "loading" && (
          <p className="bg-surface text-ink flex items-start gap-3 rounded-xl p-4">
            <span
              aria-hidden="true"
              className="border-lane mt-0.5 size-5 shrink-0 rounded-full border-[3px] border-t-transparent motion-safe:animate-spin"
            />
            {LOADING_MESSAGE}
          </p>
        )}
        {status.kind === "done" && (
          <p className="sr-only">
            {status.result.itineraries.length === 0
              ? "No routes found."
              : `${status.result.itineraries.length} options found.`}
          </p>
        )}
      </div>

      {status.kind === "busy" && (
        <Problem
          title="Lots of people are searching right now"
          body="Please try again in a minute. Your search is saved in this page's link."
          action={<RetryButton onClick={() => setAttempt((a) => a + 1)} />}
        />
      )}
      {status.kind === "rateLimited" && (
        <Problem
          title="Too many searches"
          body={`${status.message} You can search again in about ${status.retryAfterSeconds} seconds.`}
          action={<RetryButton onClick={() => setAttempt((a) => a + 1)} />}
        />
      )}
      {status.kind === "error" && (
        <Problem
          title="Something went wrong"
          body={status.message}
          action={<RetryButton onClick={() => setAttempt((a) => a + 1)} />}
        />
      )}
      {status.kind === "invalid" && (
        <Problem
          title="We can't run this search"
          body={status.message}
          action={<EditLink href={editHref} />}
        />
      )}

      {status.kind === "done" && (
        <Results
          result={status.result}
          sort={sort}
          onSort={(key) => {
            const next = new URLSearchParams(params);
            if (key === "arrival") next.delete("sort");
            else next.set("sort", key);
            replaceQuery(next.toString());
          }}
          deadline={deadline}
          expanded={expanded}
          onToggle={(id, it, rank) => {
            if (!expanded.has(id)) {
              track("itinerary_expanded", itineraryExpandedProps(it, rank));
            }
            setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
            setSelectedId(id);
          }}
          selectedId={selectedId}
          editHref={editHref}
        />
      )}
    </div>
  );
}

function statusFrom(
  httpStatus: number,
  body: PlanResult | PlanApiError,
): Status {
  if (httpStatus === 200 && "itineraries" in body)
    return { kind: "done", result: body };
  const message = "message" in body ? body.message : "";
  if (body.status === "busy") {
    return {
      kind: "busy",
      message: message || "Please try again in a minute.",
    };
  }
  if (body.status === "rateLimited") {
    return {
      kind: "rateLimited",
      message,
      retryAfterSeconds:
        "retryAfterSeconds" in body ? body.retryAfterSeconds : 60,
    };
  }
  if (body.status === "invalid") return { kind: "invalid", message };
  return {
    kind: "error",
    message:
      message || "We couldn't reach the timetable service. Please try again.",
  };
}

function withoutSort(params: URLSearchParams): string {
  const p = new URLSearchParams(params);
  p.delete("sort");
  return p.toString();
}

function SummaryBar({
  from,
  to,
  search,
  referenceZone,
  optionCount,
  editHref,
}: {
  from: PlaceResult | null;
  to: PlaceResult | null;
  search: ReturnType<typeof parseSearch>;
  referenceZone: string | null;
  optionCount: number | null;
  editHref: string;
}) {
  const modeLabel = search.mode === "arriveBy" ? "Arrive by" : "Leave at";
  let when = `${search.date} ${search.time}`;
  if (referenceZone) {
    const instant = localToInstant(
      `${search.date}T${search.time}`,
      referenceZone,
    );
    when = `${formatLocalTime(instant, referenceZone)}, ${formatLocalDate(instant, referenceZone)}`;
  }
  return (
    <header className="bg-surface space-y-3 rounded-xl p-4">
      <h1 className="text-2xl leading-tight font-extrabold">
        {from?.label ?? "…"} <span aria-hidden="true">→</span>
        <span className="sr-only"> to </span> {to?.label ?? "…"}
      </h1>
      <p className="text-ink-muted">
        {modeLabel} {when}
        {optionCount !== null && (
          <>
            <Sep />
            {optionCount} {optionCount === 1 ? "option" : "options"}
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <EditLink href={editHref} />
        <ShareButton />
      </div>
    </header>
  );
}

function EditLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="border-line bg-raised text-ink hover:border-ink inline-flex min-h-11 items-center rounded-lg border px-4 font-bold"
    >
      Edit search
    </Link>
  );
}

export function ShareButton() {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [url, setUrl] = useState("");
  async function copy() {
    track("share_clicked", {});
    const href = window.location.href;
    setUrl(href);
    try {
      await navigator.clipboard.writeText(href);
      setState("copied");
    } catch {
      setState("failed");
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={copy}
        className="border-line bg-raised text-ink hover:border-ink inline-flex min-h-11 items-center rounded-lg border px-4 font-bold"
      >
        Share
      </button>
      <span
        role="status"
        aria-live="polite"
        className="text-ink w-full text-sm"
      >
        {state === "copied" && "Link copied. Anyone with it sees this search."}
      </span>
      {state === "failed" && (
        <label className="text-ink block w-full text-sm">
          Copy this link:
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="border-line bg-raised text-ink mt-1 block min-h-11 w-full rounded-lg border px-2 text-base"
          />
        </label>
      )}
    </>
  );
}

function Problem({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="border-lane bg-surface space-y-3 rounded-xl border-l-4 p-4">
      <h2 className="text-lg font-extrabold">{title}</h2>
      <p className="text-ink-muted">{body}</p>
      {action}
    </div>
  );
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-lane text-asphalt hover:bg-lane-bright min-h-11 rounded-lg px-4 font-extrabold"
    >
      Try again
    </button>
  );
}

function Results({
  result,
  sort,
  onSort,
  deadline,
  expanded,
  onToggle,
  selectedId,
  editHref,
}: {
  result: PlanResult;
  sort: SortKey;
  onSort: (key: SortKey) => void;
  deadline: number | null;
  expanded: Set<string>;
  onToggle: (id: string, itinerary: Itinerary, rank: number) => void;
  selectedId: string | null;
  editHref: string;
}) {
  const sortId = useId();
  const sorted = useMemo(
    () => sortForDisplay(result.itineraries, sort),
    [result.itineraries, sort],
  );
  const latest =
    deadline !== null ? latestOnTimeDeparture(sorted, deadline) : null;
  const selected: Itinerary | undefined =
    sorted.find((it) => it.id === selectedId) ?? sorted[0];

  return (
    <div className="space-y-4">
      {result.notes.map((note) => (
        <p
          key={`${note.kind}-${note.end}`}
          className="bg-water text-ink rounded-xl p-3"
        >
          {note.message}
        </p>
      ))}

      {sorted.length === 0 ? (
        <div className="bg-surface space-y-3 rounded-xl p-4">
          <h2 className="text-lg font-extrabold">No routes found</h2>
          <p className="text-ink-muted">
            No published timetable connects these places at that time. Try
            another time or day, or a larger city nearby.
          </p>
          <EditLink href={editHref} />
        </div>
      ) : (
        // Phones and tablets: one column, map (collapsed on phones) above the
        // list. Desktop: list on the left, map pinned on the right.
        <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-start lg:gap-6 lg:space-y-0">
          {selected && (
            <div className="lg:sticky lg:top-4 lg:order-2">
              <RouteMap
                itinerary={selected}
                caption={`option ${sorted.indexOf(selected) + 1} of ${sorted.length}`}
              />
            </div>
          )}

          <div className="space-y-4 lg:order-1">
            <div className="flex items-center gap-3">
              <label htmlFor={sortId} className="text-ink font-bold">
                Sort by
              </label>
              <select
                id={sortId}
                value={sort}
                onChange={(e) => onSort(e.target.value as SortKey)}
                className="border-line bg-raised text-ink min-h-11 flex-1 rounded-lg border px-3 text-base"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <ol className="space-y-3">
              {sorted.map((it, i) => (
                <li key={it.id} aria-label={`Option ${i + 1}`}>
                  <ItineraryCard
                    itinerary={it}
                    expanded={expanded.has(it.id)}
                    onToggle={() => onToggle(it.id, it, i + 1)}
                    onBook={(operator) =>
                      track("booking_clicked", { operator, rank: i + 1 })
                    }
                    spareMinutes={
                      deadline !== null ? spareMinutes(it, deadline) : undefined
                    }
                    latestOnTime={latest?.id === it.id}
                  />
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
