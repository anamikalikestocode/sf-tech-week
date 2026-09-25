-- Friends-going: our own accounts, friendships and attendance.
-- Everything is server-side only (service-role key); RLS on with no policies
-- means anon/authenticated clients can't read or write these tables directly.

create table if not exists public.sf_users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 60),
  x_handle      text check (x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  pf_profile_id text,                         -- self-claimed partiful.com/u/<id>, for "Hosted by a friend"
  invite_code   text not null unique,
  visibility    text not null default 'friends' check (visibility in ('friends', 'nobody')),
  created_at    timestamptz not null default now()
);

create table if not exists public.sf_sessions (
  token_hash   text primary key,              -- sha256 of the cookie token; the raw token is never stored
  user_id      uuid not null references public.sf_users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.sf_friendships (
  user_a     uuid not null references public.sf_users (id) on delete cascade,
  user_b     uuid not null references public.sf_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)                    -- one row per pair
);
create index if not exists sf_friendships_user_b_idx on public.sf_friendships (user_b);

create table if not exists public.sf_attendance (
  user_id     uuid not null references public.sf_users (id) on delete cascade,
  event_id    text not null,                  -- our event id (tech-week listing id)
  partiful_id text,                           -- canonical Partiful id when known
  status      text not null default 'going' check (status in ('going', 'interested')),
  source      text not null default 'manual' check (source in ('manual', 'prompt', 'link', 'calendar')),
  updated_at  timestamptz not null default now(),
  primary key (user_id, event_id)
);
create index if not exists sf_attendance_event_idx on public.sf_attendance (event_id);

alter table public.sf_users       enable row level security;
alter table public.sf_sessions    enable row level security;
alter table public.sf_friendships enable row level security;
alter table public.sf_attendance  enable row level security;
