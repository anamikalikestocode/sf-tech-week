# SF Tech Week 2026 — a better calendar

The official a16z Tech Week site has 1,681 SF events and filters that don't
help. This is the SF edition of the NYC directory: every event, real filters,
live Partiful guest data the official site doesn't show, and a chatbot that
tells you where to go.

- Sister site (June edition): https://nyc-tech-week.vercel.app/nyc
- Stack: Next.js 15 (App Router), Tailwind 4, Vercel AI SDK + Claude Haiku 4.5,
  Supabase (storage for the data snapshot, two tables for anonymous analytics),
  Playwright for the scraper.

## Run it

```bash
cp .env.example .env.local   # fill in Supabase + CLAUDE_API_KEY
npm install
npm run dev                  # http://localhost:3000
```

The page renders from `data/sf-events.json` (a small sample is committed) until
a real scrape has been uploaded to Supabase Storage.

## How the data gets in (and why it's not scraped live)

Since June 2026 tech-week.com sits behind Vercel's bot challenge (plain fetches
get a 429 "Security Checkpoint"), and every event link is an opaque
`/go/event/<token>` redirect that returns 403 unless the request is a real,
user-initiated navigation. Partiful, for its part, blocks one specific old
Chrome/125 User-Agent (the one the NYC scraper used) but otherwise still serves
its full `__NEXT_DATA__` payload.

So `scripts/scrape-techweek.mjs`:

1. Drives your locally installed Google Chrome with Playwright (a window
   opens; headless tends to trip the challenge), loads the calendar, and calls
   the site's own tRPC endpoint from inside the page — 48 events per page,
   ~36 pages.
2. Resolves each `/go/event/` link with a genuine click (popup + read the 302
   `Location`). Resolved links are cached in `data/sf-links.json`, so re-runs
   only click events it hasn't seen. The redirect endpoint rate-limits bursts;
   the script paces itself (`--pace 1100` ms) and backs off on 429. First run
   is roughly 35 minutes; later runs are a few minutes.
3. Fetches every Partiful page directly and reads `guestStatusCounts`
   (APPROVED, GOING, PENDING_APPROVAL, REJECTED, WAITLISTED_FOR_APPROVAL,
   INTERESTED, WAITLIST, MAYBE...), `maxCapacity`, `atCapacity`,
   `showGuestCount` (hosts can hide the counter, and Partiful then zeroes every
   number), neighborhood, and host names.
4. Writes `data/sf-events.json` and uploads it to the public `techweek`
   Supabase Storage bucket (created on first run). The site reads the remote
   JSON with a 5-minute cache and falls back to the local file.

```bash
npm run scrape          # full run + upload
npm run scrape:smoke    # 40 events, no upload
node scripts/scrape-techweek.mjs sf --pace 1500   # slower if you keep hitting 429
```

Re-run every hour or so during the week to keep counts fresh.

### What the site does with it

- **Facts strip** ("Things the official site won't tell you"): one-liners
  computed from the snapshot — most oversubscribed event, busiest start hour,
  how many forms ask for LinkedIn/GitHub, how many make marketing opt-in a
  required question, hosts hiding counts, longest application form, most
  anticipated unopened event, total people on waitlists, plus-ones, median
  lead time, paid events, "free" food mentions. See `src/lib/insights.ts`.
- **Leaderboards** (collapsible): most oversubscribed, closing fastest (exact
  `remainingCapacity`), longest waitlists, biggest rooms, longest application
  forms, most FOMO, busiest venues, serial hosts, most crowded start times.
- **Sorts**: date, popular, filling fast, spots available, most oversubscribed,
  closing fast, most interest, most selective.
- **Vibes filter** (all-of): food / drinks / says "free" / plus-ones / no
  application form / waitlist open / paid / street address known / multi-day /
  host hides counts. Mined from the description and the payload.
- **Chatbot** gets every signal per event line (oversubscription, spots left,
  waitlist, form summary incl. what extra questions the host added, plus-ones,
  vibes, same-hour collisions, venue) and is told how to use them.

### The bar under every title

One bar, three colours: green = people who are in, grey = space still open,
red = people shut out. It reads real accepted / rejected whenever Partiful
exposes an applicant pool; otherwise, for capped events, green is confirmed
against the cap and red is the overflow (waitlisted + interested with no
room), labelled "shut out · 249%". Uncapped events with no applicant data get
no bar rather than a fake one.

