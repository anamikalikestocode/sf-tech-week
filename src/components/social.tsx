"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { TechWeekEvent } from "@/lib/events";

// ---------- types ----------

export interface Me {
  id: string;
  name: string;
  x_handle: string | null;
  pf_profile_id: string | null;
  invite_code: string;
  visibility: "friends" | "nobody";
}
export interface Friend {
  id: string;
  name: string;
  xHandle: string | null;
  pfProfileId: string | null;
}

interface PartifulStatus { connected: boolean; lastSyncedAt: string | null; eventCount: number }
const NO_PARTIFUL: PartifulStatus = { connected: false, lastSyncedAt: null, eventCount: 0 };

interface SocialState {
  inPartiful: Set<string>;
  partiful: PartifulStatus;
  enabled: boolean;
  me: Me | null;
  friends: Friend[];
  friendsById: Map<string, Friend>;
  going: Record<string, string[]>;
  mine: Set<string>;
}

interface SocialApi extends SocialState {
  friendsGoing: (eventId: string) => Friend[];
  hostFriends: (event: TechWeekEvent) => Friend[];
  setGoing: (event: TechWeekEvent, going: boolean, source?: "manual" | "prompt") => Promise<void>;
  openAccount: (then?: () => void) => void;
  noteRsvpClick: (event: TechWeekEvent) => void;
}

const EMPTY: SocialState = { inPartiful: new Set(), partiful: NO_PARTIFUL, enabled: false, me: null, friends: [], friendsById: new Map(), going: {}, mine: new Set() };

const SocialContext = createContext<SocialApi>({
  ...EMPTY,
  friendsGoing: () => [],
  hostFriends: () => [],
  setGoing: async () => {},
  openAccount: () => {},
  noteRsvpClick: () => {},
});

export function useSocial(): SocialApi {
  return useContext(SocialContext);
}

function partifulId(url: string): string | null {
  return url.match(/partiful\.com\/e\/([A-Za-z0-9]{20})/)?.[1] ?? null;
}

// ---------- avatar ----------

