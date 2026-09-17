"use client";
import type { TechWeekEvent } from "@/lib/events";
import {
  confirmed,
  demand,
  demandRatio,
  plusOnes,
  spotsLeft,
  venueName,
  waitlisted,
  ticketEconomics,
  fmtRange,
} from "@/lib/insights";
import { Clock, MapPin, ExternalLink, Lock, Calendar, EyeOff, Navigation } from "lucide-react";
import { rsvpsLast } from "@/lib/momentum";
import { trackRsvpClick } from "@/lib/session";

function formatTime(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return m === "00" ? `${h12}${ampm}` : `${h12}:${m}${ampm}`;
}

function formatDate(date: string): string {
  const d = new Date(date + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function rsvpHost(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h === "partiful.com") return "Partiful";
    if (h === "lu.ma" || h === "luma.com") return "Luma";
    if (h === "eventbrite.com") return "Eventbrite";
    return h;
  } catch {
    return "";
  }
}

function CompanyLogo({ company }: { company: string }) {
  if (!company) return null;
  const domain = company.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
  // CSS background-image, not <img>: a failed load shows the neutral box, never
  // the broken-image glyph (visible pre-hydration in in-app browsers).
  return (
    <span
      aria-hidden="true"
      className="inline-block size-[18px] shrink-0 rounded-[5px] bg-[#F0E8D9] bg-contain bg-center bg-no-repeat"
      style={{ backgroundImage: `url(https://logo.clearbit.com/${domain})` }}
    />
  );
}

function StatusBadge({ event }: { event: TechWeekEvent }) {
  const p = event.partiful;
  if (p?.atCapacity) {
    return <span className="shrink-0 rounded-full bg-[#D8442B]/10 px-2 py-0.5 text-[10.5px] font-bold uppercase text-[#D8442B]">Full</span>;
  }
  if (event.registrationStatus === "closed") {
    return <span className="shrink-0 rounded-full bg-[#D8442B]/10 px-2 py-0.5 text-[10.5px] font-bold uppercase text-[#D8442B]">Closed</span>;
  }
  if (event.isInviteOnly) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full border border-[#DDD3BD] bg-[#F0E8D9] px-2 py-0.5 text-[10.5px] font-medium text-[#766E5C]">
        <Lock className="size-2.5" /> Invite only
      </span>
    );
  }
  const left = spotsLeft(event);
  if (left !== null && left > 0 && left <= 20) {
    return <span className="shrink-0 rounded-full bg-[#00FF9C]/20 px-2 py-0.5 text-[10.5px] font-bold text-[#0A8F5A]">{left} left</span>;
  }
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
  if (p?.countsHidden) {
    return (
      <span
        className="flex shrink-0 items-center gap-1 rounded-full border border-[#DDD3BD] bg-[#F0E8D9] px-2 py-0.5 text-[10.5px] font-medium text-[#766E5C]"
        title="The host turned off Partiful's guest count"
      >
        <EyeOff className="size-2.5" /> Count hidden
      </span>
    );
  }
  return null;
}

/**
 * The line under the title. One bar, three colours:
 *   green = people who are in, grey = space still open, red = people shut out.
 * Three data shapes feed it:
 *   1. Real acceptance data (applied > approved): green approved / red rejected+pending.
 *   2. Capped event: green confirmed / grey remaining; when demand exceeds the
 *      cap the bar becomes in-vs-shut-out (green cap / red overflow).
 *   3. Uncapped with no applicant data: no bar (nothing honest to show).
 */
