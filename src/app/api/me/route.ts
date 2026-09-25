import { NextResponse } from "next/server";
import {
  cleanName,
  cleanPartifulProfile,
  cleanXHandle,
  currentUser,
  db,
  endSession,
  newInviteCode,
  socialEnabled,
  startSession,
} from "@/lib/auth";

// GET: who am I. POST: create profile (or update it if signed in). DELETE: sign out.
export async function GET() {
  if (!socialEnabled()) return NextResponse.json({ enabled: false, me: null });
  const me = await currentUser();
  return NextResponse.json({ enabled: true, me });
}

export async function POST(req: Request) {
  if (!socialEnabled()) return NextResponse.json({ error: "disabled" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const name = cleanName(body?.name);
  const x_handle = body?.xHandle === undefined ? undefined : cleanXHandle(body?.xHandle);
  const pf_profile_id = body?.partifulProfile === undefined ? undefined : cleanPartifulProfile(body?.partifulProfile);
  const visibility = body?.visibility === "nobody" ? "nobody" : body?.visibility === "friends" ? "friends" : undefined;

  const me = await currentUser();
  if (me) {
    const patch: Record<string, unknown> = {};
    if (name) patch.name = name;
    if (x_handle !== undefined) patch.x_handle = x_handle;
    if (pf_profile_id !== undefined) patch.pf_profile_id = pf_profile_id;
    if (visibility) patch.visibility = visibility;
    const { data, error } = await db().from("sf_users").update(patch).eq("id", me.id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ enabled: true, me: data });
  }

  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const { data, error } = await db()
    .from("sf_users")
    .insert({ name, x_handle: x_handle ?? null, pf_profile_id: pf_profile_id ?? null, invite_code: newInviteCode() })
    .select()
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "create failed" }, { status: 500 });
  await startSession(data.id);
  return NextResponse.json({ enabled: true, me: data });
}

export async function DELETE() {
  if (socialEnabled()) await endSession();
  return NextResponse.json({ ok: true });
}
