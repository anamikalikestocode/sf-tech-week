// Server-only. Connect Partiful via the user's personal calendar-sync feed.
//
// The user pastes their own feed URL (calendars.partiful.com/getCalendar?id=…).
// We fetch and parse the ICS server-side, extract Partiful event ids, match
// them to our Tech Week events, and store the associations in sf_attendance
// (source='calendar'). The feed URL is a secret bearer link: it's encrypted at
// rest and never sent back to the browser.

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { db } from "@/lib/auth";
import { partifulIdToEventId } from "@/lib/events-index";

const FEED_HOST = "calendars.partiful.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const STALE_MS = 6 * 60 * 60 * 1000;

// ---------- crypto (key derived from the service-role secret, no new env) ----------
let keyCache: Buffer | null = null;
function key(): Buffer {
  if (keyCache) return keyCache;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Calendar encryption is not configured.");
  keyCache = scryptSync(secret, "sf-partiful-calendar-v1", 32);
  return keyCache;
}
export function encryptFeed(url: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(url, "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}
export function decryptFeed(blob: string): string | null {
  try {
    const [iv, tag, enc] = blob.split(":").map((p) => Buffer.from(p, "base64"));
    const d = createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
export function fingerprint(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

// ---------- URL validation (also the SSRF guard) ----------
export function normalizeFeedUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^webcal:\/\//i, "https://");
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || u.hostname !== FEED_HOST || u.port || u.username || u.password) return null;
    if (u.pathname !== "/getCalendar" || u.searchParams.getAll("id").length !== 1 || !u.searchParams.get("id")?.trim()) return null;
    u.hash = "";
    u.searchParams.sort();
    return u.toString();
  } catch {
    return null;
  }
}

// ---------- ICS parsing ----------
function unfold(ics: string): string[] {
  // RFC 5545: a CRLF followed by a space/tab continues the previous line.
  return ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
}
function parseEvents(ics: string): Array<{ uid: string; url: string; desc: string }> {
  const out: Array<{ uid: string; url: string; desc: string }> = [];
  let cur: { uid: string; url: string; desc: string } | null = null;
  for (const line of unfold(ics)) {
    if (line === "BEGIN:VEVENT") { cur = { uid: "", url: "", desc: "" }; continue; }
    if (line === "END:VEVENT") { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    if (!line.includes(":")) continue;
    const key = line.split(/[:;]/, 1)[0].toUpperCase();
    const val = line.slice(line.indexOf(":") + 1);
    if (key === "UID") cur.uid = val.trim();
    else if (key === "URL") cur.url = val.trim();
    else if (key === "DESCRIPTION") cur.desc = val;
  }
  return out;
}

export function partifulIdsFromIcs(ics: string): string[] {
  const ids = new Set<string>();
  for (const ev of parseEvents(ics)) {
    for (const field of [ev.url, ev.desc]) {
      for (const m of field.matchAll(/https?:\/\/(?:www\.)?partiful\.com\/e\/([A-Za-z0-9]{20})(?![A-Za-z0-9])/g)) ids.add(m[1]);
    }
    if (/^[A-Za-z0-9]{20}$/.test(ev.uid)) ids.add(ev.uid);
  }
  return [...ids];
}

// ---------- sync ----------
export interface SyncResult {
  matched: number; // Tech Week events associated
  total: number; // events in the feed
  error?: string;
}

async function fetchIcs(url: string): Promise<string | null> {
  const safeUrl = normalizeFeedUrl(url);
  if (!safeUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    // Reject redirects so the allowlisted host remains the SSRF boundary.
    const res = await fetch(safeUrl, { signal: controller.signal, redirect: "error", headers: { "User-Agent": UA, Accept: "text/calendar" }, cache: "no-store" });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 5 * 1024 * 1024) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString("utf8").trim();
    // Never interpret an HTML/error/truncated response as an empty calendar.
    const lines = unfold(body);
    if (lines[0] !== "BEGIN:VCALENDAR" || lines[lines.length - 1] !== "END:VCALENDAR") return null;
    let depth = 0;
    for (const line of lines) {
      if (line === "BEGIN:VEVENT" && ++depth !== 1) return null;
      if (line === "END:VEVENT" && --depth !== 0) return null;
    }
    return depth === 0 ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Apply the fetched snapshot atomically, conditional on the saved connection. */
export async function syncConnection(userId: string, feedUrl: string): Promise<SyncResult> {
  const client = db();
  const fp = fingerprint(feedUrl);
  try {
    const ics = await fetchIcs(feedUrl);
    if (!ics) throw new Error("feed");
    const feedIds = partifulIdsFromIcs(ics);
    const map = await partifulIdToEventId();
    const rows = new Map<string, { event_id: string; partiful_id: string }>();
    for (const pid of feedIds) {
      const eventId = map.get(pid);
      if (eventId) rows.set(eventId, { event_id: eventId, partiful_id: pid });
    }
    const total = parseEvents(ics).length;
    const { data, error } = await client.rpc("sf_apply_partiful_calendar", {
      p_user_id: userId, p_feed_fp: fp, p_events: [...rows.values()], p_total: total,
    });
    if (error || data !== true) throw new Error("save");
    return { matched: rows.size, total };
  } catch {
    const error = "Couldn't sync your calendar. Check the link and try again.";
    await client.from("sf_partiful_connections").update({ last_error: error })
      .eq("user_id", userId).eq("feed_fp", fp);
    return { matched: 0, total: 0, error };
  }
}

export async function disconnectConnection(userId: string): Promise<void> {
  const { error } = await db().rpc("sf_disconnect_partiful_calendar", { p_user_id: userId });
  if (error) throw new Error("Couldn't disconnect Partiful. Try again.");
}

export interface ConnectionStatus {
  connected: boolean;
  lastSyncedAt: string | null;
  eventCount: number;
}

export async function getConnection(userId: string): Promise<{ status: ConnectionStatus; feedUrl: string | null; stale: boolean; fp: string | null; inPartiful: string[] }> {
  const { data, error } = await db().from("sf_partiful_connections").select("feed_enc, feed_fp, event_count, last_synced_at, imported_event_ids").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Could not read calendar status.");
  if (!data) return { status: { connected: false, lastSyncedAt: null, eventCount: 0 }, feedUrl: null, stale: false, fp: null, inPartiful: [] };
  const feedUrl = decryptFeed(data.feed_enc);
  const last = data.last_synced_at ? new Date(data.last_synced_at).getTime() : 0;
  return {
    status: { connected: true, lastSyncedAt: data.last_synced_at ?? null, eventCount: data.event_count ?? 0 },
    feedUrl,
    stale: Date.now() - last > STALE_MS,
    fp: data.feed_fp ?? null,
    inPartiful: data.imported_event_ids ?? [],
  };
}

/** Called from /api/social: keep a connected user's import fresh without a cron. */
export async function refreshIfStale(userId: string): Promise<void> {
  const { feedUrl, stale } = await getConnection(userId);
  if (feedUrl && stale) {
    try {
      await syncConnection(userId, feedUrl);
    } catch {
      /* best-effort */
    }
  }
}
