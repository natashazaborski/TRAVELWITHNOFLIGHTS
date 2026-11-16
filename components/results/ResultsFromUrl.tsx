"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { ResultsView } from "./ResultsView";

/** Binds ResultsView to the page URL. Must render inside <Suspense>. */
export function ResultsFromUrl() {
  const searchParams = useSearchParams();
  const replaceQuery = useCallback((query: string) => {
    window.history.replaceState(
      null,
      "",
      query ? `?${query}` : window.location.pathname,
    );
  }, []);
  return (
    <ResultsView query={searchParams.toString()} replaceQuery={replaceQuery} />
  );
}
