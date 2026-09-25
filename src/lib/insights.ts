// Derived signals from the Partiful payload — the stuff the official site
// doesn't show. Pure functions over TechWeekEvent[]; used by the cards, the
// facts strip, the leaderboards, and the chatbot context. Keep them cheap:
// they run on every render of a 1,700-event list.

import type { TechWeekEvent } from "./events";
import type { PartifulData } from "./partiful";

// ---------- per-event ----------

/** Confirmed headcount: approved for APPLY events, going for RSVP events. */
export function confirmed(e: TechWeekEvent): number {
  const p = e.partiful;
  if (!p || p.countsHidden) return 0;
  return p.guestAction === "APPLY" ? p.approvedCount : p.guestCount;
}

/** Everyone who has raised a hand: confirmed + waitlisted + interested + maybe. */
export function demand(e: TechWeekEvent): number {
  const p = e.partiful;
  if (!p || p.countsHidden) return 0;
  return (
    confirmed(e) +
    p.waitlistCount +
    (p.waitlistedForApprovalCount ?? 0) +
    p.interestedCount +
    (p.maybeCount ?? 0)
  );
}

/** demand / capacity, e.g. 2.49 = "249% oversubscribed". Null when uncapped. */
export function demandRatio(e: TechWeekEvent): number | null {
  const p = e.partiful;
  if (!p || p.countsHidden || !p.isCapped || !p.maxCapacity) return null;
  const d = demand(e);
  return d > 0 ? d / p.maxCapacity : null;
}

/** Exact spots left. Prefers Partiful's own number, falls back to cap - confirmed. */
export function spotsLeft(e: TechWeekEvent): number | null {
  const p = e.partiful;
  if (!p || p.countsHidden || !p.isCapped || !p.maxCapacity) return null;
  if (p.atCapacity) return 0;
  if (typeof p.remainingCapacity === "number" && p.remainingCapacity >= 0) return p.remainingCapacity;
  return Math.max(0, p.maxCapacity - confirmed(e));
}

export function waitlisted(e: TechWeekEvent): number {
  const p = e.partiful;
  if (!p || p.countsHidden) return 0;
  return p.waitlistCount + (p.waitlistedForApprovalCount ?? 0);
}

/** Plus-ones one RSVP can bring (0 = none). */
export function plusOnes(e: TechWeekEvent): number {
  return Math.max(0, (e.partiful?.maxCountPerGuest ?? 1) - 1);
}

