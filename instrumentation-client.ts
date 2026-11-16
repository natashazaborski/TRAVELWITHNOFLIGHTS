// Runs in the browser before the app hydrates (Next.js convention).
// Analytics loads lazily from here; see lib/analytics/init.ts.
import { initAnalytics } from "@/lib/analytics/init";

initAnalytics();
