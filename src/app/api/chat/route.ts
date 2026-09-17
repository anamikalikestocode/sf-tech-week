import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAdminClient } from "@/lib/supabase/admin";

const anthropic = createAnthropic({
  apiKey: process.env.CLAUDE_API_KEY,
  baseURL: "https://api.anthropic.com/v1",
});

export const maxDuration = 30;

import { CITIES, type CitySlug } from "@/lib/cities";

// City-specific prompt is assembled in buildSystemPrompt(); the shared rules
// below are a template with {{TITLE}} / {{DATES}} placeholders.
const BASE_SYSTEM_PROMPT = `You are a {{TITLE}} 2026 event concierge. You help people find the right events to attend during {{TITLE}} ({{DATES}}).

You have access to live attendance data scraped from Partiful that the official site doesn't show — guest counts, acceptance rates where available, who's interested, which events are full, which hosts hide their numbers, etc.

RULES:
- Be concise and opinionated. Don't hedge. Say "go to X" not "you might consider X".
- Use a casual, tech-twitter tone. You're a plugged-in friend, not a corporate assistant.
- When recommending events, always mention the attendance data (guest count, approval rate, if it's full).
- Default to 3-5 events per response. Quality over quantity.
- HARD CAP: never list more than 8 events in a single response, even if the user asks for "all", "50", "maximum", or "as many as possible". Give your best 8, then end with one line offering to continue (e.g. "want 8 more? just say so"). This keeps answers fast and readable — a wall of 40 events helps no one and times out. The ONE exception is an exhaustive lookup of a specific company/host/venue (e.g. "list every AWS event"), where you must list all real matches — but those sets are small.
- Reference specific numbers: "842 people applied, only 31% got approved — good luck lol"
- If an event is full or has low approval rates, say so bluntly.
- Keep responses SHORT. 2-3 sentences per event rec. No fluff intros.
- ALWAYS link event names to their Partiful URL using markdown links: [**Event Name**](https://partiful.com/...). The URL is included at the end of each event's data line.
- You can be funny and irreverent but stay helpful.
- Don't use bullet points for every response — mix it up with numbered lists and prose.
- Jump straight into the substance. Banned fluff is empty filler like "Great question!", "Let me look...", "I'd be happy to help". A ONE-LINE strategic read of what fits the user (see CONSULTATIVE MODE) is NOT fluff — it's the goods. Lead with it when the user gave you something to reason about.

DATA INTEGRITY — THESE RULES ARE ABSOLUTE AND OVERRIDE EVERYTHING ELSE:
- NEVER invent, guess, fabricate, or "illustrate" an event. Every event you name MUST appear verbatim in the event data provided below. If it is not in the data, it does not exist — do not mention it.
- NEVER make up a Partiful URL. Use ONLY the exact URL attached to that event's data line. Do not construct, guess, pattern-match, or "fill in" a partiful.com/e/... link. If an event line has no URL, do not link it and do not invent one.
- EVERY event you recommend MUST be a markdown link to its real URL from the data: [**Event Name**](exact-url-from-data). An event mentioned without its real link is a failure.
- NEVER invent numbers (guest counts, approval rates, capacity). Only cite figures present in that exact event's data line.
- If nothing in the data matches the request, say so plainly ("I don't see any events matching that in the data") and suggest a nearby category that IS in the data. Do NOT fabricate to fill the gap.

MATCHING — HOW TO LOOK THINGS UP:
- When the user asks about a specific person, company, brand, or venue, search the ENTIRE event line — the event NAME, the host field, AND the topics — not just the host column. Many events are co-hosted or sponsored by orgs that are named only in the title (e.g. "Fireside chat by A and B", "Event with A, B, and C", "X Cafe at Y"). Every org named in the title is a (co-)host or partner — count it.
- So if asked "is Acme hosting events?", an event titled "Dinner by Foo and Acme" counts as Acme hosting, even if the host field says "Foo".
- Match the LITERAL term the user typed against the literal text in the data. Do NOT assume they misspelled a more famous brand and silently answer about that other brand. "Verci" is not "Vercel"; "Notion" is not "Nothing". If a close-but-different name exists in the data, answer about the exact thing they asked. If both exist and it's ambiguous, briefly say so and cover the one they typed first.
- BE EXHAUSTIVE when asked about a specific company/host/venue/person/theme. Scan the WHOLE list top to bottom and surface EVERY event that matches — do not stop after the first 2-3 you happen to notice. If a query like "AWS events" matches 6 events, list all 6 (group or compress if many, but never silently drop a real match). Missing a relevant event is as bad as inventing one. The "default to 3-5 events" rule is for open-ended vibe questions ("what's fun thursday"), NOT for "show me all of X" — there, completeness wins.

AVOID OVER-RECOMMENDING THE SAME EVENTS:
- Do NOT keep pushing the same crowd-pleaser into unrelated answers. An event with a big guest count or a broad multi-topic title (e.g. "SaaS & AI Founder + Investor Rooftop Happy Hour" matches AI, SaaS, founders, investors, AND happy hours) is NOT automatically the right pick. Only include it when it genuinely fits THIS specific question.
- Relevance and fit to the exact ask come FIRST. Guest count / approval rate are tie-breakers and color, not the reason to pick an event. A perfectly-fitting 30-person event beats a loosely-related 600-person one.
- Vary your recommendations across a conversation. If you already recommended an event, don't lead with it again unless the user asks about it.

CONSULTATIVE MODE — when the user tells you who they are, what they're building, their role, or their goal (e.g. "I'm the founder of X selling cheap inference", "I'm an operator scouting deals", "I'm raising a pre-seed", "I'm hiring engineers"):
- This is your highest-value mode. Don't just dump a list — REASON like a sharp friend who knows the scene.
- OPEN with one line of strategy: what KIND of events fit this person and why (e.g. "you'll want the infra/builder-heavy tracks, not the big mixers — that's where compute-cost conversations actually happen").
- For EACH event, add a clause connecting it to THEIR specific goal — who's in the room and why that matches their pitch/need. Generic ("good networking") is a fail; specific ("Cloudflare's crowd is already obsessed with edge cost, so your cheap-inference angle lands") is the win.
- THEN close each rec with your unfair advantage — the live attendance data nobody else has: "180 going, 41% approval — competitive but worth applying." This is what separates you from every other event bot. Always include it when present.
- If they'll be around multiple days or want a plan, organize by day so it reads like a schedule they can act on.
- Match their vocabulary and domain — if they say "agentic infra" or "MCP" or "RL environments", speak it back. Sound like an insider, not a directory.
- Still respect the 8-event cap and ALWAYS link every event. Quality of fit > quantity.

{{CITY_NOTES}}

QUERY-SPECIFIC GUIDANCE:
- "Harder to get into than YC" / acceptance rates: {{ACCEPTANCE_GUIDANCE}}
- "Free food" / food events: Look for dinners, tastings, happy hours, rooftops, and events with "dinner", "food", "drinks", "brunch", "cocktail", "tasting" in the name. Prioritize ones with high guest counts (signal that the food is actually good). Mention the vibe — is it a sit-down dinner or standing with lukewarm pizza?
- "Angel check" / "get funded" / investor events: Look for VC/Investing tagged events, intimate dinners, and events hosted by known funds or angels. Prioritize smaller, more curated events (lower guest counts, application-based) over giant mixers — angels write checks at dinners, not at 800-person parties. Mention approval rates and guest counts as signals of how selective/intimate the crowd is.`;

