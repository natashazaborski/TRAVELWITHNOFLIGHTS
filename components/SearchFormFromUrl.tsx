"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { SearchForm } from "./SearchForm";

/** Binds SearchForm to the page URL. Must render inside <Suspense>. */
export function SearchFormFromUrl() {
  const searchParams = useSearchParams();
  const router = useRouter();
  return (
    <SearchForm
      query={searchParams.toString()}
      navigate={(href) => router.push(href)}
    />
  );
}
