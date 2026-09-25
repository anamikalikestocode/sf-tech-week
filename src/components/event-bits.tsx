"use client";
import type { TechWeekEvent } from "@/lib/events";
import { confirmed, demand, spotsLeft } from "@/lib/insights";

export function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return m === "00" ? `${h12}${ampm}` : `${h12}:${m}${ampm}`;
}

export function formatDate(date: string): string {
  return new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

const TZ = "America/Los_Angeles";

/** "5–8PM", "11AM–2PM", or just "5PM" when the end is unknown or on another day. */
export function timeRange(event: TechWeekEvent): string {
  const start = formatTime(event.time);
  const end = event.partiful?.endDate;
  if (!end) return start;
  const endDate = new Date(end);
  if (Number.isNaN(endDate.getTime())) return start;
  const endDay = endDate.toLocaleDateString("en-CA", { timeZone: TZ });
  if (endDay !== event.date) return start;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(endDate);
  const hour = parts.find((x) => x.type === "hour")?.value ?? "";
  const minute = parts.find((x) => x.type === "minute")?.value ?? "00";
  const ampm = (parts.find((x) => x.type === "dayPeriod")?.value ?? "").toUpperCase();
  const endStr = minute === "00" ? `${hour}${ampm}` : `${hour}:${minute}${ampm}`;
  // Drop the start's AM/PM when both halves share it: "5–8PM".
  const startAmPm = start.slice(-2);
  const startBare = startAmPm === ampm ? start.slice(0, -2) : start;
  return `${startBare}–${endStr}`;
}

/**
 * The bar. Green = people in, grey = space open, red = people shut out.
 * Count sits on top of it. Three shapes:
 *   1. Real acceptance data (applied > approved): accepted vs rejected+pending.
 *   2. Capped event: confirmed vs cap; over the cap -> got in vs shut out.
 *   3. Uncapped: just the count, no bar (nothing honest to fill).
 */
export function CountAndBar({ event }: { event: TechWeekEvent }) {
  const p = event.partiful;
  if (!p || p.countsHidden) return null;
  const inCount = confirmed(event);
  const unit = p.guestAction === "APPLY" ? "approved" : "going";
  const applied = p.appliedCount ?? p.approvedCount + p.pendingCount;

  let greenPct: number | null = null, redPct = 0, right = "", danger = false, title = "";

  if (p.guestAction === "APPLY" && applied > p.approvedCount) {
    const rate = p.approvedCount / applied;
    greenPct = rate * 100;
    redPct = 100 - greenPct;
    right = `${Math.round(rate * 100)}% accepted of ${applied.toLocaleString()}`;
    danger = rate <= 0.3;
    title = `${p.approvedCount.toLocaleString()} accepted of ${applied.toLocaleString()} applied`;
  } else if (p.isCapped && p.maxCapacity) {
    const cap = p.maxCapacity;
    const d = demand(event);
    const left = spotsLeft(event) ?? Math.max(0, cap - inCount);
    if (d > cap) {
      greenPct = (cap / d) * 100;
      redPct = 100 - greenPct;
      right = `${Math.round((d / cap) * 100)}% · ${(d - cap).toLocaleString()} didn't get in`;
      danger = true;
      title = `${d.toLocaleString()} people want ${cap.toLocaleString()} spots`;
    } else {
      greenPct = Math.min(100, (Math.max(inCount, cap - left) / cap) * 100);
      right = left === 0 ? "full" : `${left.toLocaleString()} left of ${cap.toLocaleString()}`;
      danger = left === 0;
      title = `${inCount.toLocaleString()} in, ${left.toLocaleString()} left of ${cap.toLocaleString()}`;
    }
  }

  if (greenPct === null && inCount <= 0) return null;

  return (
    <div className="mt-auto flex flex-col gap-1" title={title || undefined}>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="font-bold tabular-nums text-[#1C1A14]">
          {inCount > 0 ? `${inCount.toLocaleString()} ${unit}` : ""}
        </span>
        {right && <span className={"tabular-nums " + (danger ? "font-semibold text-[#D8442B]" : "text-[#766E5C]")}>{right}</span>}
      </div>
      {greenPct !== null && (
        <div className="flex h-[6px] w-full overflow-hidden rounded-full bg-[#DDD3BD]">
          <div className="h-full bg-[#00FF9C]" style={{ width: `${greenPct}%` }} />
          {redPct > 0 && <div className="h-full bg-[#D8442B]" style={{ width: `${redPct}%` }} />}
        </div>
      )}
    </div>
  );
}

