import { NextResponse } from "next/server";
import { currentUser, db, socialEnabled } from "@/lib/auth";

// Everything the page needs for the viewer, in one request:
//   me, friends (with Partiful profile ids for "Hosted by a friend"),
//   which events each friend is going to, and the viewer's own RSVPs.
// Friends who set visibility 'nobody' are listed as friends but contribute no
// attendance, so a count can never reveal a hidden person.
export async function GET() {
  if (!socialEnabled()) return NextResponse.json({ enabled: false });
  const me = await currentUser();
  if (!me) return NextResponse.json({ enabled: true, me: null });

  const client = db();
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

  return NextResponse.json({
    enabled: true,
    me,
    friends: friends.map((f) => ({ id: f.id, name: f.name, xHandle: f.x_handle, pfProfileId: f.visibility === "friends" ? f.pf_profile_id : null })),
    going,
    mine: (mine ?? []).map((r) => r.event_id),
  });
}
