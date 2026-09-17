// Per-city configuration for the Tech Week directories (/nyc, /sf).
// Everything that differs between editions lives here so the page, filters,
// chat prompt and scraper stay city-agnostic.

export type CitySlug = "nyc" | "sf";

export interface CityConfig {
  slug: CitySlug;
  /** Short label used in headings: "NYC", "SF" */
  short: string;
  /** Page H1 */
  title: string;
  /** Human date range for prompts/copy */
  dateRange: string;
  /** ISO dates of the edition, in order */
  days: Array<{ value: string; label: string }>;
  timeZone: string;
  /**
   * Fixed neighborhood filter list. Leave empty to derive the list from the
   * event data (unique `location` labels, most common first).
   */
  neighborhoods: string[];
  /** Suggested chat prompts shown in the empty chat state */
  suggestedPrompts: string[];
  /** Official calendar, for the credit line */
  officialUrl: string;
  /** Where this edition's directory lives (each edition is its own site) */
  siteUrl: string;
}

function makeDays(isoDates: string[]): CityConfig["days"] {
  return isoDates.map((value) => ({
    value,
    label: new Date(value + "T12:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
  }));
}

export const CITIES: Record<CitySlug, CityConfig> = {
  nyc: {
    slug: "nyc",
    short: "NYC",
    title: "NYC Tech Week",
    dateRange: "June 1-7, 2026",
    days: makeDays([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
    ]),
    timeZone: "America/New_York",
    neighborhoods: [
      "Midtown",
      "SoHo",
      "Flatiron",
      "Chelsea",
      "Financial District",
      "Union Square",
      "Brooklyn",
      "Nomad",
      "Lower East Side",
      "East Village",
      "Tribeca",
      "West Village",
      "Hudson Yards",
      "Greenwich Village",
      "Meatpacking District",
      "Chinatown",
      "Upper East Side",
      "Upper Manhattan",
    ],
    suggestedPrompts: [
      "Which events are harder to get into than YC?",
      "Free food actually worth showing up for?",
      "Where can I get an Angel check?",
    ],
    officialUrl: "https://www.tech-week.com/calendar/nyc",
    siteUrl: "https://nyc-tech-week.vercel.app/nyc",
  },
  sf: {
    slug: "sf",
    short: "SF",
    title: "SF Tech Week",
    dateRange: "October 5-11, 2026",
    days: makeDays([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]),
    timeZone: "America/Los_Angeles",
    // The SF edition labels locations consistently ("SOMA", "FiDi (SF)",
    // "Mission Bay", "Virtual (SF)"...), so the filter list is derived from
    // the data instead of hand-maintained.
    neighborhoods: [],
    suggestedPrompts: [
      "Which events are the most oversubscribed?",
      "Where can I bring a +1 and get free food?",
      "Thursday 6pm has 115 events — which one?",
    ],
    officialUrl: "https://www.tech-week.com/calendar/sf",
    siteUrl: "https://sf-techweek.vercel.app",
  },
};

export function getCity(slug: string): CityConfig | null {
  return slug in CITIES ? CITIES[slug as CitySlug] : null;
}
