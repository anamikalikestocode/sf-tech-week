"use client";

import { useEffect, useState } from "react";
import type { TechWeekEvent } from "@/lib/events";
import { venueName } from "@/lib/insights";
import { trackRsvpClick } from "@/lib/session";
import { Avatar, FriendsGoingRow, firstName, useSocial } from "./social";
import { CountAndBar, formatDate, timeRange } from "./event-bits";

/** "The Web Data Loft · 625 2nd Street", without repeating the venue or the city. */
function placeLine(venue: string | null, address: string | null, fallback: string): string {
  const street = address && !/^(san francisco|tba|tbd)/i.test(address) ? address.replace(/, San Francisco.*$/i, "").trim() : "";
  const rest = venue && street.startsWith(venue) ? street.slice(venue.length).replace(/^[,\s·-]+/, "") : street;
  return [venue, rest || (!venue ? fallback : "")].filter(Boolean).join(" · ");
}

// Tap-to-open detail sheet: everything the card leaves out, plus the actions.
export function EventSheet({ event, onClose }: { event: TechWeekEvent; onClose: () => void }) {
  const social = useSocial();
  const p = event.partiful;
  const going = social.mine.has(event.id);
  const friends = social.friendsGoing(event.id);
  const hostFriends = social.hostFriends(event);
  const venue = venueName(event);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const isApply = p?.guestAction === "APPLY";
  const hosts = (p?.hostProfiles ?? []).filter((h) => h.name && h.name !== "Tech Week");
  const deadline = p?.rsvpDeadline
    ? new Date(p.rsvpDeadline).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;
  const description = p?.description?.trim() ?? "";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#1C1A14]/40 sm:items-center" onClick={onClose}>
      <div
        className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-[18px] bg-[#F7F2E7] shadow-2xl sm:max-w-[520px] sm:rounded-[18px]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={event.name}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full bg-[#1C1A14]/60 text-[14px] text-white"
        >
          ✕
        </button>

        {event.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.imageUrl} alt="" className="aspect-[2/1] w-full object-cover sm:rounded-t-[18px]" />
        )}

        <div className="flex flex-col gap-3 p-5">
          <div>
            <p className="text-[12px] text-[#766E5C]">{event.company || event.hosts?.[0] || ""}</p>
            <h2 className="mt-0.5 text-[20px] font-extrabold leading-[1.2] tracking-[-0.02em] text-[#1C1A14]">{event.name}</h2>
            <p className="mt-1 text-[13px] text-[#766E5C]">
              {formatDate(event.date)} · {timeRange(event)}
            </p>
            {(venue || p?.address || p?.neighborhood || event.location) && (
              <p className="mt-0.5 text-[13px] text-[#766E5C]">
                {placeLine(venue, p?.address ?? null, p?.neighborhood || event.location)}
                {p?.mapsUrl && (
                  <>
                    {" · "}
                    <a href={p.mapsUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#0A8F5A] underline underline-offset-2">
                      Map
                    </a>
                  </>
                )}
              </p>
            )}
          </div>

          {hostFriends.length > 0 && (
            <p className="text-[13px] font-semibold text-[#0A8F5A]">Hosted by {hostFriends.map((f) => firstName(f.name)).join(" & ")}</p>
          )}
          <FriendsGoingRow friends={friends} />

          <CountAndBar event={event} />

          {deadline && <p className="text-[13px] font-semibold text-[#D8442B]">RSVP closes {deadline}</p>}

          <div className="flex flex-col gap-2">
            {event.url && (
              <a
                href={event.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  trackRsvpClick({ eventUrl: event.url, eventName: event.name, source: "card" });
                  social.noteRsvpClick(event);
                }}
                className="w-full rounded-full bg-[#1C1A14] px-4 py-3 text-center text-[14px] font-bold text-[#F7F2E7]"
              >
                {isApply ? "Apply on Partiful" : "RSVP on Partiful"}
              </a>
            )}
            <div className="flex gap-2">
              {social.enabled && (
                <button
                  onClick={() => void social.setGoing(event, !going)}
                  className={
                    "flex-1 rounded-full border px-4 py-2.5 text-[13px] font-bold " +
                    (going ? "border-[#0A8F5A] bg-[#00FF9C]/25 text-[#0A8F5A]" : "border-[#CDC1A6] text-[#1C1A14]")
                  }
                >
                  {going ? "✓ I'm going" : "I'm going"}
                </button>
              )}
              {p?.calendarFile && (
                <a
                  href={p.calendarFile}
                  className="flex-1 rounded-full border border-[#CDC1A6] px-4 py-2.5 text-center text-[13px] font-bold text-[#1C1A14]"
                >
                  Add to calendar
                </a>
              )}
            </div>
          </div>

          {hosts.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {hosts.slice(0, 6).map((h) => (
                <span key={h.id ?? h.name} className="inline-flex items-center gap-1.5 text-[12px] text-[#1C1A14]">
                  {h.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={h.photoUrl} alt="" className="size-5 rounded-full object-cover" />
                  ) : (
                    <Avatar name={h.name} size={20} />
                  )}
                  {h.name}
                </span>
              ))}
            </div>
          )}

          {description && (
            <div>
              <p className={"whitespace-pre-line text-[13px] leading-[1.5] text-[#3D3A30] " + (more ? "" : "line-clamp-6")}>{description}</p>
              {!more && description.length > 320 && (
                <button onClick={() => setMore(true)} className="mt-1 text-[12px] font-semibold text-[#0A8F5A]">
                  More
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
