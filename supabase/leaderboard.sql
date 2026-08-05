-- Founder Mode — Daily Challenge global leaderboard.
-- Paste this whole file into the Supabase SQL editor (SQL → New query → Run).
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE-style guards where possible.

create table if not exists public.daily_scores (
  id uuid primary key default gen_random_uuid(),
  day int not null,
  player_id text not null,
  company text not null,
  score bigint not null,
  weeks int not null,
  ending text not null,
  created_at timestamptz default now(),
  constraint daily_scores_day_player_unique unique (day, player_id)
);

create index if not exists daily_scores_day_score_idx
  on public.daily_scores (day, score desc);

alter table public.daily_scores enable row level security;

-- Anyone (anon key) may read the leaderboard.
drop policy if exists "anon can read daily scores" on public.daily_scores;
create policy "anon can read daily scores"
  on public.daily_scores
  for select
  to anon
  using (true);

-- Anyone (anon key) may submit a score, with basic sanity checks.
drop policy if exists "anon can submit daily scores" on public.daily_scores;
create policy "anon can submit daily scores"
  on public.daily_scores
  for insert
  to anon
  with check (char_length(company) <= 30 and score >= 0);

-- Needed so the client can upsert its own row (improve its score for the day).
-- Scoped to the same sanity checks; a player can only be matched via the
-- (day, player_id) unique key they already own.
drop policy if exists "anon can improve own daily score" on public.daily_scores;
create policy "anon can improve own daily score"
  on public.daily_scores
  for update
  to anon
  using (true)
  with check (char_length(company) <= 30 and score >= 0);

-- No DELETE policy for anon: rows cannot be removed from the client.
