import { z } from "zod";

/**
 * The parts of the Transitland transit routing (OTP-compatible) response we
 * use. Loose objects: unknown extra fields are allowed and ignored.
 * Field list per https://www.transit.land/documentation/routing-platform/transit-otp
 */
const place = z.looseObject({
  name: z.string().nullish(),
  lat: z.number(),
  lon: z.number(),
  stopId: z.string().nullish(),
});

export const otpLeg = z.looseObject({
  mode: z.string(),
  transitLeg: z.boolean().nullish(),
  startTime: z.number(),
  endTime: z.number(),
  routeType: z.number().int().nullish(),
  routeShortName: z.string().nullish(),
  routeLongName: z.string().nullish(),
  agencyName: z.string().nullish(),
  feedId: z.string().nullish(),
  feedVersionSha1: z.string().nullish(),
  serviceDate: z.string().nullish(),
  from: place,
  to: place,
  legGeometry: z.looseObject({ points: z.string().nullish() }).nullish(),
});

export const otpItinerary = z.looseObject({
  startTime: z.number(),
  endTime: z.number(),
  duration: z.number().nullish(),
  transfers: z.number().nullish(),
  legs: z.array(otpLeg),
});

export const otpPlanResponse = z.looseObject({
  plan: z
    .looseObject({ itineraries: z.array(otpItinerary).nullish() })
    .nullish(),
  error: z.unknown().optional(),
});

export type OtpLeg = z.infer<typeof otpLeg>;
export type OtpItinerary = z.infer<typeof otpItinerary>;
export type OtpPlanResponse = z.infer<typeof otpPlanResponse>;

/** GET /rest/feed_versions?sha1= */
export const feedVersionsResponse = z.looseObject({
  feed_versions: z.array(
    z.looseObject({
      sha1: z.string(),
      fetched_at: z.string(),
      feed: z.looseObject({ onestop_id: z.string() }),
    }),
  ),
});

/** GET /rest/stops */
export const stopsResponse = z.looseObject({
  stops: z.array(
    z.looseObject({
      stop_id: z.string(),
      stop_name: z.string().nullish(),
      onestop_id: z.string().nullish(),
      location_type: z.number().nullish(),
      geometry: z.looseObject({
        type: z.literal("Point"),
        coordinates: z.tuple([z.number(), z.number()]).rest(z.number()),
      }),
    }),
  ),
});
