import { NextResponse } from "next/server";
import { currentUser, db, pair, socialEnabled } from "@/lib/auth";

// GET ?code=<invite>: preview whose invite this is (name only).
// POST {code}: accept the invite -> friendship between the viewer and the link owner.
// DELETE {friendId}: remove a friend.

export async function GET(req: Request) {
  if (!socialEnabled()) return NextResponse.json({ error: "disabled" }, { status: 503 });
  const code = new URL(req.url).searchParams.get("code")?.slice(0, 20) ?? "";
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });
  const { data } = await db().from("sf_users").select("id, name, x_handle").eq("invite_code", code).maybeSingle();
  if (!data) return NextResponse.json({ error: "invalid invite" }, { status: 404 });
  const me = await currentUser();
  return NextResponse.json({ inviter: { name: data.name, xHandle: data.x_handle }, isSelf: me?.id === data.id });
}

export async function POST(req: Request) {
  if (!socialEnabled()) return NextResponse.json({ error: "disabled" }, { status: 503 });
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const code = typeof body?.code === "string" ? body.code.slice(0, 20) : "";
  const { data: owner } = await db().from("sf_users").select("id, name").eq("invite_code", code).maybeSingle();
  if (!owner) return NextResponse.json({ error: "invalid invite" }, { status: 404 });
  if (owner.id === me.id) return NextResponse.json({ ok: true, self: true });
  const { error } = await db().from("sf_friendships").upsert(pair(me.id, owner.id), { ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, friend: { id: owner.id, name: owner.name } });
}

export async function DELETE(req: Request) {
  if (!socialEnabled()) return NextResponse.json({ error: "disabled" }, { status: 503 });
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const friendId = typeof body?.friendId === "string" ? body.friendId : "";
  const p = pair(me.id, friendId);
  await db().from("sf_friendships").delete().eq("user_a", p.user_a).eq("user_b", p.user_b);
  return NextResponse.json({ ok: true });
}
