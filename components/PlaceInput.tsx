"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import type { PlaceResult, PlacesApiResponse } from "@/lib/places/types";

export const PLACE_SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

type Status = "idle" | "loading" | "done" | "error";

export interface PlaceInputProps {
  /** Visible label, e.g. "Departure" or "Arriving". */
  label: string;
  value: PlaceResult | null;
  onChange: (place: PlaceResult | null) => void;
  placeholder?: string;
  debounceMs?: number;
  /** Validation message shown under the field and linked to the input. */
  error?: string;
  /** Ref to the text input, e.g. to focus it after a validation error. */
  ref?: Ref<HTMLInputElement>;
}

/**
 * City search box following the WAI-ARIA combobox pattern (list autocomplete,
 * focus stays in the input, options referenced with aria-activedescendant).
 *
 * Keyboard: Down/Up move through options, Enter picks the highlighted option
 * (or the first one), Escape closes the list, and a second Escape clears it.
 */
export function PlaceInput({
  label,
  value,
  onChange,
  placeholder = "City or town",
  debounceMs = PLACE_SEARCH_DEBOUNCE_MS,
  error,
  ref,
}: PlaceInputProps) {
  const id = useId();
  const inputId = `${id}-input`;
  const listboxId = `${id}-listbox`;
  const errorId = `${id}-error`;
  const optionId = (i: number) => `${id}-option-${i}`;

  const [text, setText] = useState(value?.label ?? "");
  const [options, setOptions] = useState<PlaceResult[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [status, setStatus] = useState<Status>("idle");

  // Keep the text in sync when the parent changes `value` (e.g. a swap).
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (value) setText(value.label);
    // Cleared by the parent (e.g. swapped with an empty field): clear the
    // text too, unless the user is typing something new.
    else if (syncedValue && text === syncedValue.label) setText("");
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<AbortController | null>(null);
  const listboxRef = useRef<HTMLUListElement>(null);

  const cancelPending = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    request.current?.abort();
    request.current = null;
  }, []);

  useEffect(() => cancelPending, [cancelPending]);

  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(optionId(activeIndex))
      ?.scrollIntoView?.({ block: "nearest" });
    // optionId is derived from the stable `id`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  async function fetchPlaces(query: string) {
    const controller = new AbortController();
    request.current = controller;
    try {
      const res = await fetch(`/api/places?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PlacesApiResponse;
      if (controller.signal.aborted) return;
      setOptions(Array.isArray(data.results) ? data.results : []);
      setActiveIndex(-1);
      setStatus("done");
      setOpen(true);
    } catch {
      if (controller.signal.aborted) return;
      setOptions([]);
      setStatus("error");
      setOpen(true);
    }
  }

  function handleInput(next: string) {
    setText(next);
    if (value) onChange(null);
    cancelPending();

    if (next.trim().length < MIN_QUERY_LENGTH) {
      setOptions([]);
      setOpen(false);
      setActiveIndex(-1);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    timer.current = setTimeout(() => {
      timer.current = null;
      void fetchPlaces(next.trim());
    }, debounceMs);
  }

  function select(place: PlaceResult) {
    cancelPending();
    setText(place.label);
    setOptions([]);
    setOpen(false);
    setActiveIndex(-1);
    setStatus("idle");
    onChange(place);
  }

  function clear() {
    cancelPending();
    setText("");
    setOptions([]);
    setOpen(false);
    setActiveIndex(-1);
    setStatus("idle");
    if (value) onChange(null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const count = options.length;
    switch (e.key) {
      case "ArrowDown":
        if (count === 0) return;
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setActiveIndex(0);
        } else {
          setActiveIndex((i) => (i + 1) % count);
        }
        break;
      case "ArrowUp":
        if (count === 0) return;
        e.preventDefault();
        if (!open) setOpen(true);
        setActiveIndex((i) => (i <= 0 ? count - 1 : i - 1));
        break;
      case "Enter": {
        if (!open || count === 0) return;
        e.preventDefault();
        const place = options[activeIndex >= 0 ? activeIndex : 0];
        if (place) select(place);
        break;
      }
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
          setActiveIndex(-1);
        } else if (text) {
          e.preventDefault();
          clear();
        }
        break;
      case "Tab":
        setOpen(false);
        setActiveIndex(-1);
        break;
    }
  }

  const showList = open && (options.length > 0 || status !== "loading");
  const statusMessage =
    status === "error"
      ? "Couldn't load places. Check your connection and try again."
      : status === "done" && options.length === 0
        ? "No matching places in the USA."
        : status === "done"
          ? `${options.length} ${options.length === 1 ? "place" : "places"} found. Use up and down arrows to choose.`
          : "";

  return (
    <div className="relative">
      {/* A rounded road sign: water-blue panel with an off-white inset border
          and the label as its legend. The yellow focus ring wraps the sign. */}
      <div
        className={`bg-water focus-within:outline-lane rounded-2xl p-1.5 focus-within:outline-3 focus-within:outline-offset-2 ${
          error ? "outline-danger outline-3 outline-offset-2" : ""
        }`}
      >
        <div className="border-ink relative rounded-xl border-2 px-3 pt-2 pb-1">
          <label
            htmlFor={inputId}
            className="text-ink block text-xs font-bold tracking-[0.14em] uppercase"
          >
            {label}
          </label>
          <input
            ref={ref}
            id={inputId}
            type="text"
            role="combobox"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listboxId}
            aria-activedescendant={
              showList && activeIndex >= 0 ? optionId(activeIndex) : undefined
            }
            aria-busy={status === "loading"}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="words"
            spellCheck={false}
            enterKeyHint="search"
            placeholder={placeholder}
            value={text}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (!value && options.length > 0) setOpen(true);
            }}
            onBlur={(e) => {
              if (listboxRef.current?.contains(e.relatedTarget as Node | null))
                return;
              setOpen(false);
              setActiveIndex(-1);
            }}
            // 16px+ text stops iOS Safari from zooming in on focus.
            className="text-ink placeholder:text-sign-hint min-h-11 w-full bg-transparent pr-11 text-lg font-semibold placeholder:font-normal focus:outline-none focus-visible:outline-none"
          />
          {text && (
            <button
              type="button"
              onClick={clear}
              aria-label={`Clear ${label}`}
              className="text-ink hover:bg-ink/10 absolute top-1/2 right-1 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-2xl"
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
      </div>
      {error && (
        <p id={errorId} className="text-danger mt-2 text-sm font-semibold">
          {error}
        </p>
      )}

      <ul
        id={listboxId}
        ref={listboxRef}
        role="listbox"
        aria-label={`${label} suggestions`}
        hidden={!showList || options.length === 0}
        className="border-line bg-surface absolute z-20 mt-2 max-h-80 w-full overflow-auto rounded-xl border py-1 shadow-lg shadow-black/40"
      >
        {options.map((place, i) => (
          <li
            key={place.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === activeIndex}
            // Keep focus in the input so the click (or tap) lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => select(place)}
            className={`text-ink flex min-h-11 cursor-pointer items-center border-l-4 px-3 py-2 text-base ${
              i === activeIndex
                ? "border-lane bg-raised"
                : "hover:bg-raised border-transparent"
            }`}
          >
            {place.label}
          </li>
        ))}
      </ul>

      {showList && options.length === 0 && statusMessage && (
        <p
          className="border-line bg-surface text-ink-muted absolute z-20 mt-2 w-full rounded-xl border px-3 py-3 text-base shadow-lg shadow-black/40"
          aria-hidden="true"
        >
          {statusMessage}
        </p>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {statusMessage}
      </div>
    </div>
  );
}
