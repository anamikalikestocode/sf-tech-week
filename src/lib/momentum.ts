// RSVP momentum, from the timestamps on Partiful's live guest list
// (scripts/scrape-techweek.mjs tallies rows per day and stores only the
// per-day counts — never the rows).

import type { TechWeekEvent } from "./events";
import { confirmed, type Fact, type Leaderboard } from "./insights";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** RSVPs in the last N calendar days (UTC), inclusive of `now`'s day. */
export function rsvpsLast(e: TechWeekEvent, days: number, now = new Date()): number {
  const per = e.partiful?.rsvpsPerDay;
  if (!per) return 0;
  let total = 0;
  for (let i = 0; i < days; i++) {
    total += per[dayKey(new Date(now.getTime() - i * 864e5))] ?? 0;
  }
  return total;
}

export function momentumLeaderboard(events: TechWeekEvent[], limit = 8): Leaderboard | null {
  const rows = events
    .map((e) => ({ e, n: rsvpsLast(e, 2) }))
    .filter((r) => r.n >= 10)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit);
  if (rows.length < 3) return null;
  return {
    key: "momentum",
    title: "Hottest right now",
    blurb: "RSVPs in the last 48 hours, from the timestamps on the live guest list.",
    rows: rows.map(({ e, n }) => ({ event: e, value: `+${n}`, detail: `${confirmed(e).toLocaleString()} total` })),
  };
}

export function momentumFacts(events: TechWeekEvent[]): Fact[] {
  const facts: Fact[] = [];
  const withLive = events.filter((e) => e.partiful?.rsvpsPerDay);
  if (withLive.length < 50) return facts;

  const yesterday = withLive.reduce((s, e) => s + rsvpsLast(e, 1, new Date(Date.now() - 864e5)), 0);
  if (yesterday > 0) {
    facts.push({ stat: yesterday.toLocaleString(), text: "people RSVP'd to something yesterday. The week is filling up in real time." });
  }

  const hot = [...withLive].sort((a, b) => rsvpsLast(b, 2) - rsvpsLast(a, 2))[0];
  if (hot && rsvpsLast(hot, 2) >= 20) {
    facts.push({ stat: `+${rsvpsLast(hot, 2)}`, text: `RSVPs in 48 hours at ${hot.name}. Hottest event right now.`, event: hot });
  }

  const rebuilt = events.filter((e) => e.partiful?.countsReconstructed).length;
  if (rebuilt > 0) {
    facts.push({ stat: rebuilt.toLocaleString(), text: "hosts switched their guest count off. The live guest list still adds up, so we counted it." });
  }
  return facts;
}
