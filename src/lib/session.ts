// Anonymous, first-party session identity for NYC Tech Week product analytics.
//
// This is NOT user tracking: it's a random UUID stored in the visitor's own
// localStorage, with no link to any real identity, email, IP, or fingerprint.
// Its only job is to group a single browser's chat turns and RSVP clicks into
// one "session" so we can see how people actually use the product (funnels,
// which recs convert) — all in aggregate. Clearing site data wipes it.

const SESSION_KEY = "sftw_sid";

export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // Private mode / storage disabled — degrade silently, no tracking.
    return "";
  }
}

export type RsvpClickSource = "card" | "chat";

// Fire-and-forget RSVP click logging. Uses sendBeacon so the request survives
// the page/tab navigation that follows the click. NEVER throws — analytics must
// never interfere with the user actually getting to the event.
export function trackRsvpClick(data: {
  eventUrl: string;
  eventName?: string;
  source: RsvpClickSource;
}): void {
  if (typeof window === "undefined" || !data.eventUrl) return;
  try {
    const payload = JSON.stringify({
      session_id: getSessionId(),
      event_url: data.eventUrl,
      event_name: data.eventName ?? null,
      source: data.source,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/track",
        new Blob([payload], { type: "application/json" })
      );
    } else {
      void fetch("/api/track", {
        method: "POST",
        body: payload,
        headers: { "content-type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // swallow — tracking is best-effort only
  }
}
