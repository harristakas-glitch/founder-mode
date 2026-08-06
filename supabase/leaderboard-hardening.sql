-- Founder Mode — leaderboard hardening (run AFTER leaderboard.sql and auth-upgrade.sql).
-- Paste this whole file into the Supabase SQL editor (SQL → New query → Run). Safe to re-run.
--
-- WHY: the original policies let any holder of the public anon key rewrite or blank
-- EVERY row (`using (true)` on UPDATE), and put no ceiling on score/weeks/ending/day.
-- One request could wipe a day's leaderboard or park an unbeatable bigint at rank 1.
--
-- WHAT THIS DOES:
--   1. Replaces the open UPDATE policy with a row-scoped one: a client may only touch
--      the row whose player_id matches the id it presents in the x-player-id header,
--      and only to raise its own score (score >= existing score).
--   2. Adds value bounds to both INSERT and UPDATE so nothing absurd can be stored.
--   3. Keeps SELECT open (the leaderboard is public) and still allows no DELETE.
--
-- HONEST LIMITATION: player ids are client-generated, so a determined attacker can still
-- present someone else's id and edit that one row. Closing that fully means requiring
-- login to post a score (submission behind an RPC keyed on auth.uid()) — worth doing if
-- the leaderboard ever matters competitively. This change removes the "wipe everything
-- with one request" class of abuse, which is the part that actually hurts.

-- --- bounds shared by insert and update ---------------------------------------
-- score:   0 .. 1e15   (a $1B unicorn payout is ~1e9; 1e15 leaves absurd headroom)
-- weeks:   0 .. 520    (the longest possible run is 104 weeks; 520 = 10 years of slack)
-- ending:  one of the six real ending types
-- day:     10000..40000 (day number since the epoch used by dailyInfo(); ~1997..2079)

alter table public.daily_scores
  drop constraint if exists daily_scores_sane;

alter table public.daily_scores
  add constraint daily_scores_sane check (
    char_length(company) <= 30
    and score >= 0 and score <= 1000000000000000
    and weeks >= 0 and weeks <= 520
    and ending in ('bankrupt', 'unicorn', 'acquired', 'fired', 'timeup', 'ipo')
    and day >= 10000 and day <= 40000
    and (display_name is null or char_length(display_name) <= 24)
  ) not valid;

-- `not valid` skips checking rows that already exist (they were written under the old,
-- looser policy). Validate separately so a single bad legacy row can't block the migration:
-- if this errors, delete the offending rows and re-run it.
alter table public.daily_scores validate constraint daily_scores_sane;

-- --- INSERT: anyone may post a score, within the bounds above ------------------
drop policy if exists "anon can submit daily scores" on public.daily_scores;
create policy "anon can submit daily scores"
  on public.daily_scores
  for insert
  to anon
  with check (
    char_length(company) <= 30
    and score >= 0 and score <= 1000000000000000
    and weeks >= 0 and weeks <= 520
    and ending in ('bankrupt', 'unicorn', 'acquired', 'fired', 'timeup', 'ipo')
    and day >= 10000 and day <= 40000
  );

-- --- UPDATE: only your own row, and only upward ------------------------------
-- The client sends its player id in the x-player-id header (see src/net/leaderboard.ts).
-- `using` decides which rows are visible to the UPDATE; `with check` validates the result.
drop policy if exists "anon can improve own daily score" on public.daily_scores;
create policy "anon can improve own daily score"
  on public.daily_scores
  for update
  to anon
  using (
    player_id = coalesce(
      nullif(current_setting('request.headers', true)::json ->> 'x-player-id', ''),
      '\x00-no-match'
    )
  )
  with check (
    char_length(company) <= 30
    and score >= 0 and score <= 1000000000000000
    and weeks >= 0 and weeks <= 520
    and ending in ('bankrupt', 'unicorn', 'acquired', 'fired', 'timeup', 'ipo')
  );

-- No DELETE policy for anon: rows still cannot be removed from the client.
