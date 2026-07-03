-- POPKØRN — Supabase schema
-- Run this once in the Supabase SQL editor, then set
-- SUPABASE_URL and SUPABASE_SERVICE_KEY on your host.

create table if not exists public.photos (
  id text primary key,
  full_path text not null,
  thumb_path text not null,
  width int not null,
  height int not null,
  caption text not null default '',
  tags text[] not null default '{}',
  album_id text,
  published boolean not null default false,
  color text not null default '#1a1a1a',
  taken_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.albums (
  id text primary key,
  title text not null,
  cover_id text,
  created_at timestamptz not null default now()
);

-- The app talks to the database with the service-role key only;
-- RLS with no policies keeps the anon key locked out.
alter table public.photos enable row level security;
alter table public.albums enable row level security;

-- Public bucket for the (already resized) images.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;
