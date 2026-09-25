import { NextResponse } from "next/server";
import { currentUser, db, socialEnabled } from "@/lib/auth";

// POST {eventId, partifulId?, going: boolean, source?}
export async function POST(req: Request) {
  if (!socialEnabled()) return NextResponse.json({ error: "disabled" }, { status: 503 });
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const eventId = typeof body?.eventId === "string" ? body.eventId.slice(0, 64) : "";
  if (!eventId) return NextResponse.json({ error: "eventId required" }, { status: 400 });
  const partifulId =
    typeof body?.partifulId === "string" && /^[A-Za-z0-9]{20}$/.test(body.partifulId) ? body.partifulId : null;
  const source = ["manual", "prompt", "link"].includes(body?.source) ? body.source : "manual";

  if (body?.going) {
    const { error } = await db()
      .from("sf_attendance")
      .upsert({ user_id: me.id, event_id: eventId, partiful_id: partifulId, status: "going", source, updated_at: new Date().toISOString() });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    await db().from("sf_attendance").delete().eq("user_id", me.id).eq("event_id", eventId);
  }
  return NextResponse.json({ ok: true });
}
