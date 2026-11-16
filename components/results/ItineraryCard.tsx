"use client";

import { useId } from "react";
import { ModeIcon } from "@/components/icons/ModeIcon";
import { RouteLine } from "@/components/route/RouteLine";
import { Sep } from "@/components/ui/Sep";
import {
  bookingLegIndexes,
  formatDuration,
  formatFeedDate,
  formatTransfers,
  MODE_LABEL,
  routeSegments,
  schedulesAsOf,
  transferDetails,
  type TransferInfo,
} from "@/lib/routing/present";
import type { Itinerary, Leg } from "@/lib/routing/types";
import {
  calendarDaysBetween,
  dayOffsetLabel,
  formatLocalTime,
} from "@/lib/time/zoned";

interface TripStart {
  instant: number;
  zone: string;
}

/** Time where it happens, plus "+N day(s)" relative to the trip's start. */
export function StopTime({
  iso,
  zone,
  tripStart,
}: {
  iso: string;
  zone: string;
  tripStart: TripStart;
}) {
  const instant = Date.parse(iso);
  const offset = dayOffsetLabel(
    calendarDaysBetween(tripStart.instant, tripStart.zone, instant, zone),
  );
  return (
    <span className="whitespace-nowrap">
      {formatLocalTime(instant, zone)}
      {offset && (
        <span className="bg-raised text-lane ml-1.5 rounded px-1.5 py-0.5 align-middle text-sm font-bold">
          {offset}
        </span>
      )}
    </span>
  );
}

/** The card's route line: one segment per leg, sized by leg duration. */
export function ItineraryRouteLine({ itinerary }: { itinerary: Itinerary }) {
  const segments = routeSegments(itinerary);
  return (
    <div>
      <RouteLine
        segments={segments.map((s) => ({ mode: s.mode, weight: s.minutes }))}
        thickness={14}
      />
      <p className="sr-only">
        {segments
          .map((s) => `${MODE_LABEL[s.mode]} ${formatDuration(s.minutes)}`)
          .join(", then ")}
      </p>
    </div>
  );
}

/** Left rail of a timeline row: the leg drawn vertically, with its icon. */
function Rail({ leg }: { leg: Leg }) {
  return (
    <div className="flex w-8 shrink-0 flex-col items-center gap-1 pt-0.5">
      <ModeIcon
        mode={leg.mode}
        className={`size-6 ${leg.mode === "ferry" ? "text-water-light" : leg.mode === "bus" ? "text-lane" : "text-ink"}`}
      />
      <div className="min-h-6 flex-1">
        <RouteLine
          segments={[{ mode: leg.mode, weight: 1 }]}
          orientation="vertical"
          thickness={leg.mode === "local" || leg.mode === "walk" ? 10 : 12}
        />
      </div>
    </div>
  );
}

function TransferRow({ t }: { t: TransferInfo }) {
  const walk =
    t.walkMinutes > 0
      ? `, including a ${formatDuration(t.walkMinutes)} walk`
      : "";
  return (
    <li className="border-line text-ink-muted ml-11 border-l-2 border-dashed py-2 pl-4">
      <p>
        Change at {t.stopName}: {formatDuration(t.waitMinutes)}
        {walk}
      </p>
      {t.tight && (
        <p className="border-lane bg-raised text-lane mt-2 rounded-lg border-l-4 px-3 py-2 font-bold">
          Tight connection: {formatDuration(t.waitMinutes)} to change from{" "}
          {t.fromOperator} to {t.toOperator}. They won&apos;t wait for each
          other.
        </p>
      )}
    </li>
  );
}

function LegRow({
  leg,
  tripStart,
  showBooking,
  onBook,
}: {
  leg: Leg;
  tripStart: TripStart;
  showBooking: boolean;
  onBook?: (operator: string) => void;
}) {
  const minutes = (Date.parse(leg.end) - Date.parse(leg.start)) / 60_000;
  if (leg.mode === "walk") {
    return (
      <li className="flex gap-3 py-1">
        <Rail leg={leg} />
        <p className="text-ink-muted py-1">
          Walk {formatDuration(minutes)} to {leg.toStop.name}
        </p>
      </li>
    );
  }
  return (
    <li className="flex gap-3 py-1" data-mode={leg.mode}>
      <Rail leg={leg} />
      <div className="min-w-0 flex-1 pb-2">
        <p className="text-ink font-bold">
          {MODE_LABEL[leg.mode]}
          <Sep />
          {leg.operator}
          {leg.routeName && (
            <span className="text-ink-muted font-normal">
              <Sep />
              {leg.routeName}
            </span>
          )}
        </p>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-ink-muted">Board</dt>
          <dd>
            <StopTime
              iso={leg.start}
              zone={leg.timezoneStart}
              tripStart={tripStart}
            />
            <Sep />
            {leg.fromStop.name}
          </dd>
          <dt className="text-ink-muted">Get off</dt>
          <dd>
            <StopTime
              iso={leg.end}
              zone={leg.timezoneEnd}
              tripStart={tripStart}
            />
            <Sep />
            {leg.toStop.name}
          </dd>
        </dl>
        {showBooking && leg.bookingUrl && (
          <a
            href={leg.bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => leg.operator && onBook?.(leg.operator)}
            className="bg-water text-ink hover:outline-ink mt-3 inline-flex min-h-11 items-center rounded-lg px-4 font-bold hover:outline-2"
          >
            Book with {leg.operator}
            <span className="sr-only">
              {" "}
              (opens the operator&apos;s site in a new tab)
            </span>
          </a>
        )}
      </div>
    </li>
  );
}

