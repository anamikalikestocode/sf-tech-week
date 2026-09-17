#!/usr/bin/env node
/**
 * Discover Partiful URLs for Tech Week events WITHOUT touching tech-week.com's
 * rate-limited /go/event/ redirect.
 *
 * Every Partiful event page embeds `similarEvents` (4-5 nearby events in the
 * same region/time window). Tech Week events cluster tightly, so a breadth-
 * first crawl from the Partiful links we already know reaches most of the
 * others. Each discovered Partiful event is matched to the official listing
 * by normalized title (+ date sanity check) and written into
 * data/<city>-links.json in the same {techWeekEventId: url} shape the main
 * scraper uses, so `npm run scrape` then only needs to click the leftovers.
 *
 * Usage: node scripts/crawl-partiful-graph.mjs sf [--max 4000] [--concurrency 12]
 *
 * Needs data/<city>-events.json (the official list; the scraper writes it even
 * when link resolution is incomplete) and data/<city>-links.json (seeds).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const CITY = args.find((a) => !a.startsWith("--")) ?? "sf";
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const MAX_FETCHES = Number(opt("max", 4000));
const CONCURRENCY = Number(opt("concurrency", 12));

const EVENTS_FILE = path.join(ROOT, "data", `${CITY}-events.json`);
const LINKS_FILE = path.join(ROOT, "data", `${CITY}-links.json`);
const GRAPH_FILE = path.join(ROOT, "data", `${CITY}-partiful-graph.json`);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

const official = JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8")).events;
const links = fs.existsSync(LINKS_FILE) ? JSON.parse(fs.readFileSync(LINKS_FILE, "utf8")) : {};
const graph = fs.existsSync(GRAPH_FILE) ? JSON.parse(fs.readFileSync(GRAPH_FILE, "utf8")) : {};

// Edition window (inclusive, with a day of slack each side for timezone drift).
const days = [...new Set(official.map((e) => e.date))].sort();
const windowStart = new Date(days[0] + "T00:00:00Z").getTime() - 36e5 * 36;
const windowEnd = new Date(days[days.length - 1] + "T23:59:59Z").getTime() + 36e5 * 36;

// ---------- title matching ----------
const STOP = new Set(["the", "a", "an", "and", "of", "at", "in", "on", "for", "with", "x", "by", "to", "w", "sftechweek", "sf", "techweek", "tech", "week", "2026"]);
function tokens(s) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[#@]\w+/g, " ")           // hashtags/handles
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !STOP.has(t));
}
function norm(s) { return tokens(s).join(" "); }
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// Index official events by normalized title and by date.
const byNorm = new Map();
for (const e of official) {
  const n = norm(e.name);
  if (!byNorm.has(n)) byNorm.set(n, []);
  byNorm.get(n).push(e);
}
const unresolved = () => official.filter((e) => !links[e.id]);

function matchOfficial(p) {
  // p: {id, title, startDate}
  const pDate = p.startDate ? new Date(p.startDate) : null;
  const n = norm(p.title);
  const candidates = unresolved();
  // 1. exact normalized title
  let hits = (byNorm.get(n) ?? []).filter((e) => !links[e.id]);
  if (hits.length === 1) return { event: hits[0], score: 1 };
  if (hits.length > 1 && pDate) {
    const sameDay = hits.filter((e) => sameLocalDay(e.date, pDate));
    if (sameDay.length === 1) return { event: sameDay[0], score: 1 };
  }
  // 2. fuzzy: best Jaccard among unresolved, must be strong and unambiguous
  const pt = tokens(p.title);
  let best = null, second = 0;
  for (const e of candidates) {
    const s = jaccard(pt, tokens(e.name));
    if (!best || s > best.score) { second = best?.score ?? 0; best = { event: e, score: s }; }
    else if (s > second) second = s;
  }
  if (!best) return null;
  const dateOk = !pDate || sameLocalDay(best.event.date, pDate);
  if (best.score >= 0.85 && dateOk && best.score - second >= 0.15) return best;
  if (best.score >= 0.6 && dateOk && best.score - second >= 0.3 && pt.length >= 3) return best;
  return null;
}
function sameLocalDay(isoDay, date) {
  // Compare in America/Los_Angeles (SF) or America/New_York (NYC).
  const tz = CITY === "nyc" ? "America/New_York" : "America/Los_Angeles";
  const d = date.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
  return d === isoDay;
}

// ---------- fetch ----------
async function fetchPartiful(id) {
  const url = `https://partiful.com/e/${id}`;
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 12000);
    const res = await fetch(url, { signal: c.signal, headers: { "User-Agent": UA, Accept: "text/html" } });
    clearTimeout(t);
    if (!res.ok) return { id, error: `http ${res.status}` };
    const html = await res.text();
    const m = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json">\s*([\s\S]*?)\s*<\/script>/);
    if (!m) return { id, error: "no __NEXT_DATA__" };
    const pp = JSON.parse(m[1])?.props?.pageProps ?? {};
    const ev = pp.event ?? {};
    return {
      id,
      title: ev.title ?? "",
      startDate: ev.startDate ?? null,
      region: pp.similarEventsRegion ?? null,
      similar: (pp.similarEvents ?? []).map((s) => ({ id: s.id, title: s.title ?? "", startDate: s.startDate ?? null })),
    };
  } catch (err) {
    return { id, error: err.name === "AbortError" ? "timeout" : err.message };
  }
}

// ---------- crawl ----------
const seedIds = [...new Set(Object.values(links).map((u) => (u.match(/partiful\.com\/e\/([A-Za-z0-9_-]+)/) || [])[1]).filter(Boolean))];
const queue = [];
const seen = new Set(Object.keys(graph));
for (const id of seedIds) if (!seen.has(id)) { seen.add(id); queue.push(id); }
// Also re-expand already-crawled nodes' unseen neighbours (resume support).
for (const node of Object.values(graph)) for (const s of node.similar ?? []) if (!seen.has(s.id) && inWindow(s.startDate)) { seen.add(s.id); queue.push(s.id); }

function inWindow(startDate) {
  if (!startDate) return true; // unknown date: allow, the page fetch will tell
  const t = new Date(startDate).getTime();
  return t >= windowStart && t <= windowEnd;
}

log(`official: ${official.length} events, ${unresolved().length} unresolved; seeds: ${seedIds.length}; queue: ${queue.length}; graph: ${Object.keys(graph).length}`);

let fetched = 0, matched = 0, active = 0;
const t0 = Date.now();
let lastSave = Date.now();
function save() {
  fs.writeFileSync(LINKS_FILE, JSON.stringify(links, null, 1));
  fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph));
  lastSave = Date.now();
}

await new Promise((resolve) => {
  function pump() {
    while (active < CONCURRENCY && queue.length > 0 && fetched < MAX_FETCHES) {
      const id = queue.shift();
      active++;
      fetchPartiful(id).then((node) => {
        fetched++;
        active--;
        graph[id] = node;
        if (!node.error) {
          const hit = matchOfficial(node);
          if (hit) { links[hit.event.id] = `https://partiful.com/e/${id}`; matched++; }
          // Expand only within the edition window so we don't wander off into
          // all of Partiful. Similar events carry dates, so we can prune early.
          for (const s of node.similar) {
            if (!seen.has(s.id) && inWindow(s.startDate)) { seen.add(s.id); queue.push(s.id); }
          }
        }
        if (fetched % 50 === 0) {
          log(`crawl: ${fetched} fetched, ${queue.length} queued, ${matched} matched, ${unresolved().length} still unresolved (${((Date.now() - t0) / fetched / 1000).toFixed(2)}s each)`);
        }
        if (Date.now() - lastSave > 20000) save();
        if (queue.length === 0 && active === 0) resolve();
        else if (fetched >= MAX_FETCHES && active === 0) resolve();
        else pump();
      });
    }
    if (queue.length === 0 && active === 0) resolve();
  }
  pump();
});

save();
const left = unresolved();
log(`done: ${fetched} pages fetched in ${Math.round((Date.now() - t0) / 1000)}s, ${matched} new matches, ${Object.keys(links).length}/${official.length} links known, ${left.length} unresolved`);
if (left.length) log("unresolved sample:", left.slice(0, 8).map((e) => e.name).join(" | "));
