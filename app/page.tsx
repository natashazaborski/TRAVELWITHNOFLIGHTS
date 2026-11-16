import { Suspense } from "react";
import { RouteLine } from "@/components/route/RouteLine";
import { SearchFormFromUrl } from "@/components/SearchFormFromUrl";

// A trip across the country in miniature. Decorative only.
const BAND = [
  { mode: "walk", weight: 1 },
  { mode: "local", weight: 2 },
  { mode: "bus", weight: 6 },
  { mode: "ferry", weight: 3 },
  { mode: "train", weight: 8 },
  { mode: "bus", weight: 3 },
  { mode: "walk", weight: 1 },
] as const;

export default function Home() {
  return (
    <main>
      <div className="mx-auto max-w-xl px-4 pt-8 md:pt-14">
        <h1 className="text-ink text-3xl leading-tight font-extrabold tracking-tight md:text-4xl">
          Find every way to travel between two US cities without flying, by
          train, bus, ferry, and local transit.
        </h1>
      </div>

      <div className="mt-6 px-4 md:mt-8">
        <RouteLine
          segments={[...BAND]}
          thickness={18}
          gap={4}
          animated
          className="mx-auto max-w-6xl"
        />
      </div>

      <div className="mx-auto mt-8 max-w-xl px-4">
        <Suspense fallback={<FormSkeleton />}>
          <SearchFormFromUrl />
        </Suspense>
      </div>
    </main>
  );
}

/** Same shape as the form, shown until the client takes over. */
function FormSkeleton() {
  const sign = "h-24 rounded-2xl bg-water/60";
  const field = "h-12 rounded-lg bg-raised";
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className={sign} />
      <div className="h-7" />
      <div className={sign} />
      <div className={field} />
      <div className="grid grid-cols-2 gap-3">
        <div className={field} />
        <div className={field} />
      </div>
      <div className="bg-lane/60 h-14 rounded-lg" />
    </div>
  );
}
