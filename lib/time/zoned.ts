/**
 * Timezone arithmetic using only the built-in Intl API (no tz database
 * dependency). All instants are epoch milliseconds; all zones are IANA ids.
 */

/** "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss", no offset. */
export const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

/** True if `timeZone` is an IANA zone this runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of `instant` in `timeZone`. */
export function toLocalParts(instant: number, timeZone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(instant))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
export function offsetAt(instant: number, timeZone: string): number {
  const p = toLocalParts(instant, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

export function parseLocalDateTime(local: string): LocalParts {
  const m = LOCAL_DATE_TIME_PATTERN.exec(local);
  if (!m) throw new Error(`Not a local date-time: ${local}`);
  const [, y, mo, d, h, mi, s] = m;
  return {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(s ?? 0),
  };
}

/**
 * Converts a wall-clock time in `timeZone` to an instant.
 *
 * DST edge cases: a time skipped by spring-forward (e.g. 02:30 on the change
 * day) resolves to the same distance past the gap (03:30). A repeated time in
 * fall-back resolves to its first occurrence.
 */
export function localToInstant(local: string, timeZone: string): number {
  const p = parseLocalDateTime(local);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Try both offsets around the wall time; prefer the earliest that matches.
  const candidates = [
    wall - offsetAt(wall - 864e5 / 2, timeZone),
    wall - offsetAt(wall + 864e5 / 2, timeZone),
  ].sort((a, b) => a - b);
  for (const t of candidates) {
    if (wall - offsetAt(t, timeZone) === t) return t;
  }
  // Nonexistent local time (spring-forward gap): use the pre-gap offset,
  // which lands the same distance after the gap.
  return wall - offsetAt(wall - 864e5 / 2, timeZone);
}

/** "YYYY-MM-DD" calendar date of `instant` in `timeZone`. */
export function localDate(instant: number, timeZone: string): string {
  const p = toLocalParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Whole calendar days between the local date of `from` (in `fromZone`) and
 * the local date of `to` (in `toZone`). Drives "+1 day" labels.
 */
export function calendarDaysBetween(
  from: number,
  fromZone: string,
  to: number,
  toZone: string,
): number {
  const a = Date.parse(`${localDate(from, fromZone)}T00:00:00Z`);
  const b = Date.parse(`${localDate(to, toZone)}T00:00:00Z`);
  return Math.round((b - a) / 864e5);
}

/** "+1 day", "+2 days", or "" for the same day. */
export function dayOffsetLabel(days: number): string {
  if (days <= 0) return "";
  return days === 1 ? "+1 day" : `+${days} days`;
}

const abbrFormatters = new Map<string, Intl.DateTimeFormat>();

/** Short zone name at `instant`, e.g. "PST", "EDT", "AKST", "HST". */
export function zoneAbbreviation(instant: number, timeZone: string): string {
  let f = abbrFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" });
    abbrFormatters.set(timeZone, f);
  }
  return (
    f.formatToParts(new Date(instant)).find((p) => p.type === "timeZoneName")
      ?.value ?? timeZone
  );
}

/** "9:05 AM PST": time of day at the place where it happens. */
export function formatLocalTime(instant: number, timeZone: string): string {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instant));
  return `${time} ${zoneAbbreviation(instant, timeZone)}`;
}

/** "Tue, Nov 17": the calendar date of `instant` where it happens. */
export function formatLocalDate(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(instant));
}

/** Generic zone name, e.g. "Pacific Time", "Mountain Time", "Hawaii-Aleutian Time". */
export function zoneLongName(instant: number, timeZone: string): string {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longGeneric",
  })
    .formatToParts(new Date(instant))
    .find((p) => p.type === "timeZoneName")?.value;
  return name ?? timeZone;
}

/** Current date ("YYYY-MM-DD") and time ("HH:MM") in `timeZone`. */
export function nowInZone(
  timeZone: string,
  now: number = Date.now(),
): { date: string; time: string } {
  const p = toLocalParts(now, timeZone);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

/** The browser's or server's own IANA zone. */
export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
