/**
 * Known operators: official booking homepages and whether a bus operator runs
 * intercity (not local) service.
 *
 * Rules:
 * - Homepages only. Never build deep links (pre-filled searches, route pages)
 *   unless the URL format has been verified against the operator's site.
 * - Every homepage below was loaded and confirmed on 2026-11-13. Operators
 *   whose sites could not be confirmed are left out on purpose: Barons Bus,
 *   Cape Cod Steamship, Lake Express.
 * - `names` must match GTFS agency_name values as Transitland reports them.
 *   These are the operators' public names; confirm against recorded
 *   responses (scripts/record-transitland.mts) and add variants as found.
 */
export interface OperatorInfo {
  names: string[];
  bookingUrl: string;
  /** Runs intercity bus service, even if its feed uses GTFS route_type 3. */
  intercityBus?: boolean;
}

export const OPERATORS: readonly OperatorInfo[] = [
  // Rail
  { names: ["Amtrak"], bookingUrl: "https://www.amtrak.com/" },
  { names: ["Brightline"], bookingUrl: "https://www.gobrightline.com/" },

  // Intercity bus
  {
    names: ["Greyhound", "Greyhound Lines", "Greyhound Lines, Inc."],
    bookingUrl: "https://www.greyhound.com/",
    intercityBus: true,
  },
  {
    names: ["FlixBus"],
    bookingUrl: "https://www.flixbus.com/",
    intercityBus: true,
  },
  {
    names: ["Megabus", "megabus.com"],
    bookingUrl: "https://us.megabus.com/",
    intercityBus: true,
  },
  {
    names: ["Peter Pan", "Peter Pan Bus Lines"],
    bookingUrl: "https://peterpanbus.com/",
    intercityBus: true,
  },
  {
    names: ["Jefferson Lines"],
    bookingUrl: "https://www.jeffersonlines.com/",
    intercityBus: true,
  },
  {
    names: ["OurBus", "Our Bus"],
    bookingUrl: "https://www.ourbus.com/",
    intercityBus: true,
  },
  {
    names: ["Concord Coach Lines"],
    bookingUrl: "https://concordcoachlines.com/",
    intercityBus: true,
  },
  {
    names: ["Dartmouth Coach"],
    bookingUrl: "https://dartmouthcoach.com/",
    intercityBus: true,
  },
  {
    names: ["C&J", "C&J Bus Lines"],
    bookingUrl: "https://www.ridecj.com/",
    intercityBus: true,
  },
  {
    names: ["Vamoose", "Vamoose Bus"],
    bookingUrl: "https://www.vamoosebus.com/",
    intercityBus: true,
  },
  {
    names: ["Salt Lake Express"],
    bookingUrl: "https://saltlakeexpress.com/",
    intercityBus: true,
  },
  {
    names: ["Burlington Trailways"],
    bookingUrl: "https://burlingtontrailways.com/",
    intercityBus: true,
  },
  {
    names: ["Trailways of New York", "Adirondack Trailways"],
    bookingUrl: "https://trailways.com/",
    intercityBus: true,
  },
  {
    names: ["RedCoach", "Red Coach"],
    bookingUrl: "https://www.redcoachusa.com/",
    intercityBus: true,
  },

  // Ferry
  {
    names: ["Washington State Ferries"],
    bookingUrl: "https://wsdot.wa.gov/travel/washington-state-ferries",
  },
  {
    names: ["Alaska Marine Highway System", "Alaska Marine Highway"],
    bookingUrl: "https://dot.alaska.gov/amhs/",
  },
  {
    names: ["Steamship Authority", "The Steamship Authority"],
    bookingUrl: "https://www.steamshipauthority.com/",
  },
];

function key(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const byName = new Map<string, OperatorInfo>();
for (const op of OPERATORS) {
  for (const name of op.names) byName.set(key(name), op);
}

export function findOperator(name: string | null | undefined) {
  return name ? byName.get(key(name)) : undefined;
}

export function bookingUrlFor(name: string | null | undefined): string | null {
  return findOperator(name)?.bookingUrl ?? null;
}

export function isIntercityBusOperator(name: string | null | undefined) {
  return findOperator(name)?.intercityBus === true;
}