function CapacityBar({ event }: { event: TechWeekEvent }) {
  const p = event.partiful;
  if (!p || p.countsHidden) return null;

  let greenPct = 0, redPct = 0, label = "", value = "", danger = false, title = "";
  const applied = p.appliedCount ?? p.approvedCount + p.pendingCount;
  const inCount = confirmed(event);

  if (p.guestAction === "APPLY" && applied > p.approvedCount) {
    const rate = p.approvedCount / applied;
    greenPct = rate * 100;
    redPct = 100 - greenPct;
    label = "accepted";
    value = `${Math.round(rate * 100)}%`;
    danger = rate <= 0.3;
    title = `${p.approvedCount.toLocaleString()} accepted of ${applied.toLocaleString()} applied${(p.rejectedCount ?? 0) > 0 ? `, ${p.rejectedCount} rejected` : ""}`;
  } else if (p.isCapped && p.maxCapacity) {
    const cap = p.maxCapacity;
    const d = demand(event);
    const left = spotsLeft(event) ?? Math.max(0, cap - inCount);
    if (d > cap) {
      // Oversubscribed: share of demand that got in vs. shut out.
      greenPct = (cap / d) * 100;
      redPct = 100 - greenPct;
      label = "oversubscribed";
      value = `${Math.round((d / cap) * 100)}% · ${(d - cap).toLocaleString()} didn't get in`;
      danger = true;
      title = `${d.toLocaleString()} people want ${cap.toLocaleString()} spots: ${(d - cap).toLocaleString()} waitlisted or interested with no room`;
    } else {
      greenPct = Math.min(100, (Math.max(inCount, cap - left) / cap) * 100);
      label = left === 0 ? "full" : "filling up";
      value = left === 0 ? `${cap.toLocaleString()} cap` : `${left.toLocaleString()} left of ${cap.toLocaleString()}`;
      danger = left === 0;
      title = `${inCount.toLocaleString()} in, ${left.toLocaleString()} left of ${cap.toLocaleString()}`;
    }
  } else {
    return null;
  }

  return (
    <div className="flex flex-col gap-1" title={title}>
      <div className="flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-[0.08em]">
        <span className="text-[#766E5C]">{label}</span>
        <span className={"tabular-nums normal-case tracking-normal " + (danger ? "text-[#D8442B]" : "text-[#1C1A14]")}>{value}</span>
      </div>
      <div className="flex h-[6px] w-full overflow-hidden rounded-full bg-[#DDD3BD]">
        <div className="h-full bg-[#00FF9C] transition-[width] duration-500 ease-out" style={{ width: `${greenPct}%` }} />
        {redPct > 0 && <div className="h-full bg-[#D8442B] transition-[width] duration-500 ease-out" style={{ width: `${redPct}%` }} />}
      </div>
    </div>
  );
}

/**
 * @param others how many other events start in the same hour (collision count)
 */
