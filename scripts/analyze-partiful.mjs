#!/usr/bin/env node
// Exploratory analysis over every known Partiful page for a city. Re-fetches
// the pages (fast; Partiful doesn't throttle) and prints leaderboards.
// Usage: node scripts/analyze-partiful.mjs sf
import fs from "node:fs";
const CITY = process.argv[2] ?? "sf";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const official = JSON.parse(fs.readFileSync(`data/${CITY}-events.json`, "utf8")).events;
const links = JSON.parse(fs.readFileSync(`data/${CITY}-links.json`, "utf8"));
const byId = new Map(official.map((e) => [e.id, e]));
const targets = Object.entries(links).filter(([, u]) => u.includes("partiful.com"));

async function fetchOne(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json">\s*([\s\S]*?)\s*<\/script>/);
    return m ? JSON.parse(m[1]).props.pageProps : null;
  } catch { return null; }
}
const rows = [];
let i = 0;
await Promise.all(Array.from({ length: 16 }, async () => {
  while (i < targets.length) {
    const [id, url] = targets[i++];
    const pp = await fetchOne(url);
    if (pp?.event) rows.push({ id, url, o: byId.get(id), pp });
  }
}));
fs.writeFileSync(`data/${CITY}-partiful-rich.json`, JSON.stringify(rows.map((r) => ({ id: r.id, url: r.url, name: r.o?.name, date: r.o?.date, time: r.o?.time, company: r.o?.company, event: r.pp.event, hosts: r.pp.hosts }))));
console.log(`fetched ${rows.length}/${targets.length} pages\n`);

const ev = rows.map((r) => ({ ...r, e: r.pp.event, c: r.pp.event.guestStatusCounts ?? {}, hosts: r.pp.hosts ?? [] }));
const n = (x) => (x ?? 0).toLocaleString();
const top = (arr, k, f, fmt) => { console.log(`\n=== ${k} ===`); arr.slice(0, f).forEach((x, j) => console.log(`${String(j + 1).padStart(2)}. ${fmt(x)}`)); };
const name = (r) => (r.o?.name ?? r.e.title).slice(0, 55);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// 0. basics
const apply = ev.filter((r) => r.e.guestAction === "APPLY"), rsvp = ev.filter((r) => r.e.guestAction !== "APPLY");
const hidden = ev.filter((r) => r.e.showGuestCount === false);
console.log(`events: ${ev.length} | APPLY ${apply.length} (${pct(apply.length, ev.length)}%) | RSVP ${rsvp.length} | counts hidden ${hidden.length} | guest list public ${ev.filter((r) => r.e.showGuestList).length} | waitlist on ${ev.filter((r) => r.e.enableWaitlist).length} | capped ${ev.filter((r) => r.e.isCapped).length} | at capacity ${ev.filter((r) => r.e.atCapacity).length} | ticketed ${ev.filter((r) => r.e.ticketing).length} | plus-ones allowed ${ev.filter((r) => (r.e.maxCountPerGuest ?? 1) > 1).length} | questionnaire ${ev.filter((r) => r.e.questionnaireEnabled).length}`);
const confirmed = (r) => (r.e.guestAction === "APPLY" ? r.c.APPROVED ?? 0 : r.c.GOING ?? 0);
console.log(`total confirmed: ${n(ev.reduce((s, r) => s + confirmed(r), 0))} | total interested: ${n(ev.reduce((s, r) => s + (r.c.INTERESTED ?? 0), 0))} | total waitlisted: ${n(ev.reduce((s, r) => s + (r.c.WAITLIST ?? 0) + (r.c.WAITLISTED_FOR_APPROVAL ?? 0), 0))} | pending>0: ${ev.filter((r) => r.c.PENDING_APPROVAL > 0).length} | rejected>0: ${ev.filter((r) => r.c.REJECTED > 0).length} | declined>0: ${ev.filter((r) => r.c.DECLINED > 0).length} | maybe>0: ${ev.filter((r) => r.c.MAYBE > 0).length}`);

