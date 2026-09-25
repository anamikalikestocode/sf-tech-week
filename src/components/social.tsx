"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { TechWeekEvent } from "@/lib/events";

export const SHOW_MY_PARTIFUL = "sftw:show-my-partiful";

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
  /** Other connected people going per event (not the viewer, not their friends) */
  crowd: Record<string, number>;
}

interface SocialApi extends SocialState {
  crowdGoing: (eventId: string) => number;
  friendsGoing: (eventId: string) => Friend[];
  hostFriends: (event: TechWeekEvent) => Friend[];
  setGoing: (event: TechWeekEvent, going: boolean, source?: "manual" | "prompt") => Promise<void>;
  openAccount: (then?: () => void) => void;
  noteRsvpClick: (event: TechWeekEvent) => void;
}

const EMPTY: SocialState = { inPartiful: new Set(), partiful: NO_PARTIFUL, enabled: false, me: null, friends: [], friendsById: new Map(), going: {}, mine: new Set(), crowd: {} };

const SocialContext = createContext<SocialApi>({
  ...EMPTY,
  crowdGoing: () => 0,
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
  const [notice, setNotice] = useState("");
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
        crowd: j.crowd ?? {},
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
      crowdGoing: (eventId: string) => state.crowd[eventId] ?? 0,
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
          onConnected={(message) => {
            setAccountOpen(false);
            setNotice(message);
            // The directory switches on its "My Partiful" filter.
            window.dispatchEvent(new Event(SHOW_MY_PARTIFUL));
          }}
        />
      )}
      {notice && (
        <Toast onClose={() => setNotice("")}>
          <span className="min-w-0 font-semibold text-[#0A8F5A]">{notice}</span>
        </Toast>
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
  const { enabled, me, partiful, openAccount } = useSocial();
  if (!enabled) return null;
  if (me && partiful.connected) return <p className="mt-1.5 text-sm font-semibold text-[#0A8F5A]">Partiful ✓ Connected</p>;
  return (
    <button
      onClick={() => openAccount()}
      className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#0A8F5A] underline-offset-2 hover:underline"
    >
      Connect Partiful →
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

// Only ever the connect box: once connected there is nothing to manage.
function AccountModal({
  onClose,
  onSignedIn,
  onConnected,
}: {
  onClose: () => void;
  onSignedIn: () => Promise<void>;
  onConnected: (message: string) => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <ConnectPartiful
        onDone={async (matched) => {
          await onSignedIn();
          onConnected(`Found ${matched} of your Tech Week events — showing them now`);
        }}
      />
    </Overlay>
  );
}

// Looks like a Partiful Calendar Sync link: connect the moment it's pasted.
const FEED_RE = /calendars\.partiful\.com\/getCalendar\?\S*\bid=/i;

function ConnectPartiful({ onDone }: { onDone: (matched: number) => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function connect(value: string) {
    if (busy || !value.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/partiful", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: value.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Something went wrong. Try again.");
      setUrl("");
      await onDone(data.matched ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }
  function take(value: string) {
    setUrl(value);
    setError("");
    if (FEED_RE.test(value)) void connect(value);
  }
  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void connect(url);
      }}
    >
      <p className="text-[15px] font-semibold leading-[1.4] text-[#1C1A14]">In Partiful, open Calendar Sync → Copy Link, then paste it here.</p>
      <input
        autoFocus
        aria-label="Partiful Calendar Sync link"
        className={inputCls}
        value={url}
        onChange={(e) => take(e.target.value)}
        placeholder="webcal://calendars.partiful.com/…"
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          className="shrink-0 rounded-full border border-[#1C1A14] px-4 py-2.5 text-[14px] font-bold text-[#1C1A14] disabled:opacity-40"
          onClick={async () => {
            try {
              if (!navigator.clipboard?.readText) throw new Error("unavailable");
              take(await navigator.clipboard.readText());
            } catch {
              setError("Clipboard access isn't available. Paste the link into the box.");
            }
          }}
        >
          Paste from clipboard
        </button>
        <button className={primaryBtn} disabled={busy || !url.trim()}>
          {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[12px] text-[#D8442B]">
          {error}
        </p>
      )}
    </form>
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
