-- Connect Partiful via the user's personal calendar-sync feed.
-- The feed URL is a secret bearer link, so it's stored encrypted (AES-256-GCM,
-- key derived from the service-role key) and never returned to the client.
-- Imported events land in sf_attendance with source='calendar'.

create table if not exists public.sf_partiful_connections (
  user_id       uuid primary key references public.sf_users (id) on delete cascade,
  feed_enc      text not null,               -- encrypted feed URL (iv:tag:ciphertext, base64)
  feed_fp       text not null,               -- sha256 fingerprint, to dedupe/detect changes without decrypting
  event_count   int not null default 0,      -- matched Tech Week events at last sync
  total_count   int not null default 0,      -- total events seen in the feed
  last_synced_at timestamptz,
  last_error    text,
  created_at    timestamptz not null default now()
);

alter table public.sf_partiful_connections enable row level security;