export interface ItineraryCardProps {
  itinerary: Itinerary;
  expanded: boolean;
  onToggle: () => void;
  /** Arrive-by only: minutes to spare before the deadline. */
  spareMinutes?: number;
  /** Arrive-by only: this is the latest departure that arrives on time. */
  latestOnTime?: boolean;
  /** Called when a "Book with …" link is followed. */
  onBook?: (operator: string) => void;
}

export function ItineraryCard({
  itinerary,
  expanded,
  onToggle,
  spareMinutes,
  latestOnTime = false,
  onBook,
}: ItineraryCardProps) {
  const id = useId();
  const legs = itinerary.legs;
  const first = legs[0]!;
  const last = legs[legs.length - 1]!;
  const tripStart = {
    instant: Date.parse(itinerary.departure),
    zone: first.timezoneStart,
  };
  const transfers = transferDetails(itinerary);
  const booking = bookingLegIndexes(legs);
  const asOf = schedulesAsOf(itinerary);
  const tight = itinerary.flags.includes("tightConnection");

  // Interleave legs with the transfer that follows each transit leg.
  const rows: React.ReactNode[] = [];
  legs.forEach((leg, i) => {
    rows.push(
      <LegRow
        key={`leg-${i}`}
        leg={leg}
        tripStart={tripStart}
        showBooking={booking.has(i)}
        onBook={onBook}
      />,
    );
    const t = transfers.find((x) => x.afterLeg === i);
    if (t) rows.push(<TransferRow key={`transfer-${i}`} t={t} />);
  });

  return (
    <article
      className={`bg-surface overflow-hidden rounded-xl border-2 ${
        latestOnTime ? "border-go" : "border-transparent"
      }`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`${id}-details`}
        onClick={onToggle}
        className="w-full space-y-3 p-4 text-left focus-visible:-outline-offset-4"
      >
        {latestOnTime && (
          <p className="bg-go-deep text-ink inline-block rounded px-2 py-0.5 text-sm font-bold">
            Latest departure that arrives on time
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-ink-muted text-xs font-bold tracking-[0.14em] uppercase">
              Depart
            </p>
            <p className="text-ink text-xl font-extrabold">
              <StopTime
                iso={itinerary.departure}
                zone={first.timezoneStart}
                tripStart={tripStart}
              />
            </p>
            <p className="text-ink-muted">{first.fromStop.name}</p>
          </div>
          <div>
            <p className="text-ink-muted text-xs font-bold tracking-[0.14em] uppercase">
              Arrive
            </p>
            <p className="text-ink text-xl font-extrabold">
              <StopTime
                iso={itinerary.arrival}
                zone={last.timezoneEnd}
                tripStart={tripStart}
              />
            </p>
            <p className="text-ink-muted">{last.toStop.name}</p>
          </div>
        </div>
        <p className="text-ink">
          {formatDuration(itinerary.durationMinutes)}
          <Sep />
          {formatTransfers(itinerary.transfers)}
          {tight && (
            <span className="text-lane font-bold">
              <Sep />
              Tight connection
            </span>
          )}
        </p>
        {spareMinutes !== undefined && (
          <p className="text-go font-semibold">
            {spareMinutes <= 0
              ? "Arrives right at your deadline"
              : `${formatDuration(spareMinutes)} to spare before your deadline`}
          </p>
        )}
        <ItineraryRouteLine itinerary={itinerary} />
        <p className="text-lane text-sm font-bold">
          {expanded ? "Hide details" : "Show details"}
        </p>
      </button>

      <div
        id={`${id}-details`}
        hidden={!expanded}
        className="border-line/50 border-t p-4"
      >
        <ol className="space-y-1">{rows}</ol>
        <p className="bg-raised text-ink-muted mt-4 rounded-lg p-3 text-sm">
          Schedules as of {asOf ? formatFeedDate(asOf) : "an unknown date"}.
          Seats are not guaranteed. Confirm with the operator before travelling.
        </p>
      </div>
    </article>
  );
}