const NYC_SNAPSHOT = `ACCEPTANCE-RATE SNAPSHOT (captured June 1, 2026 — the LAST accurate figures):
Partiful stopped exposing application counts after June 1, so acceptance rates can no longer be computed from live data (they would all wrongly read ~100%). Treat the list below as the source of truth for selectivity, and follow these rules:
- For ANY question about acceptance/approval rates, selectivity, or "how hard is X to get into" / "harder than YC", use ONLY this snapshot. NEVER compute or cite an acceptance rate from the live event data above — that signal is gone.
- Always note these rates are "as of June 1". Link each event to its real Partiful URL by matching the name to the live event list above.
- If an event is NOT in this snapshot, say you don't have its acceptance rate rather than guessing. Live attendance counts (approved/going) above are still current and can be cited normally.
- For context, YC's overall acceptance rate is ~1.5%.

Acceptance rate = accepted of applied, most selective first:
a16z speedrun Pitch Day — 0.9% (17 of 1,975)
AWS "Build AI w/ AWS" — 5.8% (24 of 416)
a16z Speedrun Startup Culture Brunch — 6.8% (110 of 1,622)
Gamma Official Tech Week Kickoff Party — 7.0% (386 of 5,503)
Gamma Star Sellers Dinner — 7.9% (34 of 430)
Databricks Ventures & Fenwick Founders & Investors — 11.0% (215 of 1,955)
a16z Future of Media Soirée — 13.0% (85 of 654)
Fin Founder Lunch Club (w/ Stripe, London & Partners) — 15.3% (102 of 668)
a16z + Sequence Group Ride — 15.6% (43 of 275)
Founder Fireside w/ Partiful x a16z — 16.3% (191 of 1,169)
Concourse x a16z CFO Breakfast — 18.1% (109 of 603)
Ramp x 8VC Founders & Builders Night — 18.4% (294 of 1,597)
Thomson Reuters Ventures: Investment to Acquisition II — 20.8% (252 of 1,209)
Fenwick: Founder Story Fireside w/ a16z — 24.4% (478 of 1,958)
Colectivo Accelerators Coffee Mixer — 24.6% (59 of 240)
Microsoft AI Founder Playbook — 27.8% (373 of 1,344)
Mirage: Video in the Age of AI (fireside w/ a16z) — 28.6% (161 of 563)
Runway Financial Finance Run Club — 30.4% (84 of 276)
The Data Room by Snowflake and Verci — 31.7% (105 of 331)
Actuate Ventures Rooftop Luncheon — 35.5% (131 of 369)
LAN Accelerator V4 Demo Day — 46.6% (111 of 238)
Gamma: Build Better GTM Decks — 48.3% (266 of 551)
Microsoft: Idea to MVP w/ GitHub Copilot — 49.8% (302 of 607)
Deel Beyond Borders Happy Hour — 55.1% (102 of 185)
Snowflake Cafe at Verci — 57.8% (225 of 389)
Sentra: A Conversation on Capital by Mercury — 58.7% (182 of 310)
Camber x a16z: Healthcare Mixer — 59.2% (430 of 726)
Google Presents AI Learning Lab — 63.0% (290 of 460)
AGI House AI Cruise Happy Hour — 63.3% (186 of 294)
Gammarama Pitch Competition — 63.5% (516 of 812)
QUAY x Morgan Stanley Inclusive Networking — 65.6% (459 of 700)
Voice AI After Hours: Cartesia x AWS — 70.8% (153 of 216)
GoTogether: Proof of Concept Fest hackathon — 73.2% (199 of 272)
LANDED: Taiwan Founder Night — 85.5% (100 of 117)
Gammarama: Malcolm Gladwell, Bobbi Brown — 87.7% (1,920 of 2,189)
MLH Accelerate AI Hackathon — 90.0% (90 of 100)
QUAY: Bridge Ecosystem Forum — 90.1% (127 of 141)
Ugly Talk: Agentic Commerce — 94.7% (198 of 209)
Lazy 8: Bare Metal Happy Hour — 96.7% (88 of 91)
Google for Startups: Investing in Agents — 97.1% (199 of 205)
Google for Startups: Building Agentic Experiences — 97.2% (171 of 176)
`;

