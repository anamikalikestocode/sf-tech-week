-- SF Tech Week — anonymous product analytics. Run once in the Supabase SQL
-- editor. Mirrors the NYC site's nyc_chat_queries / nyc_rsvp_clicks tables.
-- Everything is anonymous: a random first-party session id from the visitor's
-- localStorage, the query text, the clicked event URL. No IP, no identity.

create table if not exists public.sf_chat_queries (
  id          bigint generated always as identity primary key,
  query       text not null,
  turn_index  int,
  session_id  text,
  created_at  timestamptz not null default now()
);
create index if not exists sf_chat_queries_created_at_idx on public.sf_chat_queries (created_at desc);
alter table public.sf_chat_queries enable row level security;
-- No policies = service-role only.

create table if not exists public.sf_rsvp_clicks (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  session_id  text,
  event_url   text not null,
  event_name  text,
  source      text
);
create index if not exists sf_rsvp_clicks_created_at_idx on public.sf_rsvp_clicks (created_at desc);
create index if not exists sf_rsvp_clicks_event_url_idx on public.sf_rsvp_clicks (event_url);
alter table public.sf_rsvp_clicks enable row level security;
