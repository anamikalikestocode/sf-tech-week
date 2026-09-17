"use client";

import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { ArrowUp, X } from "lucide-react";
import type { TechWeekEvent } from "@/lib/events";
import type { CityConfig } from "@/lib/cities";
import { rsvpsLast } from "@/lib/momentum";
import {
  collisionMap,
  collisions,
  demandRatio,
  extraQuestions,
  formAsks,
  plusOnes,
  questionCount,
  spotsLeft,
  venueName,
  vibes,
  waitlisted,
  ticketEconomics,
  fmtRange,
} from "@/lib/insights";
import { getSessionId, trackRsvpClick } from "@/lib/session";

// Delegated click handler for streamed assistant messages: the response HTML is
// injected via dangerouslySetInnerHTML, so we can't put onClick on each link.
// Instead listen on the container and detect anchor clicks bubbling up.
function handleChatLinkClick(e: React.MouseEvent<HTMLDivElement>) {
  const anchor = (e.target as HTMLElement).closest("a");
  const href = anchor?.getAttribute("href");
  if (href) {
    trackRsvpClick({
      eventUrl: href,
      eventName: anchor?.textContent?.trim() || undefined,
      source: "chat",
    });
  }
}

function buildEventContext(events: TechWeekEvent[], city: CityConfig): string {
  // Feed the model EVERY event. Lines are compact so the full ~1,700-event
  // block stays token-reasonable; the API route marks it for Anthropic prompt
  // caching. Sorted by date/time (neutral ordering) so the model isn't primed
  // toward the biggest events.
  const cm = collisionMap(events);
  const lines = [...events]
    .sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      return d !== 0 ? d : a.time.localeCompare(b.time);
    })
    .map((e) => {
      const time = e.time ? e.time.slice(0, 5) : "";
      const place = e.partiful?.neighborhood || e.location || "";
      const venue = venueName(e);
      const parts: string[] = [e.name, e.company, `${e.date} ${time}`.trim(), venue ? `${place} @ ${venue}` : place];

      const p = e.partiful;
      if (p?.countsHidden) {
        parts.push("host hides guest count", p.atCapacity ? "FULL" : "", p.guestAction === "APPLY" ? "APPLY" : "RSVP");
      } else if (p) {
        // Acceptance rate only when Partiful exposed a real applicant pool
        // (applied > approved); otherwise every APPLY event would read 100%.
        const applied = p.appliedCount ?? p.approvedCount + p.pendingCount;
        const approvalRate =
          p.guestAction === "APPLY" && applied > p.approvedCount ? Math.round((p.approvedCount / applied) * 100) : null;
        const count = p.guestAction === "APPLY" ? p.approvedCount : p.guestCount;
        const ratio = demandRatio(e);
        const left = spotsLeft(e);
        const wl = waitlisted(e);
        parts.push(
          `${count} ${p.guestAction === "APPLY" ? "appr" : "going"}`,
          approvalRate !== null ? `${approvalRate}% accepted of ${applied} applied${(p.rejectedCount ?? 0) > 0 ? ` (${p.rejectedCount} rejected)` : ""}` : "",
          p.interestedCount > 0 ? `${p.interestedCount} interested` : "",
          wl > 0 ? `${wl} waitlisted` : "",
          p.isCapped && p.maxCapacity ? `cap ${p.maxCapacity}` : "",
          left !== null && left > 0 ? `${left} left` : "",
          ratio !== null && ratio >= 1 ? `${Math.round(ratio * 100)}% oversubscribed` : "",
          p.atCapacity ? "FULL" : "",
          p.guestAction === "APPLY" ? "APPLY" : "RSVP"
        );
      } else {
        parts.push("no RSVP data");
      }

      if (p) {
        const q = questionCount(e);
        const asks = formAsks(e);
        const extra = extraQuestions(e).slice(0, 2).map((x) => x.text.replace(/\?$/, "").slice(0, 50));
        const econ = ticketEconomics(e);
        if (econ) parts.push(`paid: ${econ.tickets} tickets × ${econ.priceLow === econ.priceHigh ? `$${econ.priceLow}` : `$${econ.priceLow}-$${econ.priceHigh}`} ≈ ${fmtRange(econ.hostLow, econ.hostHigh)} to host, ${fmtRange(econ.partifulLow, econ.partifulHigh)} to Partiful`);
        parts.push(
          q > 0 ? `${q}Q form${asks.length ? ` asks ${asks.join("/")}` : ""}${extra.length ? `: ${extra.join("; ")}` : ""}` : p.guestAction !== "APPLY" ? "no form" : "",
          plusOnes(e) > 0 ? `+${plusOnes(e)} plus-ones` : "",
          vibes(e).filter((v) => ["food", "drinks", "free", "paid", "multi-day"].includes(v)).join("/")
        );
      }

      if (p && rsvpsLast(e, 2) >= 5) parts.push(`+${rsvpsLast(e, 2)} RSVPs last 48h`);
      if (p?.countsReconstructed) parts.push("host hid the count; numbers are from the live guest list");
      const others = collisions(e, cm);
      parts.push(
        others > 0 ? `${others} others same hour` : "",
        e.topics.join("/"),
        e.isInviteOnly ? "invite-only" : "",
        e.url || ""
      );
      return parts.filter(Boolean).join(" | ");
    })
    .join("\n");

  return `Here are ALL ${events.length} ${city.title} events (${city.dateRange}). Fields per line, pipe-separated: name | host | date time | neighborhood @ venue | attendance (X going/appr) | "N% accepted of M applied" (only when Partiful exposes the applicant pool) | N interested | N waitlisted | cap N | N left (exact spots) | N% oversubscribed (demand vs cap) | FULL? | RSVP-or-APPLY | application form summary ("7Q form asks funding/investor: <extra questions>", or "no form") | +N plus-ones | vibes (food/drinks/free/paid/multi-day, from the description) | N others same hour | topics | invite-only? | url. Events without live data are marked "no RSVP data"; "host hides guest count" means the host turned Partiful's counter off.\n${lines}`;
}

