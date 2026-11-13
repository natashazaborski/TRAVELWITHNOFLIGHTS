"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
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
}: PlaceInputProps) {
  const id = useId();
  const inputId = `${id}-input`;
  const listboxId = `${id}-listbox`;
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
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
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
          // 16px text stops iOS Safari from zooming in on focus.
          className="min-h-12 w-full rounded-lg border border-gray-400 bg-white py-2 pr-12 pl-3 text-base text-gray-900 focus:border-blue-700 focus:ring-2 focus:ring-blue-700 focus:outline-none"
        />
        {text && (
          <button
            type="button"
            onClick={clear}
            aria-label={`Clear ${label}`}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-xl text-gray-600"
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>

      <ul
        id={listboxId}
        ref={listboxRef}
        role="listbox"
        aria-label={`${label} suggestions`}
        hidden={!showList || options.length === 0}
        className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-gray-300 bg-white shadow-lg"
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
            className={`flex min-h-11 cursor-pointer items-center px-3 py-2 text-base ${
              i === activeIndex ? "bg-blue-100 text-blue-950" : "text-gray-900"
            }`}
          >
            {place.label}
          </li>
        ))}
      </ul>

      {showList && options.length === 0 && statusMessage && (
        <p
          className="absolute z-10 mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-base text-gray-700 shadow-lg"
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