const AVATAR_COLORS = ["#0A8F5A", "#1E4F80", "#8F2A50", "#7A5A00", "#4A3A9C", "#0F5C6B", "#8E3A1E"];
export function Avatar({ name, xHandle, size = 20 }: { name: string; xHandle?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const bg = AVATAR_COLORS[h % AVATAR_COLORS.length];
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (xHandle && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`https://unavatar.io/x/${xHandle}?fallback=false`}
        alt=""
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full border border-[#F7F2E7] object-cover"
        style={style}
      />
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full border border-[#F7F2E7] font-bold text-white" style={{ ...style, background: bg }}>
      {initials}
    </span>
  );
}

export function firstName(name: string): string {
  return name.split(/\s+/)[0];
}

/** "Priya, Sam +1 going" with overlapping avatars. Renders nothing when empty. */
export function FriendsGoingRow({ friends, compact = false }: { friends: Friend[]; compact?: boolean }) {
  if (friends.length === 0) return null;
  const names = friends.slice(0, 2).map((f) => firstName(f.name)).join(", ");
  const label = friends.length === 1 ? `${names} going` : `${friends.length} going · ${names}${friends.length > 2 ? "…" : ""}`;
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex -space-x-1.5">
        {friends.slice(0, 3).map((f) => (
          <Avatar key={f.id} name={f.name} xHandle={f.xHandle} size={compact ? 18 : 22} />
        ))}
      </div>
      <span className="truncate text-[12px] font-semibold text-[#0A8F5A]">{label}</span>
    </div>
  );
}

// ---------- provider ----------

export function SocialProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SocialState>(EMPTY);
  const [accountOpen, setAccountOpen] = useState(false);
  const afterAccount = useRef<(() => void) | null>(null);
  const [invite, setInvite] = useState<{ code: string; inviter: string } | null>(null);
  const [prompt, setPrompt] = useState<TechWeekEvent | null>(null);
  const pendingRsvp = useRef<{ event: TechWeekEvent; at: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/social", { cache: "no-store" });
      const j = await r.json();
      if (!j.enabled) return setState({ ...EMPTY, enabled: false });
      const friends: Friend[] = j.friends ?? [];
      setState({
        enabled: true,
        me: j.me ?? null,
        friends,
        friendsById: new Map(friends.map((f) => [f.id, f])),
        going: j.going ?? {},
        mine: new Set<string>(j.mine ?? []),
        inPartiful: new Set<string>(j.inPartiful ?? []),
        partiful: j.partiful ?? NO_PARTIFUL,
      });
    } catch {
      /* social is best-effort; the directory works without it */
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  // Invite links: /?f=<code>
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("f");
    if (!code) return;
    url.searchParams.delete("f");
    window.history.replaceState(null, "", url.toString());
    fetch(`/api/friends?code=${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.inviter && !j.isSelf) setInvite({ code, inviter: j.inviter.name });
      })
      .catch(() => {});
  }, []);

  // "Did you RSVP?" when the visitor comes back from Partiful.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      const p = pendingRsvp.current;
      if (!p) return;
      pendingRsvp.current = null;
      if (Date.now() - p.at < 4000) return; // bounced straight back
      setPrompt(p.event);
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const openAccount = useCallback((then?: () => void) => {
    afterAccount.current = then ?? null;
    setAccountOpen(true);
  }, []);

  const setGoing = useCallback(
    async (event: TechWeekEvent, going: boolean, source: "manual" | "prompt" = "manual") => {
      const run = async () => {
        setState((s) => {
          const mine = new Set(s.mine);
          if (going) mine.add(event.id);
          else mine.delete(event.id);
          return { ...s, mine };
        });
        await fetch("/api/attendance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ eventId: event.id, partifulId: partifulId(event.url), going, source }),
        }).catch(() => {});
      };
      if (!state.me) return openAccount(() => void run());
      await run();
    },
    [state.me, openAccount]
  );

  const api = useMemo<SocialApi>(() => {
    const friendsGoing = (eventId: string) =>
      (state.going[eventId] ?? []).map((id) => state.friendsById.get(id)).filter((f): f is Friend => !!f);
    const hostFriends = (event: TechWeekEvent) => {
      const ids = new Set((event.partiful?.hostProfiles ?? []).map((h) => h.id).filter(Boolean));
      return ids.size ? state.friends.filter((f) => f.pfProfileId && ids.has(f.pfProfileId)) : [];
    };
    return {
      ...state,
      friendsGoing,
      hostFriends,
      setGoing,
      openAccount,
      noteRsvpClick: (event) => {
        pendingRsvp.current = { event, at: Date.now() };
      },
    };
  }, [state, setGoing, openAccount]);

  return (
    <SocialContext.Provider value={api}>
      {children}
      {accountOpen && (
        <AccountModal
          onClose={() => {
            setAccountOpen(false);
            afterAccount.current = null;
          }}
          onSignedIn={async () => {
            await load();
            const then = afterAccount.current;
            afterAccount.current = null;
            then?.();
          }}
        />
      )}
      {invite && (
        <InviteModal
          inviter={invite.inviter}
          signedIn={!!state.me}
          onClose={() => setInvite(null)}
          onAccept={async () => {
            const accept = async () => {
              await fetch("/api/friends", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ code: invite.code }),
              });
              setInvite(null);
              await load();
            };
            if (state.me) await accept();
            else {
              setInvite(null);
              openAccount(() => void accept());
            }
          }}
        />
      )}
      {prompt && (
        <Toast onClose={() => setPrompt(null)}>
          <span className="min-w-0 truncate">
            Did you RSVP to <strong>{prompt.name}</strong>?
          </span>
          <button
            onClick={() => {
              void setGoing(prompt, true, "prompt");
              setPrompt(null);
            }}
            className="shrink-0 rounded-full bg-[#00FF9C] px-3 py-1 text-[12px] font-bold text-[#0C0C0A]"
          >
            I&apos;m going
          </button>
        </Toast>
      )}
    </SocialContext.Provider>
  );
}

// ---------- header chip ----------

export function AccountChip() {
  const { enabled, me, friends, openAccount } = useSocial();
  if (!enabled) return null;
  return (
    <button
      onClick={() => openAccount()}
      className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#0A8F5A] underline-offset-2 hover:underline"
    >
      {me ? (
        <>
          <Avatar name={me.name} xHandle={me.x_handle} size={18} />
          {friends.length > 0 ? `${friends.length} friend${friends.length === 1 ? "" : "s"} · invite more` : "Invite friends to see who's going"}
        </>
      ) : (
        "Connect Partiful →"
      )}
    </button>
  );
}

// ---------- modals ----------

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#1C1A14]/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-[18px] bg-[#F7F2E7] p-5 shadow-2xl sm:max-w-[440px] sm:rounded-[18px]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-[10px] border border-[#DDD3BD] bg-[#E9E2D3]/50 px-3 py-2.5 text-[16px] text-[#1C1A14] outline-none placeholder:text-[#A79E89] focus:border-[#0A8F5A]";
const primaryBtn = "w-full rounded-full bg-[#1C1A14] px-4 py-2.5 text-[14px] font-bold text-[#F7F2E7] disabled:opacity-40";

function AccountModal({ onClose, onSignedIn }: { onClose: () => void; onSignedIn: () => Promise<void> }) {
  const { me, friends } = useSocial();
  const [name, setName] = useState(me?.name ?? "");
  const [x, setX] = useState(me?.x_handle ?? "");
  const [pf, setPf] = useState(me?.pf_profile_id ? `partiful.com/u/${me.pf_profile_id}` : "");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  const link = me ? `${window.location.origin}/?f=${me.invite_code}` : "";

  async function save(extra: Record<string, unknown> = {}) {
    setBusy(true);
    setErr("");
    const r = await fetch("/api/me", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, xHandle: x || null, partifulProfile: pf || null, ...extra }),
    });
    setBusy(false);
    if (!r.ok) return setErr("Something went wrong. Try again.");
    await onSignedIn();
  }

  async function share() {
    const text = "See which SF Tech Week events we're both going to";
    if (navigator.share) {
      try {
        await navigator.share({ title: "SF Tech Week", text, url: link });
        return;
      } catch {
        /* fall through to copy */
      }
    }
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  if (!me) {
    return (
      <Overlay onClose={onClose}>
        <h2 className="text-[20px] font-extrabold tracking-[-0.02em] text-[#1C1A14]">Connect your Partiful</h2>
        <p className="mt-1 text-[13px] leading-[1.45] text-[#766E5C]">
          See your Tech Week events and where people you know are going. Add your name, then paste your Partiful Calendar Sync link on the next step. Only people you connect with see your plans.
        </p>
        <form
          className="mt-4 flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void save();
          }}
        >
          <input autoFocus className={inputCls} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <input className={inputCls} placeholder="X handle for your photo (optional)" value={x} onChange={(e) => setX(e.target.value)} />
          {err && <p className="text-[12px] text-[#D8442B]">{err}</p>}
          <button type="submit" className={primaryBtn} disabled={busy || !name.trim()}>
            {busy ? "…" : "Continue"}
          </button>
        </form>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center gap-2.5">
        <Avatar name={me.name} xHandle={me.x_handle} size={36} />
        <div className="min-w-0">
          <h2 className="truncate text-[18px] font-extrabold tracking-[-0.02em] text-[#1C1A14]">{me.name}</h2>
          <p className="text-[12px] text-[#766E5C]">
            {friends.length} friend{friends.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <PartifulConnection onChanged={onSignedIn} />

      <div className="mt-4 rounded-[12px] border border-[#DDD3BD] bg-[#E9E2D3]/50 p-3">
        <p className="text-[12px] font-semibold text-[#1C1A14]">Your invite link</p>
        <p className="mt-0.5 text-[12px] text-[#766E5C]">Anyone who opens it and accepts becomes your friend here.</p>
        <div className="mt-2 flex gap-2">
          <code className="min-w-0 flex-1 truncate rounded-[8px] bg-[#F7F2E7] px-2 py-2 text-[12px] text-[#1C1A14]">{link}</code>
          <button onClick={() => void share()} className="shrink-0 rounded-full bg-[#00FF9C] px-3.5 text-[13px] font-bold text-[#0C0C0A]">
            {copied ? "Copied" : "Share"}
          </button>
        </div>
      </div>

      {friends.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {friends.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1 rounded-full border border-[#DDD3BD] px-2 py-0.5 text-[12px] text-[#1C1A14]">
              <Avatar name={f.name} xHandle={f.xHandle} size={16} />
              {f.name}
            </span>
          ))}
        </div>
      )}

      <form
        className="mt-4 flex flex-col gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input className={inputCls} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <input className={inputCls} placeholder="X handle (optional)" value={x} onChange={(e) => setX(e.target.value)} />
        <input className={inputCls} placeholder="Your Partiful profile link (optional, for 'Hosted by')" value={pf} onChange={(e) => setPf(e.target.value)} />
        <label className="flex items-center gap-2 text-[13px] text-[#1C1A14]">
          <input
            type="checkbox"
            checked={me.visibility === "friends"}
            onChange={(e) => void save({ visibility: e.target.checked ? "friends" : "nobody" })}
            className="size-4 accent-[#0A8F5A]"
          />
          Show my plans to friends
        </label>
        {err && <p className="text-[12px] text-[#D8442B]">{err}</p>}
        <button type="submit" className={primaryBtn} disabled={busy || !name.trim()}>
          {busy ? "…" : "Save"}
        </button>
      </form>
      <button
        onClick={async () => {
          await fetch("/api/me", { method: "DELETE" });
          window.location.reload();
        }}
        className="mt-3 w-full text-center text-[12px] text-[#766E5C] underline underline-offset-2"
      >
        Sign out
      </button>
    </Overlay>
  );
}

function PartifulConnection({ onChanged }: { onChanged: () => Promise<void> }) {
  const { partiful } = useSocial();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reward, setReward] = useState("");
  async function submit(disconnect = false) {
    setBusy(true); setError(""); setReward("");
    try {
      const response = await fetch("/api/partiful", {
        method: disconnect ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        ...(disconnect ? {} : { body: JSON.stringify({ url }) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Something went wrong. Try again.");
      setUrl("");
      if (!disconnect) setReward(`Found ${data.matched} of your Tech Week events`);
      await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Try again."); }
    finally { setBusy(false); }
  }
  return (
    <section className="mt-4 rounded-[12px] border border-[#DDD3BD] bg-[#E9E2D3]/50 p-3">
      <h3 className="text-[14px] font-bold text-[#0A8F5A]">{partiful.connected ? "Partiful ✓ Connected" : "Connect your Partiful"}</h3>
      {partiful.connected ? <>
        <p className="mt-1 text-[12px] text-[#766E5C]">{partiful.lastSyncedAt ? `Last synced ${new Date(partiful.lastSyncedAt).toLocaleString()}` : "Awaiting a successful sync"}</p>
        <button disabled={busy} onClick={() => void submit(true)} className="mt-2 text-[12px] text-[#766E5C] underline disabled:opacity-40">{busy ? "Disconnecting…" : "Disconnect Partiful"}</button>
      </> : <form className="mt-2 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="text-[13px] text-[#766E5C]">See your events and discover where people you know are going.</p>
        <p className="text-[12px] text-[#766E5C]">In Partiful, open Calendar Sync → Copy Link, then paste it here.</p>
        <input aria-label="Partiful Calendar Sync URL" className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="webcal://calendars.partiful.com/…" autoComplete="off" spellCheck={false} disabled={busy} />
        <button type="button" disabled={busy} className="text-left text-[12px] text-[#0A8F5A] underline" onClick={async () => {
          try {
            if (!navigator.clipboard?.readText) throw new Error("unavailable");
            setUrl(await navigator.clipboard.readText()); setError("");
          } catch { setError("Clipboard access isn't available. Paste the link into the field."); }
        }}>Paste from clipboard</button>
        <button className={primaryBtn} disabled={busy || !url.trim()}>{busy ? "Connecting…" : "Connect Partiful"}</button>
      </form>}
      {reward && <p role="status" className="mt-2 text-[13px] font-semibold text-[#0A8F5A]">{reward}</p>}
      {error && <p role="alert" className="mt-2 text-[12px] text-[#D8442B]">{error}</p>}
    </section>
  );
}

function InviteModal({ inviter, signedIn, onAccept, onClose }: { inviter: string; signedIn: boolean; onAccept: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Overlay onClose={onClose}>
      <h2 className="text-[20px] font-extrabold tracking-[-0.02em] text-[#1C1A14]">{inviter} invited you</h2>
      <p className="mt-1 text-[13px] leading-[1.45] text-[#766E5C]">
        Connect to see which SF Tech Week events you&apos;re both going to. Only people you connect with see your plans.
      </p>
      <button
        className={primaryBtn + " mt-4"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onAccept();
          setBusy(false);
        }}
      >
        {signedIn ? `Connect with ${firstName(inviter)}` : "Continue"}
      </button>
      <button onClick={onClose} className="mt-2 w-full text-center text-[12px] text-[#766E5C]">
        Not now
      </button>
    </Overlay>
  );
}

function Toast({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 12000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className="fixed inset-x-3 bottom-4 z-40 mx-auto flex max-w-[460px] items-center gap-3 rounded-[14px] border border-[#DDD3BD] bg-[#F7F2E7] px-4 py-3 text-[13px] text-[#1C1A14] shadow-[0_12px_40px_-12px_rgba(40,30,10,0.45)]">
      {children}
      <button onClick={onClose} aria-label="Dismiss" className="shrink-0 text-[#A79E89]">
        ✕
      </button>
    </div>
  );
}