// 1. biggest
top([...ev].sort((a, b) => confirmed(b) - confirmed(a)), "BIGGEST (confirmed)", 12, (r) => `${n(confirmed(r))} ${r.e.guestAction === "APPLY" ? "approved" : "going"} | cap ${r.e.maxCapacity ?? "∞"} | ${name(r)} — ${r.o?.company}`);
// 2. nearly full / remaining capacity
top(ev.filter((r) => typeof r.e.remainingCapacity === "number" && r.e.remainingCapacity >= 0 && !r.e.atCapacity && confirmed(r) > 20).sort((a, b) => a.e.remainingCapacity - b.e.remainingCapacity), "FEWEST SPOTS LEFT (exact remainingCapacity)", 12, (r) => `${r.e.remainingCapacity} left of ${r.e.maxCapacity} | ${name(r)}`);
// 3. FOMO: interested vs confirmed
top(ev.filter((r) => (r.c.INTERESTED ?? 0) >= 15).sort((a, b) => (b.c.INTERESTED / Math.max(1, confirmed(b))) - (a.c.INTERESTED / Math.max(1, confirmed(a)))), "MOST FOMO (interested per confirmed)", 10, (r) => `${r.c.INTERESTED} interested vs ${confirmed(r)} confirmed | ${name(r)}`);
top([...ev].sort((a, b) => (b.c.INTERESTED ?? 0) - (a.c.INTERESTED ?? 0)), "MOST INTERESTED (raw)", 8, (r) => `${r.c.INTERESTED} interested | ${confirmed(r)} confirmed | ${name(r)}`);
// 4. waitlists
top(ev.filter((r) => (r.c.WAITLIST ?? 0) + (r.c.WAITLISTED_FOR_APPROVAL ?? 0) > 0).sort((a, b) => ((b.c.WAITLIST ?? 0) + (b.c.WAITLISTED_FOR_APPROVAL ?? 0)) - ((a.c.WAITLIST ?? 0) + (a.c.WAITLISTED_FOR_APPROVAL ?? 0))), "LONGEST WAITLISTS", 10, (r) => `${(r.c.WAITLIST ?? 0) + (r.c.WAITLISTED_FOR_APPROVAL ?? 0)} waitlisted | ${confirmed(r)} in | cap ${r.e.maxCapacity ?? "∞"} | ${name(r)}`);
// 5. application questions
const qs = ev.flatMap((r) => (r.e.questionnaire?.questions ?? []).map((q) => ({ r, q })));
const qnorm = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const qcount = new Map();
for (const { q } of qs) { const k = qnorm(q.text); qcount.set(k, (qcount.get(k) ?? 0) + 1); }
console.log(`\napplication questions: ${qs.length} across ${ev.filter((r) => r.e.questionnaire?.questions?.length).length} events (avg ${(qs.length / Math.max(1, ev.filter((r) => r.e.questionnaire?.questions?.length).length)).toFixed(1)} per form)`);
top([...qcount.entries()].sort((a, b) => b[1] - a[1]), "MOST-ASKED QUESTIONS", 25, ([t, c]) => `${c}x  ${t.slice(0, 90)}`);
top([...ev].sort((a, b) => (b.e.questionnaire?.questions?.length ?? 0) - (a.e.questionnaire?.questions?.length ?? 0)), "LONGEST APPLICATION FORMS", 10, (r) => `${r.e.questionnaire?.questions?.length ?? 0} questions | ${name(r)} :: ${(r.e.questionnaire?.questions ?? []).map((q) => q.text.slice(0, 40)).join(" / ").slice(0, 200)}`);
const spicy = /(net worth|revenue|arr|raised|valuation|fund|check size|aum|title|role|linkedin|twitter|x\.com|why (do|should)|what (do|would) you|company|stage|investor|founder|dietary|allerg|phone|age|gender|pronoun|photo|headshot|ethnic|plus one|\+1|nda|referral|who invited|vibe|fun fact|hot take)/i;
top(qs.filter(({ q }) => q.text.length > 60 || spicy.test(q.text)).sort((a, b) => b.q.text.length - a.q.text.length), "SPICIEST / LONGEST QUESTIONS", 25, ({ r, q }) => `[${name(r).slice(0, 35)}] ${q.text.slice(0, 160)}${q.required ? " (required)" : ""}`);
const qtypes = new Map(); for (const { q } of qs) qtypes.set(q.type, (qtypes.get(q.type) ?? 0) + 1); console.log("\nquestion types:", JSON.stringify(Object.fromEntries(qtypes)));
// 6. hosts
const hostCount = new Map();
for (const r of ev) for (const h of r.hosts) { const k = h.name; if (!k) continue; const v = hostCount.get(k) ?? { n: 0, tw: h.socials?.twitter?.value, ig: h.socials?.instagram?.value, bio: h.bio?.value, events: [] }; v.n++; v.events.push(name(r).slice(0, 30)); hostCount.set(k, v); }
top([...hostCount.entries()].sort((a, b) => b[1].n - a[1].n), "SERIAL HOSTS (person hosting most events)", 20, ([k, v]) => `${v.n}x ${k}${v.tw ? " @" + v.tw : ""} :: ${v.events.slice(0, 4).join(" | ")}`);
console.log(`\nhosts with twitter handle in payload: ${[...hostCount.values()].filter((v) => v.tw).length} / ${hostCount.size}; with bio: ${[...hostCount.values()].filter((v) => v.bio).length}`);
const ownerCount = new Map(); for (const r of ev) for (const o of r.e.ownerIds ?? []) ownerCount.set(o, (ownerCount.get(o) ?? 0) + 1);
console.log(`owner accounts: ${ownerCount.size}; accounts owning 3+ events: ${[...ownerCount.values()].filter((v) => v >= 3).length}`);
// 7. venues
const venue = new Map(); for (const r of ev) { const k = (r.e.location ?? "").trim(); if (k) venue.set(k, (venue.get(k) ?? 0) + 1); }
top([...venue.entries()].sort((a, b) => b[1] - a[1]), "MOST-USED VENUES (full address)", 15, ([k, c]) => `${c}x ${k.slice(0, 90)}`);
console.log(`events with a street address: ${ev.filter((r) => /\d/.test(r.e.location ?? "")).length}; with google maps url: ${ev.filter((r) => r.e.locationInfo?.mapsInfo?.googleMapsUrl).length}`);
// 8. timing
const created = ev.map((r) => r.e.createdAt).filter(Boolean).sort();
console.log(`\ncreatedAt: earliest ${created[0]?.slice(0, 10)} latest ${created.at(-1)?.slice(0, 10)}; posted in last 7 days: ${ev.filter((r) => Date.now() - new Date(r.e.createdAt) < 7 * 864e5).length}; updated in last 24h: ${ev.filter((r) => Date.now() - new Date(r.e.updatedAt) < 864e5).length}`);
const byMonth = new Map(); for (const c of created) { const k = c.slice(0, 7); byMonth.set(k, (byMonth.get(k) ?? 0) + 1); } console.log("created by month:", JSON.stringify(Object.fromEntries(byMonth)));
top(ev.filter((r) => r.e.rsvpDeadline), "RSVP DEADLINES (soonest)", 8, (r) => `${r.e.rsvpDeadline?.slice(0, 16)} | ${name(r)}`);
// 9. plus ones, themes, tickets
top(ev.filter((r) => (r.e.maxCountPerGuest ?? 1) > 1).sort((a, b) => b.e.maxCountPerGuest - a.e.maxCountPerGuest), "MOST PLUS-ONES ALLOWED", 8, (r) => `+${r.e.maxCountPerGuest - 1} | ${name(r)}`);
const themes = new Map(); for (const r of ev) { const k = r.e.displaySettings?.theme ?? "none"; themes.set(k, (themes.get(k) ?? 0) + 1); } console.log("\nthemes:", JSON.stringify(Object.fromEntries([...themes.entries()].sort((a, b) => b[1] - a[1]))));
const effects = new Map(); for (const r of ev) { const k = r.e.displaySettings?.effect ?? "none"; effects.set(k, (effects.get(k) ?? 0) + 1); } console.log("effects:", JSON.stringify(Object.fromEntries(effects)));
top(ev.filter((r) => r.e.ticketing), "TICKETED (paid) EVENTS", 10, (r) => `${JSON.stringify(r.e.ticketing?.feeConfig)} | ${name(r)}`);
// 10. description keywords
const kw = { "open bar": /open bar/i, "free food": /free (food|lunch|dinner|breakfast|drinks|coffee|pizza|tacos)/i, pizza: /pizza/i, tacos: /taco/i, sushi: /sushi/i, oysters: /oyster/i, "omakase": /omakase/i, matcha: /matcha/i, espresso: /espresso|coffee/i, cocktails: /cocktail/i, champagne: /champagne|prosecco/i, wine: /\bwine\b/i, rooftop: /rooftop/i, yacht: /yacht|boat|cruise|sail/i, karaoke: /karaoke/i, "DJ": /\bDJ\b/, "run club": /run club|5k|jog/i, sauna: /sauna|cold plunge|ice bath/i, massage: /massage/i, dogs: /\bdogs?\b|puppies/i, "demo": /demo/i, "hackathon": /hackathon/i, "pitch": /pitch/i, "a16z": /a16z|andreessen/i, "yc": /\bYC\b|y combinator/i, "raise": /raising|fundrais/i, "swag": /swag|merch/i, "nda": /\bnda\b/i, "no plus ones": /no plus.?ones|no \+1/i, "dress code": /dress code|black tie|cocktail attire/i, "21+": /21\+|over 21|must be 21/i, "invite only": /invite.?only|by invitation/i };
const hits = Object.entries(kw).map(([k, re]) => [k, ev.filter((r) => re.test(`${r.e.title} ${r.e.description ?? ""}`)).length]).sort((a, b) => b[1] - a[1]);
console.log("\ndescription keywords:", hits.map(([k, c]) => `${k}:${c}`).join("  "));
// 11. custom sections
const cs = ev.flatMap((r) => (r.e.customSections ?? []).map((c) => ({ r, c })));
top(cs, "CUSTOM SECTIONS (sample)", 8, ({ r, c }) => `[${name(r).slice(0, 30)}] ${c.title}: ${(c.value ?? "").slice(0, 100).replace(/\n/g, " ")}`);
// 12. secretive hosts
top(hidden.sort((a, b) => (b.o?.company ?? "").localeCompare(a.o?.company ?? "")), "COUNTS HIDDEN BY HOST", 12, (r) => `${name(r)} — ${r.o?.company}`);
// 13. official-side: apply share by company, busiest slots
const slot = new Map(); for (const e of official) { const k = `${e.date} ${e.time.slice(0, 2)}:00`; slot.set(k, (slot.get(k) ?? 0) + 1); }
top([...slot.entries()].sort((a, b) => b[1] - a[1]), "BUSIEST HOURS (official list, all 1681)", 8, ([k, c]) => `${c} events start at ${k}`);
const days = new Map(); for (const e of official) days.set(e.date, (days.get(e.date) ?? 0) + 1); console.log("per day:", JSON.stringify(Object.fromEntries([...days.entries()].sort())));