// The Tech Week listing template forces these six (seven with GitHub) on
// every form. They're noise; what a host ADDS is the signal.
const TEMPLATE_QUESTION = [
  /^first name$/i,
  /^last name$/i,
  /^(full )?name$/i,
  /^what is your email/i,
  /^(work )?email( address)?$/i,
  /^what is your linkedin/i,
  /^linkedin( url| profile)?$/i,
  /^what('?| i)s your linkedin url/i,
  /^what is the name of your company/i,
  /^company( name)?$/i,
  /^what is your job title/i,
  /^job title$/i,
  /^what is your github profile link/i,
  /^github( profile| url)?$/i,
];
export function isTemplateQuestion(text: string): boolean {
  const t = text.trim();
  return TEMPLATE_QUESTION.some((re) => re.test(t));
}
export function extraQuestions(e: TechWeekEvent): NonNullable<PartifulData["questions"]> {
  return (e.partiful?.questions ?? []).filter((q) => !isTemplateQuestion(q.text));
}
export function questionCount(e: TechWeekEvent): number {
  return e.partiful?.questionTotal ?? e.partiful?.questions?.length ?? 0;
}

const CONSENT = /(consent|agree to|subscribe|receive .*(communications|emails|news|updates)|privacy policy|marketing|opt.?in)/i;
/** Form contains a marketing / consent clause; `required` if you can't skip it. */
export function marketingClause(e: TechWeekEvent): { present: boolean; required: boolean } {
  const qs = (e.partiful?.questions ?? []).filter((q) => CONSENT.test(q.text));
  return { present: qs.length > 0, required: qs.some((q) => q.required) };
}

const ASKS = {
  funding: /stage|raised|funding|revenue|\barr\b|valuation|check size/i,
  investor: /investor|\bvc\b|angel|\bfund\b|\blp\b|\bgp\b/i,
  headshot: /photo|headshot/i,
  phone: /phone|mobile|whatsapp/i,
  dietary: /diet|allerg/i,
  why: /why (do|are|should)|what (do|would) you (hope|want)|what are you looking|what brings you/i,
};
export function formAsks(e: TechWeekEvent): Array<keyof typeof ASKS> {
  const qs = e.partiful?.questions ?? [];
  return (Object.keys(ASKS) as Array<keyof typeof ASKS>).filter((k) => qs.some((q) => ASKS[k].test(q.text)));
}

const FOOD = /(food|lunch|dinner|breakfast|brunch|bagel|pizza|taco|sushi|snack|bites|catered|omakase|oyster|bbq|waffle|dumpling|ramen|burrito|pastr)/i;
const DRINKS = /(drinks|cocktail|beer|wine|open bar|champagne|coffee|espresso|matcha|boba|sake)/i;
const FREE = /\bfree\b|complimentary|on us\b/i;
export type Vibe =
  | "food"
  | "drinks"
  | "free"
  | "plus-ones"
  | "no-form"
  | "waitlist"
  | "paid"
  | "address"
  | "multi-day"
  | "hidden";
export const VIBE_LABELS: Record<Vibe, string> = {
  food: "Food mentioned",
  drinks: "Drinks mentioned",
  free: "Says \"free\"",
  "plus-ones": "Plus-ones allowed",
  "no-form": "No application form",
  waitlist: "Waitlist open",
  paid: "Paid tickets",
  address: "Street address known",
  "multi-day": "Multi-day / house",
  hidden: "Host hides counts",
};
export function vibes(e: TechWeekEvent): Vibe[] {
  const p = e.partiful;
  if (!p) return [];
  // Precomputed server-side from the untrimmed description when available.
  if (p.vibeTags) return p.vibeTags as Vibe[];
  const text = `${e.name} ${p.description ?? ""}`;
  const out: Vibe[] = [];
  if (FOOD.test(text)) out.push("food");
  if (DRINKS.test(text)) out.push("drinks");
  if (FREE.test(text)) out.push("free");
  if (plusOnes(e) > 0) out.push("plus-ones");
  if (p.guestAction !== "APPLY" && questionCount(e) === 0) out.push("no-form");
  if (p.enableWaitlist || waitlisted(e) > 0) out.push("waitlist");
  if (p.ticketing || p.hasTickets) out.push("paid");
  if (p.address && /\d/.test(p.address)) out.push("address");
  if (durationHours(e) >= 12) out.push("multi-day");
  if (p.countsHidden || p.countsReconstructed) out.push("hidden");
  return out;
}

export function durationHours(e: TechWeekEvent): number {
  const p = e.partiful;
  if (!p?.startDate || !p.endDate) return 0;
  const h = (new Date(p.endDate).getTime() - new Date(p.startDate).getTime()) / 36e5;
  return Number.isFinite(h) && h > 0 && h < 24 * 14 ? h : 0;
}

/** Venue name from the address ("Shack15, 1 Ferry Building..." -> "Shack15"). */
export function venueName(e: TechWeekEvent): string | null {
  const a = e.partiful?.address?.trim();
  if (!a) return null;
  const first = a.split(",")[0].trim();
  // Skip when the "venue" is just the city/neighborhood or a placeholder.
  if (!first || /^(san francisco|sf|tba|tbd|soma|financial district|virtual)/i.test(first)) return null;
  if (/^\d/.test(first)) return null; // starts with a street number: no venue name
  return first.slice(0, 60);
}

/** Days between the page being created and the event. */
export function leadTimeDays(e: TechWeekEvent): number | null {
  const p = e.partiful;
  if (!p?.createdAt || !p.startDate) return null;
  const d = (new Date(p.startDate).getTime() - new Date(p.createdAt).getTime()) / 864e5;
  return Number.isFinite(d) ? Math.round(d) : null;
}

// ---------- across events ----------

/**
 * Crowd-size percentile for every event with a visible headcount: 0.82 means
 * "bigger than 82% of events". Used by the card bar for uncapped events,
 * which have neither a cap nor an applicant pool to measure against.
 */
export function popularityMap(events: TechWeekEvent[]): Map<string, number> {
  const sized = events.map((e) => ({ id: e.id, n: confirmed(e) })).filter((x) => x.n > 0).sort((a, b) => a.n - b.n);
  const m = new Map<string, number>();
  const total = sized.length;
  for (let i = 0; i < total; i++) {
    // Share of events strictly smaller (ties share the lower rank).
    let j = i;
    while (j > 0 && sized[j - 1].n === sized[i].n) j--;
    m.set(sized[i].id, total > 1 ? j / (total - 1) : 1);
  }
  return m;
}

/** `${date} ${hour}` -> number of events starting in that hour. */
export function collisionMap(events: TechWeekEvent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of events) {
    const k = slotKey(e);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
export function slotKey(e: TechWeekEvent): string | null {
  if (!e.date || !e.time) return null;
  return `${e.date} ${e.time.slice(0, 2)}`;
}
/** How many OTHER events start in the same hour. */
export function collisions(e: TechWeekEvent, map: Map<string, number>): number {
  const k = slotKey(e);
  return k ? Math.max(0, (map.get(k) ?? 1) - 1) : 0;
}

export interface Fact {
  /** Big number / headline */
  stat: string;
  /** One line of context */
  text: string;
  /** Optional event to link */
  event?: TechWeekEvent;
}

function fmtHour(h: number): string {
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}${ampm}`;
}
function fmtDay(date: string): string {
  return new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
}

/**
 * The facts strip: one-liners nobody else has, computed from the data. Order
 * is roughly "most surprising first". Returns only facts the data supports.
 */
export function computeFacts(events: TechWeekEvent[]): Fact[] {
  const withData = events.filter((e) => e.partiful);
  const visible = withData.filter((e) => !e.partiful!.countsHidden);
  const facts: Fact[] = [];
  if (withData.length === 0) return facts;

  // Most oversubscribed
  const over = visible
    .map((e) => ({ e, r: demandRatio(e) }))
    .filter((x): x is { e: TechWeekEvent; r: number } => x.r !== null && demand(x.e) >= 30)
    .sort((a, b) => b.r - a.r)[0];
  if (over && over.r > 1.2) {
    facts.push({
      stat: `${Math.round(over.r * 100)}%`,
      text: `oversubscribed: ${demand(over.e).toLocaleString()} people want ${over.e.partiful!.maxCapacity} spots at ${over.e.name}`,
      event: over.e,
    });
  }

  // Marketing consent
  const consentRequired = withData.filter((e) => marketingClause(e).required).length;
  if (consentRequired > 3) {
    facts.push({ stat: consentRequired.toLocaleString(), text: "events make opting into marketing emails a required question." });
  }

  // Hidden counts (either still hidden, or hidden by the host and rebuilt from the live list)
  const hiddenAny = (e: TechWeekEvent) => !!(e.partiful!.countsHidden || e.partiful!.countsReconstructed);
  const hidden = withData.filter(hiddenAny).length;

  // Most anticipated (interested, nothing confirmed yet)
  const fomo = visible
    .filter((e) => confirmed(e) <= 1 && e.partiful!.interestedCount >= 15)
    .sort((a, b) => b.partiful!.interestedCount - a.partiful!.interestedCount)[0];
  if (fomo) {
    facts.push({ stat: `${fomo.partiful!.interestedCount} interested`, text: `and nobody in yet: ${fomo.name} hasn't opened RSVPs.`, event: fomo });
  }

  // Waitlists
  const wl = visible.reduce((s, e) => s + waitlisted(e), 0);
  if (wl > 50) facts.push({ stat: wl.toLocaleString(), text: "people are sitting on waitlists right now." });

  // Plus-ones
  const plus = withData.filter((e) => plusOnes(e) > 0).length;
  const maxPlus = [...withData].sort((a, b) => plusOnes(b) - plusOnes(a))[0];
  if (plus > 0 && maxPlus && plusOnes(maxPlus) >= 3) {
    facts.push({ stat: `+${plusOnes(maxPlus)}`, text: `guests allowed per RSVP at ${maxPlus.name}. ${plus} events let you bring someone.`, event: maxPlus });
  }

  // Lead time
  const leads = withData.map(leadTimeDays).filter((d): d is number => d !== null).sort((a, b) => a - b);
  if (leads.length > 50) {
    const median = leads[Math.floor(leads.length / 2)];
    facts.push({ stat: `${median} days`, text: "before the event is when the median host created their page." });
  }

  // Paid
  const paidEvents = withData.filter((e) => e.partiful!.ticketing || e.partiful!.hasTickets);
  const paid = paidEvents.length;
  if (paid > 0) facts.push({ stat: paid.toLocaleString(), text: "events charge for tickets. Partiful keeps 10% + $2 of each." });
  const paidHidden = paidEvents.filter(hiddenAny).length;
  if (paid >= 8 && paidHidden / paid >= 0.35 && hidden / withData.length < paidHidden / paid - 0.1) {
    facts.push({
      stat: `${Math.round((paidHidden / paid) * 100)}%`,
      text: `of paid events switched their guest count off (vs ${Math.round((hidden / withData.length) * 100)}% overall). We counted the guest list instead.`,
    });
  }

  // Free food
  const free = withData.filter((e) => vibes(e).includes("free") && vibes(e).includes("food")).length;
  if (free > 0) facts.push({ stat: free.toLocaleString(), text: "descriptions literally say \"free\" next to food. Filter: Says \"free\"." });

  return facts;
}

