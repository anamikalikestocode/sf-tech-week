import { NextResponse } from "next/server";
import { currentUser, db, newInviteCode, socialEnabled, startSession } from "@/lib/auth";
import { disconnectConnection, encryptFeed, fingerprint, getConnection, normalizeFeedUrl, syncConnection } from "@/lib/partiful-calendar";

export const runtime = "nodejs";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  if (!socialEnabled()) return json({ error: "Unavailable right now." }, 503);
  const body = await req.json().catch(() => null);
  const url = normalizeFeedUrl(body?.url);
  if (!url) return json({ error: "Paste your Partiful Calendar Sync link." }, 400);
  // No sign-up step: a valid Partiful link is enough. Create the account
  // silently (only after the link validates, so junk input never makes rows).
  let me = await currentUser();
  if (!me) {
    const { data, error } = await db()
      .from("sf_users")
      .insert({ name: "Partiful user", invite_code: newInviteCode() })
      .select("id, name, x_handle, pf_profile_id, invite_code, visibility")
      .single();
    if (error || !data) return json({ error: "Couldn't connect Partiful. Try again." }, 500);
    await startSession(data.id);
    me = data;
  }
  try {
    const { error } = await db().from("sf_partiful_connections").upsert({
      user_id: me.id, feed_enc: encryptFeed(url), feed_fp: fingerprint(url), last_synced_at: null,
    });
    if (error) throw new Error("save");
    const result = await syncConnection(me.id, url);
    if (result.error) return json({ error: result.error }, 502);
    return json({ connected: true, matched: result.matched, total: result.total });
  } catch {
    return json({ error: "Couldn't connect Partiful. Try again." }, 500);
  }
}

export async function GET() {
  const me = await currentUser();
  if (!me) return json({ error: "sign in first" }, 401);
  try {
    return json((await getConnection(me.id)).status);
  } catch {
    return json({ error: "Couldn't read Partiful status." }, 500);
  }
}

export async function DELETE() {
  const me = await currentUser();
  if (!me) return json({ error: "sign in first" }, 401);
  try {
    await disconnectConnection(me.id);
    return json({ ok: true });
  } catch {
    return json({ error: "Couldn't disconnect Partiful. Try again." }, 500);
  }
}