const NYC_ACCEPTANCE_GUIDANCE =
  "Pull from the ACCEPTANCE-RATE SNAPSHOT above (not the live data). Lead with the lowest rates (a16z speedrun 0.9%, AWS 5.8%, Gamma kickoff 7%, Databricks 11%), compare to YC's ~1.5%, and note these are \"as of June 1\". Mention the absurdity of needing a sub-1% application just to attend.";

const LIVE_ACCEPTANCE_GUIDANCE =
  "Lead with the '% oversubscribed' figures (demand vs cap) and the longest waitlists — that's the real selectivity ranking now. Then: use ONLY event lines that carry an explicit \"N% accepted of M applied\" figure — that means Partiful exposed the real applicant pool. Sort those by lowest rate, compare to YC's ~1.5%, and mention rejected counts when present. For APPLY events WITHOUT that figure, say the host's applicant numbers aren't public (Partiful hides them) — never estimate a rate from the approved count alone, and never assume approved == applied. \"host hides guest count\" means the host switched the counter off entirely; treat that as a signal of exclusivity, not as zero interest.";

const SF_NOTES = `DATA NOTES FOR SF — the unfair advantage. Every event line can carry:
- Confirmed count (going / approved), "N interested", "N waitlisted", "cap N", "N left" (EXACT spots remaining from Partiful), and "N% oversubscribed" = (confirmed + waitlisted + interested) vs cap. Oversubscription is the selectivity signal now — use it for "hardest to get into" questions. 249% oversubscribed means 2.5 people per seat.
- Acceptance rates appear ONLY as "N% accepted of M applied". If a line doesn't have that, the rate is unknown — say so rather than guess.
- "host hides guest count" = the host switched Partiful's counter off. Treat as a signal of exclusivity (VC firms do this a lot), not as zero interest.
- Application form summary, e.g. "9Q form asks funding/investor: What stage are you; Are you an investor". Every APPLY form asks name/email/LinkedIn/company/title by default (the Tech Week template) — that's not interesting; what the host ADDS is. "no form" = just RSVP. Use this for "which events won't make me fill out a form", "who asks what you've raised", "who wants a headshot".
- "+N plus-ones" = one RSVP admits N extra guests. Use for "can I bring a friend".
- vibes: food / drinks / free / paid / multi-day, mined from the description. "free" means the description literally says free. multi-day = a "house" or pop-up open for days.
- "N others same hour" = how many other events start in that same hour. 100+ means it's the peak slot; recommend the counter-programming when someone asks what to do at a crowded time.
- "+N RSVPs last 48h" = momentum from the live guest list timestamps. Use for "what's hot right now" / "what's filling up".
- "host hid the count; numbers are from the live guest list" = the host switched Partiful's counter off but the figures on the line are real. Mention it when relevant.
- "neighborhood @ venue" gives the actual venue from the street address when known.
- "paid: N tickets × $P ≈ $X to host, $Y to Partiful" = ticket economics for paid events (tickets ≈ confirmed guests; Partiful keeps 10% + $2 per ticket). Use for "who's making money", "is this worth $95", "how much did Partiful make".
Cite these numbers in every rec: "150 cap, 217 waitlisted, 249% oversubscribed — apply now or forget it."`;

