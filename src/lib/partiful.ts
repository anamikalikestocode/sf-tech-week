// Shape of the per-event Partiful data produced by scripts/scrape-techweek.mjs.
export interface PartifulData {
  guestCount: number;
  pendingCount: number;
  approvedCount: number;
  goingCount: number;
  interestedCount: number;
  waitlistCount: number;
  atCapacity: boolean;
  isCapped: boolean;
  rsvpsEnabled: boolean;
  guestAction: string;
  maxCapacity: number | null;
  description: string;
  imageUrl: string | null;
  neighborhood: string | null;
  hasTickets: boolean;

  // --- Fields from Partiful's newer `guestStatusCounts` payload (SF edition
  // onward, via scripts/scrape-techweek.mjs). All optional so the legacy
  // live-scrape path for NYC keeps type-checking.
  /** Applications the host explicitly rejected */
  rejectedCount?: number;
  /** Applications parked on the approval waitlist */
  waitlistedForApprovalCount?: number;
  /** approved + pending + rejected + waitlisted-for-approval */
  appliedCount?: number;
  /** approved / applied, only when Partiful exposes a non-zero applicant pool */
  acceptanceRate?: number | null;
  /** Host turned off "show guest count" — Partiful zeroes every count */
  countsHidden?: boolean;
  /** Host hid the count but we rebuilt it from the live guest list */
  countsReconstructed?: boolean;
  /** Live tally from api.partiful.com getGuests: rows by status (APPROVED, GOING, WAITLIST...) */
  liveCounts?: Record<string, number>;
  liveRows?: number;
  plusOnesTotal?: number;
  /** RSVPs per calendar day (UTC), from row timestamps — RSVP velocity */
  rsvpsPerDay?: Record<string, number>;
  liveFetchedAt?: string | null;
  liveError?: string | null;
  maybeCount?: number;
  declinedCount?: number;
  /** Host display names from the Partiful page */
  hosts?: string[];
  startDate?: string | null;
  endDate?: string | null;

  // --- Everything else the Partiful page leaks (SF scraper onward).
  /** Host enabled a waitlist once the cap is hit */
  enableWaitlist?: boolean;
  questionnaireEnabled?: boolean;
  /** Exact spots left as Partiful computes it (null when uncapped) */
  remainingCapacity?: number | null;
  /** Check-ins; equals the confirmed count until the event happens */
  attendedCount?: number;
  /** How many people one RSVP admits (1 = no plus-ones) */
  maxCountPerGuest?: number;
  plusOneNamesRequired?: boolean;
  allowGuestsToInviteMutuals?: boolean;
  showGuestList?: boolean;
  disableMaybe?: boolean;
  /** Full street address (official site only shows the neighborhood) */
  address?: string | null;
  mapsUrl?: string | null;
  approximateLocation?: string | null;
  createdAt?: string | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
  rsvpDeadline?: string | null;
  theme?: string | null;
  titleFont?: string | null;
  effect?: string | null;
  imageBlurHash?: string | null;
  ticketing?: {
    type: string | null;
    /** Partiful's percentage cut (0.1 = 10%) */
    feeRate: number | null;
    /** Partiful's flat per-ticket fee, in cents (200 = $2) */
    flatFeeCents: number | null;
    /** Ticket price in dollars when the event has a single price */
    price?: number | null;
    currency?: string | null;
    /** Dollar amounts mentioned in the description (tier prices, usually) */
    descriptionPrices?: number[];
  } | null;
  /** The application form: what you must answer to get in */
  questions?: Array<{ text: string; type: string | null; required: boolean; options?: string[] }>;
  questionnaireVersions?: number;
  customSections?: Array<{ title: string; value: string }>;
  hostProfiles?: Array<{
    id: string | null;
    name: string;
    bio: string | null;
    twitter: string | null;
    instagram: string | null;
    linkedin: string | null;
    photoUrl: string | null;
    isManaged: boolean;
  }>;
  ownerIds?: string[];
  publicShortUrl?: string | null;
  calendarFile?: string | null;
}
