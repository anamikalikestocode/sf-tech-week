"use client";
import type { TechWeekEvent } from "@/lib/events";
import { confirmed, demand, spotsLeft, venueName } from "@/lib/insights";
import { Lock, EyeOff } from "lucide-react";
import { trackRsvpClick } from "@/lib/session";

function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return m === "00" ? `${h12}${ampm}` : `${h12}:${m}${ampm}`;
}

function formatDate(date: string): string {
  return new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function StatusBadge({ event }: { event: TechWeekEvent }) {
  const p = event.partiful;
  const cls = "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase ";
  if (p?.atCapacity) return <span className={cls + "bg-[#D8442B]/10 text-[#D8442B]"}>Full</span>;
  if (event.registrationStatus === "closed") return <span className={cls + "bg-[#D8442B]/10 text-[#D8442B]"}>Closed</span>;
  if (event.isInviteOnly) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full border border-[#DDD3BD] bg-[#F0E8D9] px-2 py-0.5 text-[10.5px] font-medium text-[#766E5C]">
        <Lock className="size-2.5" /> Invite only
      </span>
    );
  }
  const left = spotsLeft(event);
  if (left !== null && left > 0 && left <= 20) return <span className={cls + "bg-[#00FF9C]/20 text-[#0A8F5A]"}>{left} left</span>;
  if (p?.countsReconstructed) {
    return (
      <span
        className="flex shrink-0 items-center gap-1 rounded-full border border-[#DDD3BD] bg-[#F0E8D9] px-2 py-0.5 text-[10.5px] font-medium text-[#766E5C]"
        title="The host turned off Partiful's guest count. These numbers come from the live guest list."
      >
        <EyeOff className="size-2.5" /> Hidden by host
      </span>
    );
  }
  return null;
}

/**
 * The bar. Green = people in, grey = space open, red = people shut out.
 * Count sits on top of it. Three shapes:
 *   1. Real acceptance data (applied > approved): accepted vs rejected+pending.
 *   2. Capped event: confirmed vs cap; over the cap -> got in vs shut out.
 *   3. Uncapped: just the count, no bar (nothing honest to fill).
 */
function CountAndBar({ event }: { event: TechWeekEvent }) {
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

// Topic chip colours: pastel fill + darker ink, tuned to the warm palette.
const TOPIC_STYLE: Record<string, string> = {
  "AI/ML": "bg-[#DDF6EA] text-[#0A6B45] border-[#B9E9D2]",
  "Dev/Engineering": "bg-[#E4E4F7] text-[#3B3B8F] border-[#C9C9EE]",
  "VC/Investing": "bg-[#F7EBC9] text-[#7A5A00] border-[#EBD79A]",
  "Founder/Startup": "bg-[#DCEBFA] text-[#1E4F80] border-[#B9D5F2]",
  "Social/Party": "bg-[#FBE0EA] text-[#8F2A50] border-[#F4BFD1]",
  "Product/Growth": "bg-[#E0F1F4] text-[#0F5C6B] border-[#BFE1E7]",
  Fintech: "bg-[#E6F3DC] text-[#3A6B14] border-[#CBE5B5]",
  Healthcare: "bg-[#FCE6DF] text-[#8E3A1E] border-[#F5C7B8]",
  "Design/Creative": "bg-[#F3E3F7] text-[#6B2E80] border-[#E3C4EC]",
  "Women/Diversity": "bg-[#FAE3EE] text-[#8A2E5C] border-[#F2C2D9]",
  "Media/Content": "bg-[#EFE7DC] text-[#5B4A2E] border-[#DDCFBB]",
  "Sports/Fitness": "bg-[#E1F3E4] text-[#1F6B3A] border-[#BFE3C6]",
  "Climate/Energy": "bg-[#E4F1DE] text-[#2E5E1E] border-[#C6E2BC]",
  "Real Estate": "bg-[#EDE6DA] text-[#5E4B2A] border-[#D8CBB5]",
  "Crypto/Web3": "bg-[#EAE6F9] text-[#4A3A9C] border-[#D0C8F0]",
  Legal: "bg-[#E8E8E8] text-[#3F3F3F] border-[#D2D2D2]",
  Consumer: "bg-[#FBE9D7] text-[#8A4B10] border-[#F3D1AF]",
  SaaS: "bg-[#DEEDF8] text-[#1B4F78] border-[#BBD8EE]",
};
const DEFAULT_TOPIC_STYLE = "bg-[#F0E8D9] text-[#5B5443] border-[#DDD3BD]";

function TopicChips({ topics }: { topics: string[] }) {
  if (topics.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {topics.slice(0, 3).map((t) => (
        <span key={t} className={"rounded-full border px-1.5 py-px text-[10.5px] font-semibold " + (TOPIC_STYLE[t] ?? DEFAULT_TOPIC_STYLE)}>
          {t}
        </span>
      ))}
    </div>
  );
}

export function EventCard({ event }: { event: TechWeekEvent }) {
  const p = event.partiful;
  const venue = venueName(event);
  const place = venue ? `${venue} · ${p?.neighborhood || event.location || ""}` : p?.neighborhood || event.location || "TBA";
  const host = event.company || event.hosts?.[0] || "";

  return (
    <a
      href={event.url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      onClick={event.url ? () => trackRsvpClick({ eventUrl: event.url, eventName: event.name, source: "card" }) : undefined}
      className={
        "group flex flex-col gap-2 rounded-[12px] border border-[#DDD3BD] bg-[#F7F2E7] px-4 py-3 transition-all duration-[160ms] " +
        (event.url ? "cursor-pointer hover:-translate-y-0.5 hover:border-[#00FF9C] hover:shadow-[0_16px_34px_-18px_rgba(40,30,10,0.3)]" : "cursor-default")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] text-[#766E5C]">{host || "—"}</span>
        <StatusBadge event={event} />
      </div>

      <h3 className="line-clamp-2 text-[15px] font-bold leading-[1.25] tracking-[-0.01em] text-[#1C1A14] transition-colors duration-[160ms] group-hover:text-[#0A8F5A]">
        {event.name}
      </h3>

      <div className="truncate text-[12px] text-[#766E5C]">
        {formatDate(event.date)} · {formatTime(event.time)} · {place}
      </div>

      <TopicChips topics={event.topics} />

      <CountAndBar event={event} />
    </a>
  );
}
