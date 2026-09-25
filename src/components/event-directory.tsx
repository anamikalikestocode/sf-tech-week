"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useQueryState,
  parseAsArrayOf,
  parseAsString,
} from "nuqs";
import type { TechWeekEvent } from "@/lib/events";
import type { CityConfig } from "@/lib/cities";
import { SHOW_MY_PARTIFUL, useSocial } from "./social";
import {
  demandRatio,
  spotsLeft,
  vibes,
  VIBE_LABELS,
  type Vibe,
} from "@/lib/insights";

const VIBE_BY_LABEL: Record<string, Vibe> = Object.fromEntries(
  (Object.entries(VIBE_LABELS) as Array<[Vibe, string]>).map(([k, v]) => [v, k])
);
import { EventCard } from "./event-card";
import { FilterBar } from "./filter-bar";
import { EventChat } from "./event-chat";

function getGuestCount(e: TechWeekEvent): number {
  const p = e.partiful;
  if (!p) return 0;
  return p.guestAction === "APPLY" ? p.approvedCount : p.guestCount;
}

function getFillPct(e: TechWeekEvent): number {
  const p = e.partiful;
  if (!p) return 0;
  if (p.isCapped && p.maxCapacity && p.maxCapacity > 0)
    return p.guestCount / p.maxCapacity;
  return p.guestCount;
}

// Acceptance rate is only meaningful when Partiful exposed a real applicant
// pool (applied > approved). Otherwise every APPLY event reads as 100%.
function getAcceptanceRate(e: TechWeekEvent): number | null {
  const p = e.partiful;
  if (!p || p.guestAction !== "APPLY") return null;
  if (typeof p.acceptanceRate !== "number") return null;
  if ((p.appliedCount ?? 0) <= p.approvedCount) return null;
  return p.acceptanceRate;
}

function getInterest(e: TechWeekEvent): number {
  const p = e.partiful;
  if (!p) return 0;
  // Everyone who engaged at all: confirmed + interested + waitlisted + applied.
  return (
    (p.appliedCount ?? p.approvedCount + p.pendingCount) +
    p.goingCount +
    p.interestedCount +
    p.waitlistCount +
    (p.maybeCount ?? 0)
  );
}

/**
 * Neighborhood filter options derived from the data: unique `location`
 * labels with at least 3 events, most common first. Used when the city config
 * doesn't hard-code a list.
 */
export function deriveNeighborhoods(events: TechWeekEvent[]): string[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    const label = (e.partiful?.neighborhood || e.location || "").trim();
    if (!label || /^tba$/i.test(label)) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => label)
    .slice(0, 40);
}

function sortEvents(events: TechWeekEvent[], sort: string): TechWeekEvent[] {
  const copy = [...events];
  switch (sort) {
    case "popular":
      return copy.sort((a, b) => getGuestCount(b) - getGuestCount(a));
    case "filling": {
      // Fewest spots left first (capped events), then by how full; uncapped last.
      return copy.sort((a, b) => {
        const la = spotsLeft(a), lb = spotsLeft(b);
        if (la === null && lb === null) return getInterest(b) - getInterest(a);
        if (la === null) return 1;
        if (lb === null) return -1;
        if (la === 0 && lb !== 0) return 1; // already full goes after "almost full"
        if (lb === 0 && la !== 0) return -1;
        return la - lb || getFillPct(b) - getFillPct(a);
      });
    }
    case "hardest": {
      // Oversubscription (demand vs cap) first; real acceptance rate as a
      // tie-breaker when Partiful exposes one; everything else after.
      const score = (e: TechWeekEvent) => {
        const r = demandRatio(e);
        const acc = getAcceptanceRate(e);
        if (r !== null && r >= 1) return r + (acc !== null ? 1 - acc : 0);
        if (acc !== null) return 1 - acc;
        return -1;
      };
      return copy.sort((a, b) => score(b) - score(a) || getGuestCount(b) - getGuestCount(a));
    }
    case "date":
    default:
      return copy.sort((a, b) => {
        const d = a.date.localeCompare(b.date);
        if (d !== 0) return d;
        return a.time.localeCompare(b.time);
      });
  }
}