export interface LeaderboardRow {
  event: TechWeekEvent;
  value: string;
  detail?: string;
}
export interface Leaderboard {
  key: string;
  title: string;
  blurb: string;
  rows: LeaderboardRow[];
}

export function computeLeaderboards(events: TechWeekEvent[], limit = 8): Leaderboard[] {
  const visible = events.filter((e) => e.partiful && !e.partiful.countsHidden);
  const boards: Leaderboard[] = [];

  const over = visible
    .map((e) => ({ e, r: demandRatio(e) }))
    .filter((x): x is { e: TechWeekEvent; r: number } => x.r !== null && x.r >= 0.9 && demand(x.e) >= 25)
    .sort((a, b) => b.r - a.r)
    .slice(0, limit);
  if (over.length >= 3) {
    boards.push({
      key: "oversubscribed",
      title: "Most oversubscribed",
      blurb: "Confirmed + waitlisted + interested, against the cap. The closest thing to an acceptance rate Partiful still leaks.",
      rows: over.map(({ e, r }) => ({ event: e, value: `${Math.round(r * 100)}%`, detail: `${demand(e).toLocaleString()} want in / ${e.partiful!.maxCapacity} cap` })),
    });
  }

  const closing = visible
    .map((e) => ({ e, left: spotsLeft(e) }))
    .filter((x): x is { e: TechWeekEvent; left: number } => x.left !== null && x.left > 0 && confirmed(x.e) >= 15)
    .sort((a, b) => a.left - b.left)
    .slice(0, limit);
  if (closing.length >= 3) {
    boards.push({
      key: "closing",
      title: "Closing fastest",
      blurb: "Exact spots left, straight from Partiful's remainingCapacity.",
      rows: closing.map(({ e, left }) => ({ event: e, value: `${left} left`, detail: `of ${e.partiful!.maxCapacity}` })),
    });
  }

  const wl = visible
    .filter((e) => waitlisted(e) > 0)
    .sort((a, b) => waitlisted(b) - waitlisted(a))
    .slice(0, limit);
  if (wl.length >= 3) {
    boards.push({
      key: "waitlist",
      title: "Longest waitlists",
      blurb: "People queuing behind a full room.",
      rows: wl.map((e) => ({ event: e, value: `${waitlisted(e)} waiting`, detail: `${confirmed(e)} in` })),
    });
  }

  const biggest = [...visible].sort((a, b) => confirmed(b) - confirmed(a)).slice(0, limit);
  if (biggest.length >= 3) {
    boards.push({
      key: "biggest",
      title: "Biggest rooms",
      blurb: "Confirmed headcount right now.",
      rows: biggest.map((e) => ({ event: e, value: confirmed(e).toLocaleString(), detail: e.partiful!.guestAction === "APPLY" ? "approved" : "going" })),
    });
  }

  const fomo = visible
    .filter((e) => e.partiful!.interestedCount >= 10)
    .sort((a, b) => b.partiful!.interestedCount / Math.max(1, confirmed(b)) - a.partiful!.interestedCount / Math.max(1, confirmed(a)))
    .slice(0, limit);
  if (fomo.length >= 3) {
    boards.push({
      key: "fomo",
      title: "Most FOMO",
      blurb: "\"Interested\" taps per confirmed guest. High = people are circling.",
      rows: fomo.map((e) => ({ event: e, value: `${e.partiful!.interestedCount} interested`, detail: `${confirmed(e)} confirmed` })),
    });
  }

  const venues = new Map<string, TechWeekEvent[]>();
  for (const e of events) {
    const v = venueName(e);
    if (v) venues.set(v, [...(venues.get(v) ?? []), e]);
  }
  const topVenues = [...venues.entries()].filter(([, es]) => es.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, limit);
  if (topVenues.length >= 3) {
    boards.push({
      key: "venues",
      title: "Busiest venues",
      blurb: "From the street addresses on the Partiful pages.",
      rows: topVenues.map(([v, es]) => ({ event: es[0], value: `${es.length} events`, detail: v })),
    });
  }

  const hosts = new Map<string, TechWeekEvent[]>();
  for (const e of events) {
    for (const h of e.partiful?.hostProfiles ?? []) {
      if (!h.name || h.name === "Tech Week") continue;
      hosts.set(h.name, [...(hosts.get(h.name) ?? []), e]);
    }
  }
  const serial = [...hosts.entries()].filter(([, es]) => es.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, limit);
  if (serial.length >= 3) {
    boards.push({
      key: "hosts",
      title: "Serial hosts",
      blurb: "Names on the most Partiful pages this week.",
      rows: serial.map(([h, es]) => ({ event: es[0], value: `${es.length} events`, detail: h })),
    });
  }

  const cm = collisionMap(events);
  const slots = [...cm.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (slots.length >= 3) {
    boards.push({
      key: "slots",
      title: "Most crowded start times",
      blurb: "Events kicking off in the same hour. You can attend one.",
      rows: slots.map(([k, n]) => {
        const [date, hour] = k.split(" ");
        const e = events.find((x) => slotKey(x) === k)!;
        return { event: e, value: `${n} events`, detail: `${fmtDay(date)} ${fmtHour(Number(hour))}` };
      }),
    });
  }

  return boards;
}

// ---------- money ----------

export interface TicketEconomics {
  /** Tickets sold ≈ confirmed guests (Partiful doesn't expose sales directly) */
  tickets: number;
  /** Per-ticket price range in dollars; equal low/high when the price is known exactly */
  priceLow: number;
  priceHigh: number;
  /** "exact" when Partiful exposes the price, "tiers" when parsed from the description */
  confidence: "exact" | "tiers";
  grossLow: number;
  grossHigh: number;
  partifulLow: number;
  partifulHigh: number;
  hostLow: number;
  hostHigh: number;
}

const DEFAULT_FEE_RATE = 0.1;
const DEFAULT_FLAT_FEE = 2;

/** Revenue estimate for a paid event, or null when there's nothing to go on. */
export function ticketEconomics(e: TechWeekEvent): TicketEconomics | null {
  const p = e.partiful;
  const t = p?.ticketing;
  if (!p || !t || p.countsHidden) return null;
  const tickets = confirmed(e);
  if (tickets <= 0) return null;

  let priceLow: number, priceHigh: number, confidence: TicketEconomics["confidence"];
  if (typeof t.price === "number" && t.price > 0) {
    priceLow = priceHigh = t.price;
    confidence = "exact";
  } else if (t.descriptionPrices && t.descriptionPrices.length > 0) {
    priceLow = Math.min(...t.descriptionPrices);
    priceHigh = Math.max(...t.descriptionPrices);
    confidence = "tiers";
  } else {
    return null;
  }
  const feeRate = t.feeRate ?? DEFAULT_FEE_RATE;
  const flat = (t.flatFeeCents ?? DEFAULT_FLAT_FEE * 100) / 100;
  const cut = (gross: number) => gross * feeRate + flat * tickets;
  const grossLow = priceLow * tickets;
  const grossHigh = priceHigh * tickets;
  return {
    tickets,
    priceLow,
    priceHigh,
    confidence,
    grossLow,
    grossHigh,
    partifulLow: cut(grossLow),
    partifulHigh: cut(grossHigh),
    hostLow: grossLow - cut(grossLow),
    hostHigh: grossHigh - cut(grossHigh),
  };
}

export function fmtMoney(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}
/** "$1.2k" or "$800–$2.4k" */
export function fmtRange(low: number, high: number): string {
  return Math.round(low) === Math.round(high) ? fmtMoney(low) : `${fmtMoney(low)}–${fmtMoney(high)}`;
}

export interface MoneySummary {
  paidEvents: number;
  /** paid events we could put a number on */
  estimated: number;
  tickets: number;
  grossLow: number;
  grossHigh: number;
  partifulLow: number;
  partifulHigh: number;
  hostLow: number;
  hostHigh: number;
  /** Partiful's guaranteed floor from the flat fee alone, across ALL paid events with a headcount */
  partifulFloor: number;
}

export function computeMoney(events: TechWeekEvent[]): MoneySummary {
  const paid = events.filter((e) => e.partiful?.ticketing || e.partiful?.hasTickets);
  const sum: MoneySummary = { paidEvents: paid.length, estimated: 0, tickets: 0, grossLow: 0, grossHigh: 0, partifulLow: 0, partifulHigh: 0, hostLow: 0, hostHigh: 0, partifulFloor: 0 };
  for (const e of paid) {
    const n = confirmed(e);
    sum.partifulFloor += n * ((e.partiful?.ticketing?.flatFeeCents ?? DEFAULT_FLAT_FEE * 100) / 100);
    const x = ticketEconomics(e);
    if (!x) continue;
    sum.estimated++;
    sum.tickets += x.tickets;
    sum.grossLow += x.grossLow;
    sum.grossHigh += x.grossHigh;
    sum.partifulLow += x.partifulLow;
    sum.partifulHigh += x.partifulHigh;
    sum.hostLow += x.hostLow;
    sum.hostHigh += x.hostHigh;
  }
  return sum;
}

/** Leaderboard of paid events by estimated host take-home. */
export function moneyLeaderboard(events: TechWeekEvent[], limit = 8): Leaderboard | null {
  const rows = events
    .map((e) => ({ e, x: ticketEconomics(e) }))
    .filter((r): r is { e: TechWeekEvent; x: TicketEconomics } => r.x !== null)
    .sort((a, b) => b.x.hostHigh - a.x.hostHigh)
    .slice(0, limit);
  if (rows.length < 2) return null;
  return {
    key: "money",
    title: "Biggest paydays",
    blurb: "Tickets sold ≈ confirmed guests × price from the Partiful page (a range when the description lists tiers). Partiful keeps 10% + $2 per ticket.",
    rows: rows.map(({ e, x }) => ({
      event: e,
      value: fmtRange(x.hostLow, x.hostHigh),
      detail: `to host · ${fmtRange(x.partifulLow, x.partifulHigh)} to Partiful · ${x.tickets} × ${x.priceLow === x.priceHigh ? `$${x.priceLow}` : `$${x.priceLow}–$${x.priceHigh}`}${x.confidence === "tiers" ? " (tiers from description)" : ""}`,
    })),
  };
}