export function EventCard({ event, others = 0 }: { event: TechWeekEvent; others?: number }) {
  const p = event.partiful;
  const isApply = p?.guestAction === "APPLY";

  const headline = confirmed(event);
  const showAttendance = !!p && !p.countsHidden && headline > 0;
  const ratio = demandRatio(event);
  const wl = waitlisted(event);
  const plus = plusOnes(event);
  const venue = venueName(event);
  const econ = ticketEconomics(event);

  // Secondary engagement signals (only the ones that are non-zero).
  const extras: Array<{ label: string; value: string; danger?: boolean; title?: string }> = [];
  if (p && !p.countsHidden) {
    if ((p.rejectedCount ?? 0) > 0) extras.push({ label: "rejected", value: p.rejectedCount!.toLocaleString(), danger: true });
    if (wl > 0) extras.push({ label: "waitlisted", value: wl.toLocaleString() });
    if (p.interestedCount > 0) extras.push({ label: "interested", value: p.interestedCount.toLocaleString() });
    if (p.isCapped && p.maxCapacity && ratio === null) extras.push({ label: "cap", value: p.maxCapacity.toLocaleString() });
    else if (p.isCapped && p.maxCapacity) extras.push({ label: "cap", value: p.maxCapacity.toLocaleString() });
  }

  const host = rsvpHost(event.url);
  return (
    <article
      className={
        "group relative flex flex-col gap-[11px] rounded-[14px] border border-[#DDD3BD] bg-[#F7F2E7] p-4 transition-all duration-[160ms] " +
        (event.url ? "hover:-translate-y-0.5 hover:border-[#00FF9C] hover:shadow-[0_16px_34px_-18px_rgba(40,30,10,0.3)]" : "")
      }
    >
      {/* Top: company logo + name | status badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CompanyLogo company={event.company} />
          <span className="truncate text-[12px] text-[#766E5C]">{event.company || "—"}</span>
        </div>
        <StatusBadge event={event} />
      </div>

      {/* Title — the stretched link: covers the whole card via ::after */}
      <h3 className="line-clamp-2 text-[16px] font-bold leading-[1.28] tracking-[-0.01em] text-[#1C1A14] transition-colors duration-[160ms] group-hover:text-[#0A8F5A]">
        {event.url ? (
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            className="after:absolute after:inset-0 after:content-['']"
            onClick={() => trackRsvpClick({ eventUrl: event.url, eventName: event.name, source: "card" })}
          >
            {event.name}
          </a>
        ) : (
          event.name
        )}
      </h3>

      <CapacityBar event={event} />

      {/* Meta: date · time · location */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[#766E5C]">
        <span className="flex items-center gap-1"><Calendar className="size-[13px] text-[#A79E89]" />{formatDate(event.date)}</span>
        <span className="flex items-center gap-1">
          <Clock className="size-[13px] text-[#A79E89]" />
          {formatTime(event.time)}
          {others >= 20 && (
            <span className="ml-1 rounded-full bg-[#E9E2D3] px-1.5 py-px text-[10px] font-semibold tabular-nums text-[#766E5C]" title={`${others} other events start this hour`}>
              +{others} same hour
            </span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1">
          <MapPin className="size-[13px] text-[#A79E89]" />
          <span className="truncate">{venue ? `${venue} · ${p?.neighborhood || event.location || ""}` : p?.neighborhood || event.location || "TBA"}</span>
          {p?.mapsUrl && (
            <a
              href={p.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="relative z-10 ml-0.5 inline-flex items-center gap-0.5 rounded-full border border-[#DDD3BD] px-1.5 py-px text-[10px] font-semibold text-[#766E5C] hover:border-[#0A8F5A] hover:text-[#0A8F5A]"
              title={p.address ?? "Directions"}
            >
              <Navigation className="size-2.5" /> map
            </a>
          )}
        </span>
      </div>

      {/* Attendance + acceptance */}
      {showAttendance && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex shrink-0 items-baseline gap-1">
              <span className="text-2xl font-extrabold tabular-nums tracking-[-0.03em] text-[#1C1A14]">{headline.toLocaleString()}</span>
              <span className="text-[10.5px] text-[#766E5C]">{isApply ? "approved" : "going"}</span>
            </div>
            {rsvpsLast(event, 2) >= 10 && (
              <span className="text-[10.5px] font-semibold tabular-nums text-[#0A8F5A]" title="RSVPs in the last 48 hours, from the live guest list">
                +{rsvpsLast(event, 2)} in 48h
              </span>
            )}
            {extras.length > 0 && (
              <div className="flex flex-wrap gap-x-2 text-[10.5px] tabular-nums text-[#766E5C]">
                {extras.map((x) => (
                  <span key={x.label} className={x.danger ? "font-semibold text-[#D8442B]" : undefined} title={x.title}>
                    {x.value} {x.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Money: what a paid event is pulling in */}
      {econ && (
        <div
          className="flex items-baseline justify-between gap-2 rounded-[8px] border border-[#DDD3BD] bg-[#F0E8D9] px-2.5 py-1.5 text-[11px] tabular-nums"
          title={`${econ.tickets} tickets × ${econ.priceLow === econ.priceHigh ? `$${econ.priceLow}` : `$${econ.priceLow}–$${econ.priceHigh}`}${econ.confidence === "tiers" ? " (tier prices parsed from the description)" : ""}. Partiful keeps 10% + $2 per ticket.`}
        >
          <span className="text-[#766E5C]">
            <span className="font-bold text-[#0A8F5A]">{fmtRange(econ.hostLow, econ.hostHigh)}</span> to host
          </span>
          <span className="text-[#766E5C]">
            <span className="font-bold text-[#D8442B]">{fmtRange(econ.partifulLow, econ.partifulHigh)}</span> to Partiful
          </span>
          <span className="text-[#A79E89]">{econ.confidence === "tiers" ? "est." : `${econ.tickets} × $${econ.priceLow}`}</span>
        </div>
      )}

      {/* Chips: topics + the Partiful intel */}
      <div className="flex flex-wrap gap-1.5">
        {event.topics.slice(0, 2).map((topic) => (
          <span key={topic} className="rounded-full border border-[#DDD3BD] bg-[#F0E8D9] px-2 py-0.5 text-[11px] font-medium text-[#1C1A14]">{topic}</span>
        ))}
        {event.formats?.[0] && (
          <span className="rounded-full border border-[#DDD3BD] px-2 py-0.5 text-[11px] font-medium text-[#766E5C]">{event.formats[0]}</span>
        )}
        {plus > 0 && (
          <span className="rounded-full border border-[#0A8F5A]/30 bg-[#00FF9C]/10 px-2 py-0.5 text-[11px] font-semibold text-[#0A8F5A]" title={`One RSVP admits ${plus} extra guest${plus > 1 ? "s" : ""}`}>
            +{plus} guests
          </span>
        )}
        {(p?.ticketing || p?.hasTickets) && (
          <span className="rounded-full border border-[#DDD3BD] px-2 py-0.5 text-[11px] font-medium text-[#766E5C]">paid</span>
        )}
      </div>

      {/* RSVP footer */}
      {event.url && (
        <div className="mt-auto flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#766E5C] transition-colors duration-[160ms] group-hover:text-[#0A8F5A]">
          {isApply ? "Apply" : "RSVP"}{host ? ` on ${host}` : ""} <ExternalLink className="size-3" />
        </div>
      )}
    </article>
  );
}
