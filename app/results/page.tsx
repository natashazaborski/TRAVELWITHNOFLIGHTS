import type { Metadata } from "next";
import { Suspense } from "react";
import { ResultsFromUrl } from "@/components/results/ResultsFromUrl";

export const metadata: Metadata = {
  title: "Trip results | [APP NAME]",
};

export default function ResultsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:max-w-6xl">
      <Suspense fallback={<ResultsSkeleton />}>
        <ResultsFromUrl />
      </Suspense>
    </main>
  );
}

function ResultsSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className="bg-surface h-36 rounded-xl" />
      <div className="bg-surface h-16 rounded-xl" />
    </div>
  );
}
