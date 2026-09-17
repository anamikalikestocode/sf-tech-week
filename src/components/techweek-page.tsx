import { Suspense } from "react";
import { getEvents } from "@/lib/snapshot";
import { CITIES, type CitySlug } from "@/lib/cities";
import type { TechWeekEvent } from "@/lib/events";
import { EventDirectory } from "@/components/event-directory";
import { EventCard } from "@/components/event-card";

function StatCell({
  label,
  value,
  accent,
  danger,
  title,
}: {
  label: string;
  value: string;
  accent?: boolean;
  danger?: boolean;
  title?: string;
}) {
  const valueColor = danger ? "text-[#D8442B]" : accent ? "text-[#0A8F5A]" : "text-[#1C1A14]";
  return (
    <div className="flex flex-col items-center px-5 py-3" title={title}>
      <span className={"text-xl font-extrabold tabular-nums tracking-[-0.02em] " + valueColor}>{value}</span>
      <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#766E5C]">{label}</span>
    </div>
  );
}

function confirmedCount(e: TechWeekEvent): number {
  const p = e.partiful;
  if (!p) return 0;
  return p.guestAction === "APPLY" ? p.approvedCount : p.guestCount;
}

export async function TechWeekPage({ city: slug }: { city: CitySlug }) {
  const city = CITIES[slug];
  const { events } = await getEvents(slug);

  const totalGuests = events.reduce((sum, e) => sum + confirmedCount(e), 0);
  const applyEvents = events.filter((e) => e.partiful?.guestAction === "APPLY");
  // Acceptance rate only exists when Partiful exposes a real applicant pool
  // (pending / rejected / waitlisted counts). When it hides them every APPLY
  // event would read 100%, so the stat is dropped rather than shown wrong.
  const rated = applyEvents.filter(
    (e) => typeof e.partiful?.acceptanceRate === "number" && (e.partiful.appliedCount ?? 0) > e.partiful.approvedCount
  );
  const avgAcceptance =
    rated.length > 0
      ? Math.round((rated.reduce((s, e) => s + (e.partiful!.acceptanceRate as number), 0) / rated.length) * 100)
      : null;


  return (
    <main className="min-h-screen bg-[#E9E2D3]">
      <div className="border-b border-[#DDD3BD] bg-[#E9E2D3]">
        <div className="mx-auto max-w-[1200px] px-[22px] pb-3 pt-10">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
            <div className="min-w-0">
              {/* Kicker */}
              <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#766E5C]">
                <span className="flex items-center gap-1.5">
                  <span className="relative inline-flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#00FF9C] opacity-60" />
                    <span className="relative inline-flex size-2 rounded-full bg-[#00FF9C]" />
                  </span>
                  <span className="text-[#0A8F5A]">Live</span>
                </span>
                <span>{city.dateRange}</span>
              </div>

              <h1 className="font-extrabold leading-[0.98] tracking-[-0.035em] text-[#1C1A14]" style={{ fontSize: "clamp(36px,5.4vw,60px)" }}>
                {city.title}
              </h1>

              <p className="mt-3 max-w-[600px] text-base leading-[1.55] text-[#766E5C]">
                The a16z tech week website is kinda bad, so here&apos;s a better one.
              </p>
              <p className="mt-1.5 text-sm font-medium text-[#766E5C]">
                x:{" "}
                <a
                  href="https://x.com/anamika__x"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#0A8F5A] underline underline-offset-2 transition-opacity hover:opacity-80"
                >
                  @anamika__x
                </a>
              </p>
            </div>

            {/* Stat ticker — parallel to the title on desktop, below it on phones */}
            {events.length > 0 ? (
              <div className="grid w-full shrink-0 grid-cols-2 items-stretch divide-x divide-[#CDC1A6] rounded-xl border border-[#CDC1A6] bg-[#F7F2E7] sm:mt-9 sm:flex sm:w-auto">
                <StatCell label="Events" value={events.length.toLocaleString()} />
                <StatCell label="Going" value={totalGuests.toLocaleString()} accent title="Confirmed guests across every event with Partiful data" />
                {avgAcceptance !== null && (
                  <StatCell label="Avg accepted" value={`${avgAcceptance}%`} accent title={`Across ${rated.length} application events with visible applicant pools`} />
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-[#CDC1A6] bg-[#F7F2E7] px-5 py-4 text-sm text-[#766E5C]">
                No event data loaded yet. Run <code className="rounded bg-[#E9E2D3] px-1.5 py-0.5 text-[12px]">npm run scrape:{slug}</code> to build the snapshot.
              </div>
            )}
          </div>
        </div>
      </div>

      {/*
        EventDirectory uses nuqs (useSearchParams), which opts the subtree out
        of server rendering. Give Suspense a real server-rendered fallback (the
        first 60 events) so browsers that don't finish hydrating (in-app
        browsers opened from a tweet) still see content.
      */}
      <Suspense fallback={<InitialEventGrid events={events} />}>
        <EventDirectory events={events} city={city} />
      </Suspense>
    </main>
  );
}

function InitialEventGrid({ events }: { events: TechWeekEvent[] }) {
  // Match the directory's default sort (most popular) so the server-rendered
  // fallback doesn't reshuffle when the client hydrates.
  const initial = [...events].sort((a, b) => confirmedCount(b) - confirmedCount(a)).slice(0, 60);

  return (
    <div className="min-h-screen bg-[#E9E2D3]">
      <div className="mx-auto max-w-[1200px] px-[22px] py-6">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {initial.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      </div>
    </div>
  );
}
