// Lightweight accounts for the friends-going feature.
//
// No passwords and no third-party sign-in yet: creating a profile issues a
// random session token in an httpOnly cookie; only its sha256 is stored.
// Friendship is by invite link (sharing the link is the sharer's consent,
// accepting it is the accepter's), so a self-chosen display name is only ever
// shown to people who explicitly connected with you.

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export const SESSION_COOKIE = "sftw_session";
const ONE_YEAR = 60 * 60 * 24 * 365;

export interface Me {
  id: string;
  name: string;
  x_handle: string | null;
  pf_profile_id: string | null;
  invite_code: string;
  visibility: "friends" | "nobody";
}

export function socialEnabled(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function db() {
  return createAdminClient();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newInviteCode(): string {
  // 10 chars, unambiguous alphabet
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function currentUser(): Promise<Me | null> {
  if (!socialEnabled()) return null;
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length < 32) return null;
  const { data } = await db()
    .from("sf_sessions")
    .select("user_id, sf_users(id, name, x_handle, pf_profile_id, invite_code, visibility)")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  const u = (data as unknown as { sf_users: Me | null } | null)?.sf_users;
  return u ?? null;
}

export async function startSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await db().from("sf_sessions").insert({ token_hash: hashToken(token), user_id: userId });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db().from("sf_sessions").delete().eq("token_hash", hashToken(token));
  jar.delete(SESSION_COOKIE);
}

/** Canonical pair ordering for sf_friendships (user_a < user_b). */
export function pair(a: string, b: string): { user_a: string; user_b: string } {
  return a < b ? { user_a: a, user_b: b } : { user_a: b, user_b: a };
}

export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, 60);
  return s.length > 0 ? s : null;
}

export function cleanXHandle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").split(/[/?#]/)[0];
  return /^[A-Za-z0-9_]{1,15}$/.test(s) ? s : null;
}

/** Accepts a partiful.com/u/<id> link or a bare id. */
export function cleanPartifulProfile(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/(?:partiful\.com\/u\/)?([A-Za-z0-9]{20,40})$/);
  return m ? m[1] : null;
}
