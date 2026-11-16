import { z } from "zod";
import { LOCAL_DATE_TIME_PATTERN } from "@/lib/time/zoned";

const placeRef = z.object({ id: z.number().int().positive() }).loose();

/**
 * Body of POST /api/plan. `from` / `to` may be full place objects from
 * /api/places; only `id` is used.
 */
export const planBodySchema = z.object({
  from: placeRef,
  to: placeRef,
  dateTime: z
    .string()
    .regex(
      LOCAL_DATE_TIME_PATTERN,
      "Use local time like 2026-11-14T09:00, without a timezone",
    )
    .pipe(z.iso.datetime({ local: true })),
  mode: z.enum(["leaveAt", "arriveBy"]),
});

export type PlanBody = z.infer<typeof planBodySchema>;

export type PlanApiError =
  | { status: "invalid"; message: string; issues?: unknown }
  | { status: "rateLimited"; message: string; retryAfterSeconds: number }
  | { status: "busy"; message: string; retryAfterSeconds: number | null }
  | { status: "unavailable"; message: string };
