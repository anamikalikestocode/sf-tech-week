"use client";

import { TOPICS, TOPIC_COLORS } from "@/lib/events";
import { Search, X, ChevronDown } from "lucide-react";
import { useState } from "react";

// TOPIC_COLORS kept for API compatibility (passed as colorMap prop type)
void TOPIC_COLORS;

interface FilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  selectedDays: string[];
  onDaysChange: (v: string[]) => void;
  selectedTopics: string[];
  onTopicsChange: (v: string[]) => void;
  selectedTimes: string[];
  onTimesChange: (v: string[]) => void;
  selectedNeighborhoods: string[];
  onNeighborhoodsChange: (v: string[]) => void;
  sort: string;
  onSortChange: (v: string) => void;
  totalCount: number;
  filteredCount: number;
  /** Edition days (from the city config) */
  days: Array<{ value: string; label: string }>;
  /** Neighborhood options (city config or derived from the data) */
  neighborhoods: string[];
  selectedVibes: string[];
  onVibesChange: (v: string[]) => void;
  vibeOptions: string[];
}

const SORT_OPTIONS = [
  { value: "date", label: "Date & Time" },
  { value: "popular", label: "Most Popular" },
  { value: "filling", label: "Filling Fast" },
  { value: "available", label: "Spots Available" },
  { value: "oversubscribed", label: "Most Oversubscribed" },
  { value: "closing", label: "Closing Fast" },
  { value: "interest", label: "Most Interest" },
  { value: "selective", label: "Most Selective" },
] as const;

const TIMES = ["Morning", "Afternoon", "Evening", "Noon"];

function toggle(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
}


function DropdownFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  colorMap?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
      <div className={`relative ${open ? "z-50" : ""}`}>
        <button
          onClick={() => setOpen(!open)}
          className={`touch-manipulation flex shrink-0 items-center gap-1.5 rounded-full border px-[13px] py-[7px] text-[13px] font-medium transition-all duration-[160ms] ${
            selected.length > 0
              ? "border-[#00FF9C] bg-[#00FF9C] text-[#0C0C0A]"
              : "border-[#CDC1A6] bg-[#F7F2E7] text-[#766E5C] hover:border-[#A79E89]"
          }`}
        >
          {label}
          {selected.length > 0 && (
            <span className="flex size-4 items-center justify-center rounded-full bg-[#0C0C0A]/10 text-[10px] font-bold">{selected.length}</span>
          )}
          <ChevronDown className="size-3" />
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1.5 max-h-[290px] w-[230px] overflow-y-auto rounded-xl border border-[#CDC1A6] bg-[#F7F2E7] p-1.5 shadow-[0_8px_24px_-8px_rgba(40,30,10,0.18)]">
            {options.map((opt) => {
              const isActive = selected.includes(opt);
              return (
                <button
                  key={opt}
                  onClick={() => onChange(toggle(selected, opt))}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                    isActive ? "font-semibold text-[#0A8F5A]" : "text-[#766E5C] hover:bg-[#F0E8D9] hover:text-[#1C1A14]"
                  }`}
                >
                  <span className="w-4 shrink-0 text-center text-[11px]">{isActive ? "✓" : ""}</span>
                  <span className="truncate">{opt}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function SortDropdown({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const current = SORT_OPTIONS.find((o) => o.value === value) ?? SORT_OPTIONS[0];
  const isNonDefault = value !== "date";

  return (
    <>
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
      <div className={`relative ${open ? "z-50" : ""}`}>
        <button
          onClick={() => setOpen(!open)}
          className={`touch-manipulation flex shrink-0 items-center gap-1.5 rounded-full border px-[13px] py-[7px] text-[13px] font-medium transition-all duration-[160ms] ${
            isNonDefault
              ? "border-[#00FF9C] bg-[#00FF9C] text-[#0C0C0A]"
              : "border-[#CDC1A6] bg-[#F7F2E7] text-[#766E5C] hover:border-[#A79E89]"
          }`}
        >
          Sort: {current.label}
          <ChevronDown className="size-3" />
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1.5 w-44 rounded-xl border border-[#CDC1A6] bg-[#F7F2E7] p-1.5 shadow-[0_8px_24px_-8px_rgba(40,30,10,0.18)]">
            {SORT_OPTIONS.map((opt) => {
              const isActive = value === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                    isActive
                      ? "font-semibold text-[#0A8F5A]"
                      : "text-[#766E5C] hover:bg-[#F0E8D9] hover:text-[#1C1A14]"
                  }`}
                >
                  <span className="w-4 shrink-0 text-center text-[11px]">{isActive ? "✓" : ""}</span>
                  <span className="truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export function FilterBar(props: FilterBarProps) {
  const {
    search,
    onSearchChange,
    selectedDays,
    onDaysChange,
    selectedTopics,
    onTopicsChange,
    selectedTimes,
    onTimesChange,
    selectedNeighborhoods,
    onNeighborhoodsChange,
    sort,
    onSortChange,
    totalCount,
    filteredCount,
  } = props;

  const hasFilters =
    search ||
    selectedDays.length > 0 ||
    selectedTopics.length > 0 ||
    selectedTimes.length > 0 ||
    selectedNeighborhoods.length > 0 ||
    props.selectedVibes.length > 0;

  function clearAll() {
    onSearchChange("");
    onDaysChange([]);
    onTopicsChange([]);
    onTimesChange([]);
    onNeighborhoodsChange([]);
    props.onVibesChange([]);
  }

  return (
    <div className="border-b border-[#DDD3BD] bg-[#E9E2D3]">
      <div className="mx-auto max-w-[1200px] px-[22px] py-[14px]">
        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#A79E89]" />
          <input
            type="text"
            placeholder="Search events, hosts, topics…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-11 w-full rounded-xl border border-[#CDC1A6] bg-[#F7F2E7] pl-10 pr-10 text-[14px] text-[#1C1A14] placeholder:text-[#A79E89] outline-none transition-all duration-[160ms] focus:border-[#00FF9C] focus:shadow-[0_0_0_3px_rgba(0,255,156,0.18)]"
          />
          {search && (
            <button onClick={() => onSearchChange("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A79E89] hover:text-[#766E5C]">
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Day pills */}
        <div className="mb-2.5 flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          {props.days.map((day) => {
            const dow = day.label.split(" ")[0]; // "Mon"
            const dateNum = day.label.split(" ").pop(); // "1"
            const isActive = selectedDays.includes(day.value);
            return (
              <button
                key={day.value}
                onClick={() => onDaysChange(toggle(selectedDays, day.value))}
                className={`touch-manipulation flex shrink-0 flex-col items-center rounded-[10px] border px-[13px] py-2 transition-all duration-[160ms] ${
                  isActive
                    ? "border-[#00FF9C] bg-[#00FF9C] text-[#0C0C0A]"
                    : "border-[#CDC1A6] bg-[#F7F2E7] text-[#766E5C] hover:border-[#A79E89]"
                }`}
              >
                <span className="text-[12px] font-bold leading-none">{dow}</span>
                <span className={`mt-0.5 text-[11px] leading-none ${isActive ? "text-[#0C0C0A]/70" : "text-[#A79E89]"}`}>{dateNum}</span>
              </button>
            );
          })}
        </div>

        {/* Filter pills row */}
        <div className="flex flex-wrap gap-2">
          <DropdownFilter label="Topic" options={TOPICS} selected={selectedTopics} onChange={onTopicsChange} colorMap={TOPIC_COLORS} />
          <DropdownFilter label="Time" options={TIMES} selected={selectedTimes} onChange={onTimesChange} />
          <DropdownFilter label="Neighborhood" options={props.neighborhoods} selected={selectedNeighborhoods} onChange={onNeighborhoodsChange} />
          <DropdownFilter label="Vibes" options={props.vibeOptions} selected={props.selectedVibes} onChange={props.onVibesChange} />
          {hasFilters && (
            <button onClick={clearAll} className="flex shrink-0 items-center gap-1 rounded-full border border-[#D8442B]/35 bg-[#D8442B]/9 px-3 py-[7px] text-[13px] font-medium text-[#D8442B] transition-colors hover:bg-[#D8442B]/15">
              <X className="size-3" /> Clear all
            </button>
          )}
        </div>

        {/* Sort + count — own row, left-aligned */}
        <div className="mt-2 flex items-center gap-3">
          <SortDropdown value={sort} onChange={onSortChange} />
          <span className="text-[13px] text-[#766E5C]">
            {filteredCount === totalCount ? `${totalCount} events` : `${filteredCount} of ${totalCount}`}
          </span>
        </div>
      </div>
    </div>
  );
}