export function EventDirectory({
  events,
  city,
}: {
  events: TechWeekEvent[];
  city: CityConfig;
}) {
  const neighborhoods = useMemo(
    () => (city.neighborhoods.length > 0 ? city.neighborhoods : deriveNeighborhoods(events)),
    [city.neighborhoods, events]
  );

  const [search, setSearch] = useQueryState("q", parseAsString.withDefault(""));
  const [selectedDays, setSelectedDays] = useQueryState(
    "day",
    parseAsArrayOf(parseAsString).withDefault([])
  );
  const [selectedTopics, setSelectedTopics] = useQueryState(
    "topic",
    parseAsArrayOf(parseAsString).withDefault([])
  );
  const [selectedTimes, setSelectedTimes] = useQueryState(
    "time",
    parseAsArrayOf(parseAsString).withDefault([])
  );
  const [selectedNeighborhoods, setSelectedNeighborhoods] = useQueryState(
    "hood",
    parseAsArrayOf(parseAsString).withDefault([])
  );
  const [sort, setSort] = useQueryState(
    "sort",
    parseAsString.withDefault("popular")
  );
  const [selectedVibes, setSelectedVibes] = useQueryState(
    "vibe",
    parseAsArrayOf(parseAsString).withDefault([])
  );

  const [selectedPersonal, setSelectedPersonal] = useQueryState(
    "mine",
    parseAsArrayOf(parseAsString).withDefault([])
  );

  // Right after connecting: show just your Partiful events.
  useEffect(() => {
    const show = () => {
      void setSelectedPersonal(["partiful"]);
      document.getElementById("events")?.scrollIntoView({ behavior: "smooth" });
    };
    window.addEventListener(SHOW_MY_PARTIFUL, show);
    return () => window.removeEventListener(SHOW_MY_PARTIFUL, show);
  }, [setSelectedPersonal]);

  // Derived per-event signals, computed once per data load.
  const vibeMap = useMemo(() => new Map(events.map((e) => [e.id, vibes(e)])), [events]);

  // Your Partiful events, and events where people you know (friends, hosts,
  // other connected Partiful users) are going.
  const social = useSocial();
  const { inPartiful, partiful, crowdGoing, friendsGoing, hostFriends } = social;
  const mutualIds = useMemo(
    () =>
      new Set(
        events
          .filter((e) => crowdGoing(e.id) > 0 || friendsGoing(e.id).length > 0 || hostFriends(e).length > 0)
          .map((e) => e.id)
      ),
    [events, crowdGoing, friendsGoing, hostFriends]
  );
  const mutualCount = useCallback(
    (e: TechWeekEvent) => crowdGoing(e.id) + friendsGoing(e.id).length,
    [crowdGoing, friendsGoing]
  );
  const personalOptions = partiful.connected
    ? [
        { value: "partiful", label: "✓ My Partiful", count: events.filter((e) => inPartiful.has(e.id)).length },
        { value: "mutuals", label: "Mutuals going", count: mutualIds.size },
      ]
    : [];

  const [visibleCount, setVisibleCount] = useState(60);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();

    return events.filter((e) => {
      if (selectedPersonal.includes("partiful") && !inPartiful.has(e.id)) return false;
      if (selectedPersonal.includes("mutuals") && !mutualIds.has(e.id)) return false;

      if (selectedDays.length > 0 && !selectedDays.includes(e.date))
        return false;

      if (
        selectedTopics.length > 0 &&
        !selectedTopics.some((t) => e.topics.includes(t))
      )
        return false;

      if (
        selectedTimes.length > 0 &&
        !selectedTimes.includes(e.timeOfDay)
      )
        return false;

      if (
        selectedNeighborhoods.length > 0 &&
        !selectedNeighborhoods.some((n) =>
          `${e.location} ${e.partiful?.neighborhood ?? ""}`
            .toLowerCase()
            .includes(n.toLowerCase())
        )
      )
        return false;

      if (selectedVibes.length > 0) {
        const have = vibeMap.get(e.id) ?? [];
        // "all of" semantics: Food + Free means both.
        if (!selectedVibes.every((label) => have.includes(VIBE_BY_LABEL[label]))) return false;
      }

      if (q) {
        const haystack =
          `${e.name} ${e.company} ${(e.hosts ?? []).join(" ")} ${e.topics.join(" ")} ${e.location} ${e.partiful?.neighborhood ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [
    events,
    search,
    selectedDays,
    selectedTopics,
    selectedTimes,
    selectedNeighborhoods,
    selectedVibes,
    vibeMap,
    selectedPersonal,
    inPartiful,
    mutualIds,
  ]);

  // With Mutuals on, the events with the most people you know come first.
  const sorted = useMemo(() => {
    const base = sortEvents(filtered, sort);
    if (!selectedPersonal.includes("mutuals")) return base;
    return [...base].sort((a, b) => mutualCount(b) - mutualCount(a));
  }, [filtered, sort, selectedPersonal, mutualCount]);

  const visible = sorted.slice(0, visibleCount);
  const hasMore = visibleCount < sorted.length;

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => prev + 60);
  }, []);

  return (
    <div id="events" className="min-h-screen scroll-mt-2 bg-[#E9E2D3]">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        selectedDays={selectedDays}
        onDaysChange={setSelectedDays}
        selectedTopics={selectedTopics}
        onTopicsChange={setSelectedTopics}
        selectedTimes={selectedTimes}
        onTimesChange={setSelectedTimes}
        selectedNeighborhoods={selectedNeighborhoods}
        onNeighborhoodsChange={setSelectedNeighborhoods}
        sort={sort}
        onSortChange={setSort}
        totalCount={events.length}
        filteredCount={filtered.length}
        days={city.days}
        neighborhoods={neighborhoods}
        selectedVibes={selectedVibes}
        onVibesChange={setSelectedVibes}
        vibeOptions={Object.values(VIBE_LABELS)}
        personalOptions={personalOptions}
        selectedPersonal={selectedPersonal}
        onPersonalChange={setSelectedPersonal}
      />

      <div className="mx-auto max-w-[1200px] px-[22px] py-6">
        <EventChat events={events} city={city} />

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 text-4xl text-[#A79E89]">—</div>
            <h3 className="mb-1 text-[17px] font-bold text-[#1C1A14]">
              No events found
            </h3>
            <p className="text-sm text-[#766E5C]">
              Try adjusting your filters or search query
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
            {hasMore && (
              <div className="mt-8 flex justify-center">
                <button
                  onClick={loadMore}
                  className="rounded-full border border-[#CDC1A6] bg-[#F7F2E7] px-6 py-2.5 text-[13px] font-semibold text-[#766E5C] hover:border-[#00FF9C] hover:text-[#0A8F5A] transition-all"
                >
                  Load more ({sorted.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