function getMessageText(msg: { parts: Array<{ type: string; text?: string }> }): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function formatResponse(text: string): string {
  return text
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-[#0A8F5A] underline underline-offset-2 hover:opacity-80 transition-opacity">$1</a>'
    )
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br />");
}

export function EventChat({
  events,
  city,
}: {
  events: TechWeekEvent[];
  city: CityConfig;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const desktopScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const eventContext = useMemo(() => buildEventContext(events, city), [events, city]);

  // Anonymous session id so the API can group chat turns into conversations.
  // Computed once on the client (returns "" during SSR, real id after mount).
  const sessionId = useMemo(() => getSessionId(), []);

  const transport = useMemo(
    () =>
      new TextStreamChatTransport({
        api: "/api/chat",
        body: { eventContext, sessionId, city: city.slug },
      }),
    [eventContext, sessionId, city.slug]
  );

  const { messages, sendMessage, status } = useChat({ transport });
  const isLoading = status === "streaming" || status === "submitted";

  const scrollToBottom = useCallback(() => {
    for (const ref of [scrollRef, desktopScrollRef]) {
      if (ref.current) {
        // Instant scroll, not "smooth" — on mobile, firing a smooth-scroll
        // animation on every token-stream tick thrashes the GPU and makes
        // the streamed text appear to lag/stutter.
        ref.current.scrollTop = ref.current.scrollHeight;
      }
    }
  }, []);

  useEffect(() => {
    if (isExpanded) {
      // Hide the main site's floating chat bubble
      const fab = document.querySelector('[aria-label="Open concierge"]') as HTMLElement | null;
      if (fab) fab.style.display = "none";
      setTimeout(() => inputRef.current?.focus(), 100);
      return () => {
        if (fab) fab.style.display = "";
      };
    }
  }, [isExpanded]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    if (!isExpanded) setIsExpanded(true);
    sendMessage({ text: input.trim() });
    setInput("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }

  function handlePromptClick(prompt: string) {
    if (!isExpanded) setIsExpanded(true);
    sendMessage({ text: prompt });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e);
    }
  }

  // Collapsed state — the entire card is one tap/click target that opens the
  // full chat. This lets users reopen an existing conversation without having
  // to send a new message (user feedback). The real input lives in the
  // expanded view and auto-focuses on open.
  if (!isExpanded) {
    const hasHistory = messages.length > 0;

    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded(true);
          }
        }}
        className="mb-6 cursor-pointer rounded-[18px] border-[1.5px] border-[#00FF9C]/55 [background:color-mix(in_srgb,#00FF9C_9%,#F7F2E7)] shadow-[0_4px_24px_-8px_rgba(0,255,156,0.22)] transition-all duration-[160ms] hover:border-[#00FF9C]"
      >
        {/* Header row */}
        <div className="flex items-center gap-4 p-4 pb-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-[13px] bg-[#00FF9C] text-[22px] text-[#0C0C0A]">
            ✦
          </div>
          <div className="min-w-0 flex-1">
            <h2
              className="font-extrabold tracking-[-0.025em] text-[#1C1A14]"
              style={{ fontSize: "clamp(18px,2.4vw,23px)" }}
            >
              Ask me anything
            </h2>
            <p className="text-[13px] text-[#766E5C]">
              {hasHistory ? "Tap to continue your chat" : `${city.title} · live data`}
            </p>
          </div>
        </div>

        {/* Prompt chips — tapping one sends that prompt; stopPropagation keeps
            the chip's own action from also triggering the card's open handler
            (handlePromptClick already opens the chat). */}
        {!hasHistory && (
          <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide">
            {city.suggestedPrompts.map((prompt) => (
              <button
                key={prompt}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePromptClick(prompt);
                }}
                className="shrink-0 rounded-full border border-[#00FF9C]/50 bg-[#00FF9C]/15 px-3 py-1.5 text-[13px] font-medium text-[#0A8F5A] transition-colors hover:bg-[#00FF9C]/25 hover:border-[#00FF9C]"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {/* Input — visual trigger only. Tapping it opens the full chat (the
            click bubbles to the card), where the real textarea is focused. */}
        <div className="border-t border-[#00FF9C]/25 px-3 pb-3 pt-2.5">
          <div className="flex items-center gap-2 rounded-[12px] border border-[#CDC1A6] bg-[#F7F2E7] px-4 py-2.5">
            <span className="flex-1 truncate text-[16px] leading-snug text-[#A79E89]">
              {hasHistory ? "Continue the conversation…" : "Ask about events, vibes, availability…"}
            </span>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#1C1A14] text-[#E9E2D3]">
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </span>
          </div>
        </div>
      </div>
    );
  }

  const hasMessages = messages.length > 0 || isLoading;

  // Expanded state — full-screen overlay on mobile, large inline on desktop
  return (
    <>
      {/* Mobile: full-screen overlay */}
      <div className="fixed inset-0 z-50 flex flex-col bg-[#F7F2E7] lg:hidden">
        {/* Drag handle / tap-to-close hint */}
        <div
          className="flex shrink-0 justify-center pt-3 pb-1 cursor-pointer"
          onClick={() => setIsExpanded(false)}
        >
          <div className="h-1 w-10 rounded-full bg-[#DDD3BD]" />
        </div>
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-1">
          <h2 className="text-xl font-bold tracking-tight text-[#1C1A14]">
            Ask me anything
          </h2>
          <button
            onClick={() => setIsExpanded(false)}
            className="flex size-8 items-center justify-center rounded-full bg-[#F0E8D9] text-[#766E5C] transition-colors active:bg-[#DDD3BD]"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
          {!hasMessages && (
            <div className="flex h-full flex-col items-center justify-center px-6">
              <div className="flex flex-col gap-2 w-full max-w-sm">
                {city.suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handlePromptClick(prompt)}
                    className="rounded-[14px] border border-[#00FF9C]/50 bg-[#00FF9C]/15 px-4 py-3 text-left text-[14px] font-medium text-[#0A8F5A] transition-colors active:bg-[#00FF9C]/25"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasMessages && (
            <div className="px-5 py-4 space-y-6">
              {messages
                .filter((m) => m.role === "user" || m.role === "assistant")
                .map((msg) => {
                  const text = getMessageText(msg);
                  if (msg.role === "user" && !text) return null;
                  return (
                    <div key={msg.id}>
                      {msg.role === "user" ? (
                        <div className="flex justify-end">
                          <div className="max-w-[85%] rounded-[16px] rounded-br-[4px] bg-[#1C1A14] px-4 py-3 text-[15px] leading-relaxed text-[#E9E2D3]">
                            {text}
                          </div>
                        </div>
                      ) : text ? (
                        <div className="text-[15px] leading-[1.7] text-[#1C1A14] [&_strong]:font-semibold [&_strong]:text-[#1C1A14]">
                          <div onClick={handleChatLinkClick} dangerouslySetInnerHTML={{ __html: formatResponse(text) }} />
                        </div>
                      ) : (
                        <TypingIndicator />
                      )}
                    </div>
                  );
                })}

              {isLoading && messages.filter(m => m.role === "assistant").length === 0 && (
                <TypingIndicator />
              )}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-[#DDD3BD] px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
          <form
            onSubmit={onSubmit}
            className="flex items-center gap-2 rounded-[14px] border border-[#CDC1A6] bg-[#F0E8D9] px-4 py-2.5 transition-colors focus-within:border-[#00FF9C]"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about events..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-[16px] leading-snug text-[#1C1A14] placeholder:text-[#A79E89] outline-none"
              style={{ maxHeight: "120px" }}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#1C1A14] text-[#E9E2D3] transition-all disabled:opacity-20"
            >
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </button>
          </form>
        </div>
      </div>

      {/* Desktop: backdrop to tap-outside-to-close */}
      <div className="fixed inset-0 z-40 hidden lg:block" onClick={() => setIsExpanded(false)} />

      {/* Desktop: large inline card */}
      <div className="mb-6 hidden lg:flex flex-col overflow-hidden rounded-[18px] border border-[#CDC1A6] bg-[#F7F2E7] relative z-50" style={{ height: "min(62vh, 520px)" }}>
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#DDD3BD] px-6 py-3.5">
          <h2 className="text-lg font-bold tracking-tight text-[#1C1A14]">
            Ask me anything
          </h2>
          <button
            onClick={() => setIsExpanded(false)}
            className="flex size-8 items-center justify-center rounded-full bg-[#F0E8D9] text-[#766E5C] transition-colors hover:bg-[#DDD3BD]"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto desktop-scroll" ref={desktopScrollRef}>
          {!hasMessages && (
            <div className="flex h-full flex-col items-center justify-center px-6 py-12">
              <div className="flex flex-wrap justify-center gap-2">
                {city.suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handlePromptClick(prompt)}
                    className="rounded-full border border-[#00FF9C]/50 bg-[#00FF9C]/15 px-3.5 py-2 text-sm font-medium text-[#0A8F5A] transition-colors hover:bg-[#00FF9C]/25 hover:border-[#00FF9C]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasMessages && (
            <div className="px-6 py-5 space-y-6">
              {messages
                .filter((m) => m.role === "user" || m.role === "assistant")
                .map((msg) => {
                  const text = getMessageText(msg);
                  if (msg.role === "user" && !text) return null;
                  return (
                    <div key={msg.id}>
                      {msg.role === "user" ? (
                        <div className="flex justify-end">
                          <div className="max-w-[75%] rounded-[16px] rounded-br-[4px] bg-[#1C1A14] px-4 py-3 text-[14px] leading-relaxed text-[#E9E2D3]">
                            {text}
                          </div>
                        </div>
                      ) : text ? (
                        <div className="max-w-[90%] text-[14px] leading-[1.7] text-[#1C1A14] [&_strong]:font-semibold [&_strong]:text-[#1C1A14]">
                          <div onClick={handleChatLinkClick} dangerouslySetInnerHTML={{ __html: formatResponse(text) }} />
                        </div>
                      ) : (
                        <TypingIndicator />
                      )}
                    </div>
                  );
                })}

              {isLoading && messages.filter(m => m.role === "assistant").length === 0 && (
                <TypingIndicator />
              )}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-[#DDD3BD] px-5 py-3">
          <form
            onSubmit={onSubmit}
            className="flex items-center gap-2 rounded-[14px] border border-[#CDC1A6] bg-[#F0E8D9] px-4 py-2.5 transition-colors focus-within:border-[#00FF9C]"
          >
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about events, vibes, availability..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm leading-snug text-[#1C1A14] placeholder:text-[#A79E89] outline-none"
              style={{ maxHeight: "120px" }}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#1C1A14] text-[#E9E2D3] transition-all disabled:opacity-20"
            >
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-2">
      <span className="size-[6px] animate-bounce rounded-full bg-[#A79E89]" style={{ animationDelay: "0ms", animationDuration: "1s" }} />
      <span className="size-[6px] animate-bounce rounded-full bg-[#A79E89]" style={{ animationDelay: "150ms", animationDuration: "1s" }} />
      <span className="size-[6px] animate-bounce rounded-full bg-[#A79E89]" style={{ animationDelay: "300ms", animationDuration: "1s" }} />
    </div>
  );
}
