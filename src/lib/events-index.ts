import { getEvents } from "@/lib/snapshot";

/** Snapshot loading already memoizes per process with a short TTL. */
export async function partifulIdToEventId(): Promise<Map<string, string>> {
  const { events, source } = await getEvents("sf");
  if (source === "none") throw new Error("Event directory is unavailable.");
  const result = new Map<string, string>();
  for (const event of events) {
    try {
      const url = new URL(event.url);
      if (!["partiful.com", "www.partiful.com"].includes(url.hostname)) continue;
      const id = url.pathname.match(/^\/e\/([A-Za-z0-9]{20})(?:\/|$)/)?.[1];
      if (id) result.set(id, event.id);
    } catch { /* A directory listing may have no registration URL. */ }
  }
  return result;
}
