"use client";

// Loaded with next/dynamic only when the map is opened, so MapLibre (~1 MB)
// and its CSS never download for people who don't use the map.
import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { Itinerary } from "@/lib/routing/types";
import { palette } from "@/lib/theme/palette";
import {
  boundsOf,
  itineraryGeoJson,
  loadStyleWithoutAirports,
} from "./map-data";

/** Copied from node_modules by scripts/copy-maplibre-worker.mjs. */
const WORKER_URL = "/maplibre-gl-worker.mjs";

type SettableSource = { setData(data: unknown): void };

/** Swaps the drawn trip and refits the view. */
function showItinerary(m: MapLibreMap, itinerary: Itinerary) {
  const data = itineraryGeoJson(itinerary);
  (m.getSource("legs") as unknown as SettableSource | undefined)?.setData(
    data.lines,
  );
  (m.getSource("stops") as unknown as SettableSource | undefined)?.setData(
    data.stops,
  );
  m.fitBounds(boundsOf(itinerary), { padding: 32 });
}

export default function RouteMapCanvas({
  itinerary,
}: {
  itinerary: Itinerary;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  // True once our sources and layers exist. (isStyleLoaded() also turns
  // false while tiles load, which would skip updates.)
  const ready = useRef(false);
  const [failed, setFailed] = useState(false);
  const latest = useRef(itinerary);
  useEffect(() => {
    latest.current = itinerary;
  }, [itinerary]);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    setWorkerUrl(WORKER_URL);
    loadStyleWithoutAirports()
      .then((style) => {
        if (cancelled || !container.current) return;
        const m = new MapLibreMap({
          container: container.current,
          style,
          bounds: boundsOf(latest.current),
          fitBoundsOptions: { padding: 32 },
          cooperativeGestures: true,
          attributionControl: { compact: true },
        });
        map.current = m;
        m.on("load", () => {
          // MapLibre's CSS arrives with this lazily loaded chunk, so the map
          // may have measured its container before styles applied. Re-measure
          // and fit the whole trip again.
          m.resize();
          m.fitBounds(boundsOf(latest.current), {
            padding: 32,
            animate: false,
          });
          // Compact attribution starts expanded and covers the route; collapse
          // it to its (i) button. The credits stay one tap away.
          container.current
            ?.querySelector(".maplibregl-ctrl-attrib")
            ?.classList.remove("maplibregl-compact-show");
          // latest.current is the trip selected now, even if it changed
          // while the map was loading.
          const data = itineraryGeoJson(latest.current);
          m.addSource("legs", { type: "geojson", data: data.lines });
          m.addSource("stops", { type: "geojson", data: data.stops });
          // Widths echo the route line: buses as the widest "road", local
          // transit thinnest, walking as dots.
          const width: unknown = [
            "match",
            ["get", "mode"],
            "bus",
            6,
            "train",
            5,
            "ferry",
            5,
            "local",
            3,
            4,
          ];
          m.addLayer({
            id: "legs-casing",
            type: "line",
            source: "legs",
            filter: ["!=", ["get", "mode"], "walk"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": palette.asphalt,
              "line-width": ["+", width, 4] as never,
            },
          });
          m.addLayer({
            id: "legs-line",
            type: "line",
            source: "legs",
            filter: ["!=", ["get", "mode"], "walk"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": ["get", "color"],
              "line-width": width as never,
            },
          });
          m.addLayer({
            id: "legs-walk",
            type: "line",
            source: "legs",
            filter: ["==", ["get", "mode"], "walk"],
            layout: { "line-cap": "round" },
            paint: {
              "line-color": ["get", "color"],
              "line-width": 4,
              "line-dasharray": [0, 2],
            },
          });
          m.addLayer({
            id: "stops",
            type: "circle",
            source: "stops",
            paint: {
              "circle-radius": 5,
              "circle-color": palette.asphalt,
              "circle-stroke-color": palette.lane,
              "circle-stroke-width": 2.5,
            },
          });
          ready.current = true;
        });
        m.on("error", () => setFailed(true));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      ready.current = false;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Show another itinerary without recreating the map.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    showItinerary(m, itinerary);
  }, [itinerary]);

  if (failed) {
    return (
      <p className="bg-surface text-ink-muted rounded-xl p-4">
        The map couldn&apos;t load. The trip details below are unaffected.
      </p>
    );
  }
  return (
    <div
      ref={container}
      className="border-line h-72 w-full overflow-hidden rounded-xl border md:h-96 lg:h-[32rem]"
      role="region"
      aria-label="Map of the selected trip"
    />
  );
}