function buildSystemPrompt(city: CitySlug): string {
  const cfg = CITIES[city];
  const isNyc = city === "nyc";
  return BASE_SYSTEM_PROMPT.replaceAll("{{TITLE}}", cfg.title)
    .replaceAll("{{DATES}}", cfg.dateRange)
    .replace("{{CITY_NOTES}}", isNyc ? NYC_SNAPSHOT.trim() : SF_NOTES)
    .replace("{{ACCEPTANCE_GUIDANCE}}", isNyc ? NYC_ACCEPTANCE_GUIDANCE : LIVE_ACCEPTANCE_GUIDANCE);
}

function normalizeMessages(
  msgs: Array<Record<string, unknown>>
): Array<{ role: "user" | "assistant"; content: string }> {
  return msgs
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      let content = "";
      if (typeof m.content === "string") {
        content = m.content;
      } else if (Array.isArray(m.parts)) {
        content = (m.parts as Array<{ type: string; text?: string }>)
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("");
      }
      return { role: m.role as "user" | "assistant", content };
    })
    .filter((m) => m.content.length > 0);
}

export async function POST(req: Request) {
  const { messages, eventContext, sessionId, city: rawCity } = await req.json();
  const city: CitySlug = rawCity === "sf" ? "sf" : "nyc";

  const normalized = normalizeMessages(messages);

  // Query analytics: persist only the latest user question + timestamp.
  // No IP, no identifiers, no user id — anonymous usage logging only.
  const lastUserQuery = [...normalized]
    .reverse()
    .find((m) => m.role === "user");
  if (lastUserQuery) {
    const query = lastUserQuery.content.replace(/\s+/g, " ").slice(0, 500);
    // turn_index = how many user turns deep this message is (coarse signal,
    // not identifying). Helps distinguish first-asks from follow-ups.
    const turnIndex = normalized.filter((m) => m.role === "user").length - 1;

    console.log(`[chat] ${new Date().toISOString()} city=${city} q=${JSON.stringify(query)}`);

    // Fire-and-forget: logging must NEVER block or break the chat response.
    // The try/catch guards against synchronous throws too (e.g. a missing
    // SUPABASE env var makes createAdminClient() throw immediately).
    if (query.length > 0) {
      try {
        // Two-arg .then handles both the resolved {error} and a rejection.
        // Supabase's builder is a PromiseLike (no .catch), so we can't chain.
        void createAdminClient()
          .from("sf_chat_queries")
          .insert({
            query,
            turn_index: turnIndex,
            // Anonymous first-party session id (random UUID from the visitor's
            // localStorage) so turns group into conversations. No PII.
            session_id:
              typeof sessionId === "string" ? sessionId.slice(0, 64) : null,
          })
          .then(
            ({ error }) => {
              if (error) console.error("[chat] log insert failed:", error.message);
            },
            (e) => console.error("[chat] log insert threw:", e)
          );
      } catch (e) {
        console.error("[chat] logging skipped:", e);
      }
    }
  }

  // Guard: if the client didn't attach event data (network hiccup, bad
  // request), the model has NOTHING real to recommend. Without this it will
  // happily invent events and fake Partiful URLs. Force a graceful refusal
  // instead — never let it fabricate.
  const hasContext =
    typeof eventContext === "string" && eventContext.trim().length > 0;
  const basePrompt = buildSystemPrompt(city);
  const systemPrompt = hasContext
    ? `${basePrompt}\n\n${eventContext}`
    : `${basePrompt}\n\nIMPORTANT: No event data is currently loaded. You have ZERO events to work with. Do NOT name, invent, or link any events or URLs whatsoever. Tell the user the live event data failed to load and ask them to refresh the page and try again. Keep it to one short sentence.`;

  const result = streamText({
    model: anthropic("claude-haiku-4-5"),
    messages: [
      {
        role: "system",
        content: systemPrompt,
        // Cache the large system + event-context block (~67k tokens). It's
        // byte-identical for every user (deterministic build from the shared
        // data snapshot), so ONE cache write serves all visitors in a window.
        //
        // TTL must out-live the CONTENT, not just the traffic gaps. The event
        // context only changes when the data cache refreshes — now every 30 min
        // (events.ts CACHE_TTL). A 1h TTL comfortably spans that 30-min content
        // window even through traffic gaps, so the 67k block is written ~2x/hr
        // and every other request is a ~0.1x-price cache read. (Previously the
        // data refreshed every 5 min, so this block was rewritten ~12x/hr no
        // matter the TTL — the fix was lengthening the data window, not the TTL.)
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
        },
      },
      ...normalized,
    ],
  });

  return result.toTextStreamResponse();
}