### Money

Partiful's fee config is in the payload (10% + $2 per ticket). Single-price
events expose the price; tiered events usually list tiers in the description,
which the scraper extracts only when the amount sits next to a ticket word
(so "$300 gift bag" and "$31M raised" don't count). Tickets sold ≈ confirmed
guests. Per paid card: "$X to host · $Y to Partiful"; header stat and fact for
the totals; a "Biggest paydays" leaderboard. Half of paid events hide their
guest count, so the totals are a floor.

### What the cards show

Each card carries one bar under the title with three self-explanatory modes:
"Filling up · 38 left of 350" (green = in, grey = open), "Oversubscribed ·
211% · 166 didn't get in" (green = got in, red = shut out), and, for uncapped
events, "Popularity · top 1%" (headcount ranked against every other event).
Form-length chips were removed on purpose; the chatbot still knows each form.


- Confirmed count (going for RSVP events, approved for application events),
  plus interested / waitlisted / capacity when non-zero.
- "N left" when a capped event is within 20 of full; "Full" / "Closed".
- "Count hidden" when the host switched Partiful's counter off.
- "N% oversubscribed" (confirmed + waitlisted + interested vs cap), waitlist
  and interested counts, exact spots left, "+N guests" when plus-ones are
  allowed, "NQ form" with a tooltip listing the non-template questions and a
  red tint when the form asks what you've raised / for a headshot / requires a
  marketing opt-in, venue name from the street address with a map link, and
  "+N same hour" when 20+ other events start in the same hour.
- An acceptance ring, but only when Partiful exposes a real applicant pool
  (applied > approved). Otherwise every application event would read 100%,
  so the ring and the header stat stay hidden and the chatbot is told not to
  guess.

### Hidden counts and momentum (the live API)

The page's `__NEXT_DATA__` is only a server snapshot. After load the app calls
`api.partiful.com` (`getEventInfo`, `getGuests`, ...) unauthenticated. For
hosts who switched the guest count off, the snapshot zeroes every number but
`getGuests` still returns one row per approved / going / waitlisted guest.
The scraper tallies rows by status and per RSVP day and discards them; only
the aggregates are stored (no names, ids, or per-guest data). That rebuilds
317 of 318 hidden counts, adds plus-ones the way Partiful's own count does,
and gives RSVP velocity ("+115 in 48h"). Pending and rejected applicants are
not in that list, so acceptance rates remain unavailable.

## Privacy line

Host names are shown (they're on the public event page). Host bios and social
handles are marked mutuals-only in the payload and are deliberately not
surfaced. Guest-list rows are fetched only to be counted, in memory, and are
never written anywhere.

## Analytics tables

Run `supabase/migrations/00001_analytics.sql` once in the Supabase SQL editor.
Both tables are anonymous (random first-party session id, query text, clicked
event URL) and locked to the service-role key.

## Deploy

Push to GitHub, import into Vercel, set the four env vars from `.env.example`
plus `NEXT_PUBLIC_SITE_URL`. Nothing else to configure.

### Personal Partiful calendar import

Apply `supabase/migrations/00002_social.sql` if social accounts are not yet
installed, then `00003_partiful_calendar.sql` and
`00004_partiful_calendar_sync.sql` before deploying this feature. The latter
adds atomic service-role-only refresh/disconnect functions and keeps imported
membership visible even when attendance was entered manually.

Use the existing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
server environment variables. Calendar links are encrypted with a key derived
from the service-role secret; rotating that secret requires users to reconnect
their calendars. Never expose it through a `NEXT_PUBLIC_` variable.

Signed-in users connect through the account modal. Refresh is activity-driven:
`/api/social` refreshes feeds older than six hours; visible pages recheck social
data every five minutes and on return to the tab. There is no background cron
for inactive users. Disconnect removes the connection and calendar-derived
attendance, preserving manual attendance.

Run `npm test` for parser, encryption, API, refresh and visibility tests.
`npm run test:calendar-db` requires PostgreSQL binaries (`initdb`, `pg_ctl`,
`psql`) and runs transaction/idempotency/removal tests against a disposable local
cluster; it does not use the application's database or environment secrets.
