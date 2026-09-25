import { NextResponse } from "next/server";
import { currentUser, db, socialEnabled } from "@/lib/auth";

import { getConnection, refreshIfStale } from "@/lib/partiful-calendar";

// Everything the page needs for the viewer, in one request:
//   me, friends (with Partiful profile ids for "Hosted by a friend"),
//   which events each friend is going to, and the viewer's own RSVPs.
// Friends who set visibility 'nobody' are listed as friends but contribute no
// attendance, so a count can never reveal a hidden person.
// How many connected people are going to each event, excluding anyone who set
// visibility 'nobody' plus the ids in `exclude` (the viewer and their friends,
// who are shown by name instead). Paged: PostgREST caps each response.
async function crowdCounts(client: ReturnType<typeof db>, exclude: Set<string>): Promise<Record<string, number>> {
  const { data: hidden } = await client.from("sf_users").select("id").eq("visibility", "nobody");
  const skip = new Set([...(hidden ?? []).map((h) => h.id as string), ...exclude]);
  const crowd: Record<string, number> = {};
  const PAGE = 1000;
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data } = await client.from("sf_attendance").select("user_id, event_id").eq("status", "going").order("user_id").range(from, from + PAGE - 1);
    for (const r of data ?? []) {
      if (skip.has(r.user_id)) continue;
      crowd[r.event_id] = (crowd[r.event_id] ?? 0) + 1;
    }
    if (!data || data.length < PAGE) break;
  }
  return crowd;
}

export async function GET() {
  if (!socialEnabled()) return NextResponse.json({ enabled: false });
  const client = db();
  const me = await currentUser();
  if (!me) {
    let crowd: Record<string, number> = {};
    try { crowd = await crowdCounts(client, new Set()); } catch { /* best-effort */ }
    return NextResponse.json({ enabled: true, me: null, crowd });
  }

  let connection;
  try {
    await refreshIfStale(me.id);
    connection = await getConnection(me.id);
  } catch { /* Preserve social functionality if calendar storage is unavailable. */ }
  const [{ data: asA }, { data: asB }, { data: mine }] = await Promise.all([
    client.from("sf_friendships").select("user_b").eq("user_a", me.id),
    client.from("sf_friendships").select("user_a").eq("user_b", me.id),
    client.from("sf_attendance").select("event_id").eq("user_id", me.id),
  ]);
  const friendIds = [...(asA ?? []).map((r) => r.user_b), ...(asB ?? []).map((r) => r.user_a)];

  let friends: Array<{ id: string; name: string; x_handle: string | null; pf_profile_id: string | null; visibility: string }> = [];
  let going: Record<string, string[]> = {};
  if (friendIds.length > 0) {
    const [{ data: fr }, { data: att }] = await Promise.all([
      client.from("sf_users").select("id, name, x_handle, pf_profile_id, visibility").in("id", friendIds),
      client.from("sf_attendance").select("user_id, event_id").in("user_id", friendIds).eq("status", "going"),
    ]);
    friends = fr ?? [];
    const visible = new Set(friends.filter((f) => f.visibility === "friends").map((f) => f.id));
    going = {};
    for (const r of att ?? []) {
      if (!visible.has(r.user_id)) continue;
      (going[r.event_id] ??= []).push(r.user_id);
    }
  }

  let crowd: Record<string, number> = {};
  try { crowd = await crowdCounts(client, new Set([me.id, ...friendIds])); } catch { /* best-effort */ }

  return NextResponse.json({
    enabled: true,
    crowd,
    me,
    friends: friends.map((f) => ({ id: f.id, name: f.name, xHandle: f.x_handle, pfProfileId: f.visibility === "friends" ? f.pf_profile_id : null })),
    going,
    inPartiful: connection?.inPartiful ?? [],
    partiful: connection?.status ?? { connected: false, lastSyncedAt: null, eventCount: 0 },
    mine: (mine ?? []).map((r) => r.event_id),
  });
}
