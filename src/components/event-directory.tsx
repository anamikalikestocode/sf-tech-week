"use client";

import { useMemo, useState, useCallback } from "react";
import {
  useQueryState,
  parseAsArrayOf,
  parseAsString,
} from "nuqs";
import type { TechWeekEvent } from "@/lib/events";
import type { CityConfig } from "@/lib/cities";
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

function getSpotsRemaining(e: TechWeekEvent): number {
  const p = e.partiful;
  if (!p) return Infinity;
  if (!p.isCapped || !p.maxCapacity) return Infinity;
  if (p.atCapacity) return 0;
  return Math.max(0, p.maxCapacity - p.guestCount);
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
    case "selective": {
      // Lowest acceptance rate first; events without a real rate go last.
      return copy.sort((a, b) => {
        const ra = getAcceptanceRate(a);
        const rb = getAcceptanceRate(b);
        if (ra === null && rb === null) return getInterest(b) - getInterest(a);
        if (ra === null) return 1;
        if (rb === null) return -1;
        return ra - rb;
      });
    }
    case "interest":
      return copy.sort((a, b) => getInterest(b) - getInterest(a));
    case "closing": {
      // Fewest spots left first; uncapped / unknown last.
      return copy.sort((a, b) => {
        const la = spotsLeft(a), lb = spotsLeft(b);
        if (la === null && lb === null) return getInterest(b) - getInterest(a);
        if (la === null) return 1;
        if (lb === null) return -1;
        if (la === 0 && lb !== 0) return 1; // full ones after "almost full"
        if (lb === 0 && la !== 0) return -1;
        return la - lb;
      });
    }
    case "oversubscribed": {
      return copy.sort((a, b) => (demandRatio(b) ?? -1) - (demandRatio(a) ?? -1));
    }
    case "popular":
      return copy.sort((a, b) => getGuestCount(b) - getGuestCount(a));
    case "filling":
      return copy.sort((a, b) => getFillPct(b) - getFillPct(a));
    case "available": {
      return copy.sort((a, b) => {
        const aSpots = getSpotsRemaining(a);
        const bSpots = getSpotsRemaining(b);
        const aFinite = isFinite(aSpots) ? 0 : 1;
        const bFinite = isFinite(bSpots) ? 0 : 1;
        if (aFinite !== bFinite) return aFinite - bFinite;
        return bSpots - aSpots;
      });
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
    parseAsString.withDefault("date")
  );
  const [selectedVibes, setSelectedVibes] = useQueryState(
    "vibe",
    parseAsArrayOf(parseAsString).withDefault([])
  );

  // Derived per-event signals, computed once per data load.
  const vibeMap = useMemo(() => new Map(events.map((e) => [e.id, vibes(e)])), [events]);

  const [visibleCount, setVisibleCount] = useState(60);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();

    return events.filter((e) => {
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
  ]);

  const sorted = useMemo(() => sortEvents(filtered, sort), [filtered, sort]);

  const visible = sorted.slice(0, visibleCount);
  const hasMore = visibleCount < sorted.length;

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => prev + 60);
  }, []);

  return (
    <div className="min-h-screen bg-[#E9E2D3]">
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
