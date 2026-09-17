// Server-only loader for the scraped Tech Week snapshot.
//
// Since June 2026 tech-week.com sits behind Vercel's bot challenge and hides
// every event link behind a /go/event/<token> redirect that only honours
// user-initiated navigations. The site therefore no longer scrapes live at
// request time; scripts/scrape-techweek.mjs drives a real Chrome on a laptop,
// produces data/<city>-events.json, and uploads it to the public `techweek`
// Supabase Storage bucket. This module reads that JSON (remote first, local
// file as fallback) and maps it to TechWeekEvent[].
//
// Do NOT import this from a client component — it touches node:fs.

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  classifyEvent,
  bucketTimeOfDay,
  type TechWeekEvent,
} from "./events";
import type { PartifulData } from "./partiful";
import type { CitySlug } from "./cities";

interface SnapshotEvent {
  id: string;
  name: string;
  date: string;
  time: string;
  location: string;
  company: string;
  url: string;
  goHref?: string;
  isInviteOnly: boolean;
  isFeatured?: boolean;
  registrationStatus?: string | null;
  imageUrl?: string | null;
  sponsors?: string[];
  hosts?: string[];
  timeLabel?: string | null;
  partiful: (PartifulData & { title?: string }) | null;
  partifulError?: string | null;
}

interface Snapshot {
  city: string;
  scrapedAt: string;
  events: SnapshotEvent[];
}

export interface EventsResult {
  events: TechWeekEvent[];
  /** ISO timestamp of the scrape, null when served from the legacy live path */
  scrapedAt: string | null;
  source: "remote" | "local" | "none";
}

const REMOTE_TTL_SECONDS = 300;

function remoteUrl(city: CitySlug): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base || base.includes("your-project")) return null;
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/techweek/${city}-events.json`;
}

async function loadRemote(city: CitySlug): Promise<Snapshot | null> {
  const url = remoteUrl(city);
  if (!url) return null;
  try {
    const res = await fetch(url, { next: { revalidate: REMOTE_TTL_SECONDS } });
    if (!res.ok) return null;
    const json = (await res.json()) as Snapshot;
    return Array.isArray(json?.events) ? json : null;
  } catch {
    return null;
  }
}

async function loadLocal(city: CitySlug): Promise<Snapshot | null> {
  try {
    const file = path.join(process.cwd(), "data", `${city}-events.json`);
    const json = JSON.parse(await fs.readFile(file, "utf8")) as Snapshot;
    return Array.isArray(json?.events) ? json : null;
  } catch {
    return null;
  }
}

function toEvent(raw: SnapshotEvent): TechWeekEvent {
  const { topics, formats } = classifyEvent(raw.name ?? "", raw.company ?? "");
  const event: TechWeekEvent = {
    id: String(raw.id),
    name: raw.name,
    date: raw.date,
    time: raw.time,
    location: raw.location ?? "",
    company: raw.company ?? "",
    url: raw.url ?? "",
    isInviteOnly: !!raw.isInviteOnly,
    isFeatured: !!raw.isFeatured,
    registrationStatus: raw.registrationStatus ?? null,
    imageUrl: raw.imageUrl ?? null,
    hosts: raw.hosts ?? [],
    topics,
    formats,
    timeOfDay: bucketTimeOfDay(raw.timeLabel, raw.time),
  };
  if (raw.partiful) {
    // Strip the scraper-only `title` so the object matches PartifulData.
    const { title: _title, ...p } = raw.partiful;
    void _title;
    event.partiful = p;
  }
  return event;
}

// Module-level memo so concurrent renders (e.g. /en/sf + /fr/sf) share one
// load. Short TTL — the remote fetch is itself cached by Next for 5 min.
const memo = new Map<CitySlug, { at: number; promise: Promise<EventsResult> }>();
const MEMO_TTL = 60 * 1000;

export function getEvents(city: CitySlug): Promise<EventsResult> {
  const hit = memo.get(city);
  if (hit && Date.now() - hit.at < MEMO_TTL) return hit.promise;
  const promise = loadEvents(city);
  memo.set(city, { at: Date.now(), promise });
  return promise;
}

async function loadEvents(city: CitySlug): Promise<EventsResult> {
  const remote = await loadRemote(city);
  if (remote) {
    return { events: remote.events.map(toEvent), scrapedAt: remote.scrapedAt, source: "remote" };
  }
  const local = await loadLocal(city);
  if (local) {
    return { events: local.events.map(toEvent), scrapedAt: local.scrapedAt, source: "local" };
  }
  return { events: [], scrapedAt: null, source: "none" };
}
