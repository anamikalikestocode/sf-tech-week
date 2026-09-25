#!/usr/bin/env node
/**
 * Tech Week scraper — pulls every event for a city from tech-week.com, resolves
 * the obfuscated /go/event/<token> links to their real Partiful URLs, then
 * scrapes each Partiful page for the guest / application data the official
 * site doesn't show. Writes data/<city>-events.json and (if Supabase env is
 * present) uploads the same JSON to the public `techweek` storage bucket that
 * the site reads from.
 *
 * Why a real browser: since June 2026 tech-week.com sits behind Vercel's
 * bot challenge (plain fetches get a 429 "Security Checkpoint"), and the
 * /go/event/ redirect returns 403 unless the request is a user-initiated
 * navigation. So we drive the locally installed Google Chrome with Playwright,
 * call the site's own tRPC endpoint from inside the page, and resolve each
 * link with a genuine click (popup + intercept the 302). Partiful itself only
 * blocks one specific User-Agent string, so those pages are fetched directly.
 *
 * Usage:
 *   node scripts/scrape-techweek.mjs sf            # full run
 *   node scripts/scrape-techweek.mjs sf --no-upload
 *   node scripts/scrape-techweek.mjs sf --limit 50 # smoke test
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const CITY = args.find((a) => !a.startsWith("--")) ?? "sf";
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const LIMIT = Number(opt("limit", 0)) || 0;
const NO_UPLOAD = flag("no-upload");
const HEADLESS = flag("headless"); // headless Chrome tends to trip the Vercel challenge; default headed

// --profile <dir>: use a separate Chrome profile (lets a --list-only refresh run
// while the unattended runner owns the default profile).
const PROFILE_DIR = path.resolve(ROOT, opt("profile", ".playwright-profile"));
const DATA_DIR = path.join(ROOT, "data");
const LINKS_FILE = path.join(DATA_DIR, `${CITY}-links.json`);
const OUT_FILE = path.join(DATA_DIR, `${CITY}-events.json`);
const CALENDAR_URL = `https://www.tech-week.com/calendar/${CITY}`;
const PER_PAGE = 48;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

fs.mkdirSync(DATA_DIR, { recursive: true });
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

// ---------- .env.local (no dotenv dependency) ----------
function loadEnv() {
  const f = path.join(ROOT, ".env.local");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

// ---------- 1. Pull the full event list via the site's own tRPC endpoint ----------
async function fetchAllEvents(page) {
  const all = [];
  let total = null;
  for (let cursor = 1; cursor <= 60; cursor++) {
    const data = await page.evaluate(
      async ({ city, cursor }) => {
        const body = JSON.stringify({
          0: { city, q: "", featured: false, day: "all", track: [], sponsor: [], theme: [], format: [], location: [], time: [], host: [], sortBy: "time", sortOrder: "asc", cursor, direction: "forward" },
        });
        const r = await fetch("/api/trpc/calendar.events?batch=1", { method: "POST", headers: { "content-type": "application/json" }, body });
        if (!r.ok) return { error: r.status };
        return (await r.json())[0]?.result?.data ?? { error: "no data" };
      },
      { city: CITY, cursor }
    );
    if (data.error) throw new Error(`tRPC page ${cursor} failed: ${data.error}`);
    total ??= data.total;
    all.push(...data.results);
    if (cursor === 1) log(`tRPC: ${data.total} events, ${data.perPage ?? PER_PAGE}/page, edition ${data.editions?.[0]?.slug}`);
    if (data.results.length < (data.perPage ?? PER_PAGE)) break;
    await page.waitForTimeout(150);
  }
  // de-dupe by id (pagination can shift while events are added)
  const seen = new Map();
  for (const e of all) seen.set(e.id, e);
  log(`tRPC: fetched ${seen.size} unique events (reported total ${total})`);
  return { events: [...seen.values()], editions: [] };
}

// ---------- 2. Resolve /go/event/<token> -> real URL via trusted clicks ----------
async function resolveLinks(ctx, page, events, cache, { attempts = 4 } = {}) {
  const todo = events.filter((e) => e.externalHref?.startsWith("/go/event/") && !cache[e.id]);
  log(`resolve: ${todo.length} links to resolve (${Object.keys(cache).length} cached)`);
  if (todo.length === 0) return;

  // Block every off-site request context-wide: the popup's redirect target
  // (partiful.com etc.) is aborted so we never actually load it; the 302's
  // Location header is all we need.
  await ctx.route((url) => !/(^|\.)tech-week\.com$/.test(url.hostname), (route) => route.abort("blockedbyclient"));

  await page.evaluate(() => {
    if (document.getElementById("__resolver")) return;
    const a = document.createElement("a");
    a.id = "__resolver";
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "resolver";
    a.style.cssText = "position:fixed;top:0;left:0;z-index:2147483647;background:#0A8F5A;color:#fff;padding:6px 10px;font:12px monospace";
    document.body.appendChild(a);
  });

  // One trusted click -> popup -> 302. Returns the Location header, or the
  // HTTP status when there was no redirect (429 = rate limited, 403 = blocked).
  async function clickOnce(href) {
    const token = href.split("/go/event/")[1];
    await page.evaluate((h) => { document.getElementById("__resolver").href = h; }, href);
    const popupP = ctx.waitForEvent("page", { timeout: 15000 }).catch(() => null);
    const respP = new Promise((resolve) => {
      const h = (resp) => {
        if (resp.url().includes(token)) { ctx.off("response", h); resolve(resp); }
      };
      ctx.on("response", h);
      setTimeout(() => { ctx.off("response", h); resolve(null); }, 15000);
    });
    await page.click("#__resolver", { timeout: 5000 });
    const [popup, resp] = await Promise.all([popupP, respP]);
    await popup?.close().catch(() => {});
    const loc = resp?.headers()["location"];
    if (resp && resp.status() >= 300 && resp.status() < 400 && loc) return { loc };
    return { status: resp?.status() ?? 0 };
  }

  // The /go/ endpoint rate-limits bursts (429 after ~20 quick hits), so pace
  // clicks and back off when we get throttled. Nothing here is time-critical.
  const PACE_MS = Number(opt("pace", 1100));
  let done = 0, failed = 0, backoff = 0, consecutiveBlocked = 0;
  const t0 = Date.now();
  for (const e of todo) {
    let result = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        result = await clickOnce(e.externalHref);
      } catch (err) {
        result = { status: 0, err: err.message.split("\n")[0] };
      }
      if (result.loc) break;
      if (result.status === 403 && done === 0 && attempt === 0 && attempts > 1 && Object.keys(cache).length === 0) {
        throw new Error("/go/ link returned 403 on the very first click — the Vercel challenge probably failed. Run without --headless.");
      }
      if (result.status === 403) {
        // 403 = the WAF has escalated to a block. One retry after 30s to rule
        // out a per-link fluke, then give up on this link fast — long backoffs
        // here only extend the block.
        if (attempt >= 1) break;
        log(`  ~ 403 on "${e.name.slice(0, 40)}" — retrying once in 30s`);
        await page.waitForTimeout(30000);
        continue;
      }
      // Throttled (429) or transient: wait progressively longer, then retry.
      backoff = Math.min(60000, (backoff || 5000) * 2);
      log(`  ~ ${result.status || result.err} on "${e.name.slice(0, 40)}" — backing off ${backoff / 1000}s`);
      await page.waitForTimeout(backoff);
    }
    if (result?.loc) {
      cache[e.id] = result.loc;
      backoff = Math.max(0, backoff - 5000);
      consecutiveBlocked = 0;
    } else {
      failed++;
      log(`  ! gave up on ${e.name.slice(0, 50)} (${result?.status || result?.err})`);
      // Three 403s in a row means the WAF has escalated from rate-limiting to
      // an IP block. Stop clicking (every further attempt just extends the
      // block), keep what we have, and let the rest of the pipeline run so
      // the site still gets fresh Partiful data for the links we know.
      if (result?.status === 403 && ++consecutiveBlocked >= 2) {
        log("resolve: IP appears blocked on /go/event/ — stopping link resolution for this run");
        break;
      }
    }
    done++;
    if (done % 25 === 0 || done === todo.length) {
      fs.writeFileSync(LINKS_FILE, JSON.stringify(cache, null, 1));
      const rate = (Date.now() - t0) / done;
      log(`resolve: ${done}/${todo.length} (${failed} failed, ${(rate / 1000).toFixed(2)}s each, ~${Math.round(((todo.length - done) * rate) / 60000)} min left)`);
    }
    await page.waitForTimeout(PACE_MS);
  }
  await ctx.unroute(() => true);
}

// Dollar amounts in a description that look like TICKET prices: within ~60
// chars of a ticket word, not "$300 off" / "$300 gift bag" / "$31M raised".
function extractTicketPrices(desc) {
  const out = new Set();
  const re = /\$\s?(\d{1,4})(?:\.\d{2})?(?![\d,.]*\s?(?:[MKBmkb]\b|%|million|billion|k\b))/g;
  let m;
  while ((m = re.exec(desc))) {
    const n = Number(m[1]);
    if (n < 1 || n > 2000) continue;
    const before = desc.slice(Math.max(0, m.index - 70), m.index).toLowerCase();
    const after = desc.slice(m.index + m[0].length, m.index + m[0].length + 40).toLowerCase();
    if (/^\s*(off|value|gift|credit|worth|in credits|prize|raised)/.test(after)) continue;
    if (/(raised|credits?|prize|worth|value|gift|off|fund|capital|deploy)/.test(before.slice(-40)) && !/(ticket|admission|price|pricing|pass|entry|register)/.test(before)) continue;
    const ctx = before + " " + after;
    if (/(ticket|admission|entry|pass\b|price|pricing|early.?bird|general admission|\bga\b|vip|register|registration|seat|per person|cost)/.test(ctx)) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

// ---------- 3. Scrape Partiful pages ----------
async function scrapePartiful(url) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" } });
    clearTimeout(t);
    if (!res.ok) return { error: `http ${res.status}` };
    const html = await res.text();
    const m = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json">\s*([\s\S]*?)\s*<\/script>/);
    if (!m) return { error: "no __NEXT_DATA__" };
    const pp = JSON.parse(m[1])?.props?.pageProps;
    const ev = pp?.event;
    if (!ev) return { error: "no event" };
    const c = ev.guestStatusCounts ?? {};
    const approved = c.APPROVED ?? ev.approvedGuestCount ?? 0;
    const going = c.GOING ?? ev.goingGuestCount ?? 0;
    const pending = c.PENDING_APPROVAL ?? 0;
    const rejected = c.REJECTED ?? 0;
    const waitlistedForApproval = c.WAITLISTED_FOR_APPROVAL ?? 0;
    const interested = c.INTERESTED ?? ev.interestedGuestCount ?? 0;
    const waitlist = c.WAITLIST ?? ev.waitlistGuestCount ?? 0;
    const maybe = c.MAYBE ?? ev.maybeGuestCount ?? 0;
    const declined = c.DECLINED ?? 0;
    const withdrawn = c.WITHDRAWN ?? 0;
    const applied = approved + pending + rejected + waitlistedForApproval;
    const guestAction = ev.guestAction ?? "RSVP";
    return {
      partifulId: ev.id ?? null,
      title: ev.title ?? "",
      guestAction,
      // headline confirmed count: APPLY events -> approved, RSVP events -> going
      guestCount: guestAction === "APPLY" ? approved : going > 0 ? going : approved,
      approvedCount: approved,
      goingCount: going,
      pendingCount: pending,
      rejectedCount: rejected,
      waitlistedForApprovalCount: waitlistedForApproval,
      interestedCount: interested,
      waitlistCount: waitlist,
      maybeCount: maybe,
      declinedCount: declined,
      withdrawnCount: withdrawn,
      appliedCount: applied,
      acceptanceRate: guestAction === "APPLY" && applied > 0 ? approved / applied : null,
      // Partiful zeroes every count when the host hides the guest count.
      countsHidden: ev.showGuestCount === false,
      atCapacity: ev.atCapacity ?? false,
      isCapped: ev.isCapped ?? false,
      maxCapacity: ev.maxCapacity ?? null,
      rsvpsEnabled: ev.rsvpsEnabled ?? false,
      enableWaitlist: ev.enableWaitlist ?? false,
      questionnaireEnabled: ev.questionnaireEnabled ?? false,
      hasTickets: !!ev.ticketing || (Array.isArray(ev.ticketTypes) && ev.ticketTypes.length > 0),
      startDate: ev.startDate ?? null,
      endDate: ev.endDate ?? null,
      timezone: ev.timezone ?? null,
      neighborhood: ev.locationInfo?.neighborhood ?? null,
      locationName: ev.locationInfo?.name ?? ev.locationInfo?.address ?? null,
      description: (ev.description ?? "").slice(0, 2000),
      imageUrl: ev.image?.url ?? null,
      hosts: (pp.hosts ?? []).map((h) => h.name).filter(Boolean),
      similarEventIds: (pp.similarEvents ?? []).map((s) => s.id),

      // ---- The good stuff: everything else the page leaks. ----
      // Exact spots left (Partiful computes it; beats cap - going).
      remainingCapacity: typeof ev.remainingCapacity === "number" ? ev.remainingCapacity : null,
      // Check-ins after the event.
      attendedCount: ev.attendedGuestCount ?? 0,
      // Plus-ones: how many people one RSVP can bring.
      maxCountPerGuest: ev.maxCountPerGuest ?? 1,
      plusOneNamesRequired: ev.plusOneNamesRequired ?? false,
      allowGuestsToInviteMutuals: ev.allowGuestsToInviteMutuals ?? false,
      showGuestList: ev.showGuestList ?? false,
      disableMaybe: ev.disableMaybe ?? false,
      // Full street address (the official site only shows the neighborhood).
      address: ev.location ?? ev.locationInfo?.value ?? null,
      mapsUrl: ev.locationInfo?.mapsInfo?.googleMapsUrl ?? null,
      approximateLocation: ev.locationInfo?.mapsInfo?.approximateLocation ?? null,
      // Lifecycle: when it was posted / last touched.
      createdAt: ev.createdAt ?? null,
      publishedAt: ev.publishedAt ?? null,
      updatedAt: ev.updatedAt ?? null,
      rsvpDeadline: ev.rsvpDeadline ?? null,
      // Page vibe.
      theme: ev.displaySettings?.theme ?? null,
      titleFont: ev.displaySettings?.titleFont ?? null,
      effect: ev.displaySettings?.effect ?? null,
      imageBlurHash: ev.image?.blurHash ?? null,
      // Paid events: Partiful takes feeRate + flatFee (cents) per ticket.
      ticketing: ev.ticketing
        ? {
            type: ev.ticketing.type ?? null,
            feeRate: ev.ticketing.feeConfig?.feeRate ?? null,
            flatFeeCents: ev.ticketing.feeConfig?.flatFee ?? null,
            // Single-price events expose the price (dollars); tiered ones don't,
            // but usually list tiers in the description ("$95 / $125 / $400").
            price: typeof ev.ticketing.price === "number" ? ev.ticketing.price : null,
            currency: ev.ticketing.currency ?? null,
            descriptionPrices: extractTicketPrices(ev.description ?? ""),
          }
        : null,
      // The application form itself: what you have to answer to get in.
      questions: (ev.questionnaire?.questions ?? []).map((q) => ({ text: q.text ?? "", type: q.type ?? null, required: !!q.required, options: Array.isArray(q.options) ? q.options.map((o) => (typeof o === "string" ? o : o?.text ?? o?.value ?? "")).filter(Boolean) : undefined })),
      questionnaireVersions: Array.isArray(ev.questionnaireVersions) ? ev.questionnaireVersions.length : 0,
      customSections: (ev.customSections ?? []).map((c) => ({ title: c.title ?? "", value: (c.value ?? "").slice(0, 1500) })),
      // Who's actually behind it (names + socials; owners link events by the same account).
      // Host name, id and photo are shown on the public page. Bios and social
      // handles are marked mutuals-only by Partiful, so they are never stored.
      hostProfiles: (pp.hosts ?? []).map((h) => ({
        id: h.id ?? null,
        name: h.name ?? "",
        photoUrl: h.photo?.url ?? null,
      })),
      ownerIds: ev.ownerIds ?? [],
      publicShortUrl: ev.publicShortUrl ?? null,
      calendarFile: ev.calendarFile ?? null,
    };
  } catch (err) {
    return { error: err.name === "AbortError" ? "timeout" : err.message };
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

// ---------- 3b. Live guest tally via api.partiful.com ----------
// The page snapshot zeroes every count when a host hides the guest count, but
// the app's own live API (getGuests) still returns one row per approved /
// going / waitlisted guest. We count rows by status and DISCARD them: only
// aggregates are kept (no names, ids or per-guest data ever hit disk).
// Pending / rejected applicants are not in this list, so acceptance rates
// remain unavailable. Rows carry an RSVP timestamp -> RSVP velocity per day.
async function tallyGuests(partifulId) {
  const counts = {}, perDay = {};
  let rows = 0, plusOnes = 0, cursor = null;
  for (let page = 0; page < 40; page++) {
    let json;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 20000);
      const r = await fetch("https://api.partiful.com/getGuests", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", origin: "https://partiful.com", referer: "https://partiful.com/", "user-agent": UA },
        body: JSON.stringify({ data: { params: { eventId: partifulId, includeInvitedGuests: true }, paging: { cursor, maxResults: 500 }, userId: null } }),
      });
      clearTimeout(t);
      if (!r.ok) return { error: `http ${r.status}` };
      json = await r.json();
    } catch (err) {
      return { error: err.name === "AbortError" ? "timeout" : err.message };
    }
    const res = json?.result;
    const d = res?.data;
    const arr = Array.isArray(d) ? d : (d?.guests ?? []);
    for (const x of arr) {
      rows++;
      counts[x.status] = (counts[x.status] ?? 0) + 1;
      plusOnes += x.plusOneCount ?? 0;
      const day = (x.rsvpDate ?? "").slice(0, 10);
      if (day) perDay[day] = (perDay[day] ?? 0) + 1;
    }
    const next = res?.paging?.nextCursor ?? res?.paging?.cursor ?? res?.nextCursor ?? d?.nextCursor ?? null;
    if (!next || arr.length === 0 || next === cursor) break;
    cursor = next;
  }
  return { counts, perDay, rows, plusOnes };
}

// ---------- 4. Upload ----------
async function upload(json) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { log("upload: no Supabase env, skipping"); return; }
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets?.some((b) => b.name === "techweek")) {
    const { error } = await sb.storage.createBucket("techweek", { public: true });
    if (error) { log("upload: createBucket failed:", error.message); return; }
    log("upload: created public bucket `techweek`");
  }
  const { error } = await sb.storage.from("techweek").upload(`${CITY}-events.json`, Buffer.from(json), { contentType: "application/json", upsert: true, cacheControl: "300" });
  if (error) log("upload: failed:", error.message);
  else log(`upload: ok -> ${url}/storage/v1/object/public/techweek/${CITY}-events.json`);
}

// ---------- main ----------
const t0 = Date.now();
const cache = fs.existsSync(LINKS_FILE) ? JSON.parse(fs.readFileSync(LINKS_FILE, "utf8")) : {};

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { channel: "chrome", headless: HEADLESS, viewport: { width: 1200, height: 800 } });
let events;
try {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(CALENDAR_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('a[href*="/go/event/"]', { timeout: 45000 });
  log(`calendar loaded: ${await page.title()}`);
  ({ events } = await fetchAllEvents(page));
  if (LIMIT) events = events.slice(0, LIMIT);
  // --list-only: refresh the official list + Partiful data for links we
  // already know, but don't click any /go/event/ links (useful while the
  // redirect endpoint has us rate-limited; see scripts/crawl-partiful-graph.mjs).
  // --probe: click exactly ONE uncached link and exit 0/1 — used to poll for
  // the end of an IP block without burning more of the rate budget.
  if (flag("probe")) {
    const next = events.find((e) => e.externalHref?.startsWith("/go/event/") && !cache[e.id]);
    if (!next) { log("probe: nothing left to resolve"); process.exit(0); }
    await resolveLinks(ctx, page, [next], cache, { attempts: 1 });
    fs.writeFileSync(LINKS_FILE, JSON.stringify(cache, null, 1));
    const ok = !!cache[next.id];
    log(`probe: ${ok ? "OK — block lifted" : "still blocked"}`);
    await ctx.close().catch(() => {});
    process.exit(ok ? 0 : 1);
  }
  if (!flag("list-only")) await resolveLinks(ctx, page, events, cache);
} finally {
  await ctx.close().catch(() => {});
}
fs.writeFileSync(LINKS_FILE, JSON.stringify(cache, null, 1));

const hosts = {};
for (const e of events) { const u = cache[e.id]; if (u) { try { hosts[new URL(u).hostname] = (hosts[new URL(u).hostname] || 0) + 1; } catch {} } }
log("link hosts:", JSON.stringify(hosts));

const partifulTargets = events.filter((e) => cache[e.id]?.includes("partiful.com"));
log(`partiful: scraping ${partifulTargets.length} pages`);
let n = 0, errs = 0;
const scraped = await pool(partifulTargets, 12, async (e) => {
  const r = await scrapePartiful(cache[e.id]);
  n++;
  if (r.error) errs++;
  if (n % 100 === 0 || n === partifulTargets.length) log(`partiful: ${n}/${partifulTargets.length} (${errs} errors)`);
  return r;
});
const byId = new Map(partifulTargets.map((e, i) => [e.id, scraped[i]]));

// Live tally for every event we have a Partiful id for (aggregates only).
const liveTargets = partifulTargets.filter((e) => byId.get(e.id)?.partifulId);
log(`live: tallying guests for ${liveTargets.length} events via api.partiful.com`);
let ln = 0, lerr = 0;
await pool(liveTargets, 8, async (e) => {
  const p = byId.get(e.id);
  const t = await tallyGuests(p.partifulId);
  ln++;
  if (t.error) { lerr++; p.liveError = t.error; }
  else {
    const c = t.counts;
    const approved = c.APPROVED ?? 0, going = c.GOING ?? 0, waitlist = c.WAITLIST ?? 0;
    p.liveCounts = c;
    p.liveRows = t.rows;
    p.plusOnesTotal = t.plusOnes;
    p.rsvpsPerDay = t.perDay;
    p.liveFetchedAt = new Date().toISOString();
    // Prefer the live list: it's fresher than the page snapshot and it is the
    // ONLY source for events whose host hid the count. Party size counts
    // plus-ones like Partiful's own goingGuestCount does.
    if (p.countsHidden) p.countsReconstructed = true;
    p.countsHidden = false;
    p.approvedCount = approved;
    p.goingCount = going + t.plusOnes;
    p.waitlistCount = waitlist;
    p.guestCount = p.guestAction === "APPLY" ? approved : going + t.plusOnes;
    p.appliedCount = approved + (p.pendingCount ?? 0) + (p.rejectedCount ?? 0) + (p.waitlistedForApprovalCount ?? 0);
    if (p.isCapped && p.maxCapacity) p.remainingCapacity = Math.max(0, p.maxCapacity - p.guestCount);
  }
  if (ln % 200 === 0 || ln === liveTargets.length) log(`live: ${ln}/${liveTargets.length} (${lerr} errors)`);
});

const out = {
  city: CITY,
  scrapedAt: new Date().toISOString(),
  events: events.map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date,
    time: e.time,
    location: e.location ?? "",
    company: e.company ?? "",
    url: cache[e.id] ?? "",
    goHref: e.externalHref ?? "",
    isInviteOnly: !!e.isInviteOnly,
    isFeatured: !!e.isFeatured,
    registrationStatus: e.registrationStatus ?? null,
    imageUrl: e.imageUrl ?? null,
    sponsors: (e.sponsors ?? []).map((s) => s.name),
    hosts: (e.facets?.hosts ?? []).map((h) => h.label),
    timeLabel: e.facets?.time?.label ?? null,
    partiful: byId.get(e.id) && !byId.get(e.id).error ? byId.get(e.id) : null,
    partifulError: byId.get(e.id)?.error ?? null,
  })),
};
const json = JSON.stringify(out);
fs.writeFileSync(OUT_FILE, json);
const withData = out.events.filter((e) => e.partiful).length;
const reconstructed = out.events.filter((e) => e.partiful?.countsReconstructed).length;
const apply = out.events.filter((e) => e.partiful?.guestAction === "APPLY");
const withRate = apply.filter((e) => e.partiful.acceptanceRate !== null);
log(`done in ${Math.round((Date.now() - t0) / 1000)}s: ${out.events.length} events, ${withData} with Partiful data, ${apply.length} application-based, ${withRate.length} with a real acceptance rate, ${reconstructed} hidden counts reconstructed -> ${path.relative(ROOT, OUT_FILE)}`);
if (!NO_UPLOAD) await upload(json);
