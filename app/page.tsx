import { SeverityNumber } from "@opentelemetry/api-logs";
import { connection } from "next/server";
import { posthogInstrumentationLogger } from "../instrumentation";

export default async function Home() {
  await connection();

  posthogInstrumentationLogger?.emit({
    body: "Trip-search placeholder rendered",
    severityNumber: SeverityNumber.INFO,
    attributes: {
      event: "trip_search_placeholder_rendered",
      route: "/",
    },
  });

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-2xl font-semibold">[APP NAME]</h1>
      <p className="mt-2 text-base">Trip search is not built yet.</p>
    </main>
  );
}
