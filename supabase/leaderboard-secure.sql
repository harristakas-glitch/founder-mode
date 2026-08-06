-- Founder Mode — leaderboard security, v3. RUN THIS; it supersedes leaderboard-hardening.sql.
-- Paste into the Supabase SQL editor (SQL → New query → Run). Safe to re-run.
--
-- WHY v2 FAILED: it authenticated updates with an "x-player-id" header, but player_id is
-- returned by the public SELECT policy. An attacker just reads a victim's id off the
-- leaderboard and echoes it back — verified live: a row was blanked and then moved to a
-- different day (an effective delete). Naming yourself is not proof of identity.
--
-- HOW v3 WORKS: each device generates a random secret, keeps it in localStorage, and sends
-- it in a header. The secret lives in a column that anon is NOT allowed to read, so it can
-- be checked but never harvested. A trigger additionally makes identity immutable and scores
-- monotonic, so even a leaked secret can only ever raise that one row's score — it can never
-- blank a row, steal it, or move it off the board.

-- --- 0. clear out test/junk rows so the stricter checks below can be validated -----------
delete from public.daily_scores
 where day >= 30000
    or day <= 0
    or player_id like 'SECTEST-%'
    or player_id like 'victim-%'
    or player_id like 'verify-bot-%'
    or player_id = 'claude-test';

-- --- 1. columns ---------------------------------------------------------------------------
alter table public.daily_scores add column if not exists display_name text;
alter table public.daily_scores add column if not exists secret text;

-- The secret must be writable by the client but never readable by anyone using the anon key.
-- Column-level privileges are what make the check unforgeable.
revoke select (secret) on public.daily_scores from anon;
revoke select (secret) on public.daily_scores from authenticated;
grant insert (secret), update (secret) on public.daily_scores to anon;
-- NOTE: because anon cannot read this column, `select *` will fail for anon by design.
-- The game always selects explicit columns, so this is fine — keep it that way.

-- --- 2. value bounds -----------------------------------------------------------------------
-- score:  0 .. 1e12   (a real unicorn payout is ~1e9; 1e12 is generous and blocks "unbeatable" rows)
-- weeks:  0 .. 520
-- ending: one of the six real endings
-- day:    10000..40000 (day-number epoch used by dailyInfo(); ~1997..2079)
-- player_id / secret / company / display_name: length-capped so rows cannot be inflated
alter table public.daily_scores drop constraint if exists daily_scores_sane;
alter table public.daily_scores
  add constraint daily_scores_sane check (
    char_length(company) <= 30
    and char_length(player_id) <= 64
    and (display_name is null or char_length(display_name) <= 24)
    and (secret is null or char_length(secret) <= 128)
    and score >= 0 and score <= 1000000000000
    and weeks >= 0 and weeks <= 520
    and ending in ('bankrupt', 'unicorn', 'acquired', 'fired', 'timeup', 'ipo')
    and day >= 10000 and day <= 40000
  ) not valid;

do $$
begin
  alter table public.daily_scores validate constraint daily_scores_sane;
  raise notice 'existing rows validated';
exception when others then
  raise notice 'existing rows left unvalidated (%); new and updated rows are still checked', sqlerrm;
end $$;

-- --- 3. identity is immutable, scores only go up -------------------------------------------
-- RLS `with check` cannot see the OLD row, so this invariant needs a trigger. This is the
-- backstop that keeps a stolen/leaked secret from being useful for anything destructive.
create or replace function public.daily_scores_guard()
returns trigger language plpgsql as $$
begin
  if new.player_id is distinct from old.player_id
     or new.day is distinct from old.day
     or new.secret is distinct from old.secret then
    raise exception 'daily_scores: player_id, day and secret are immutable';
  end if;
  if new.score < old.score then
    raise exception 'daily_scores: score may only increase';
  end if;
  return new;
end $$;

drop trigger if exists daily_scores_guard_trg on public.daily_scores;
create trigger daily_scores_guard_trg
  before update on public.daily_scores
  for each row execute function public.daily_scores_guard();

-- --- 4. policies ---------------------------------------------------------------------------
-- READ: open. The leaderboard is public; the secret column is unreadable via the grant above.
drop policy if exists "anon can read daily scores" on public.daily_scores;
create policy "anon can read daily scores"
  on public.daily_scores for select to anon using (true);

-- INSERT: anyone may post a score, within bounds, and must set a secret of real length.
drop policy if exists "anon can submit daily scores" on public.daily_scores;
create policy "anon can submit daily scores"
  on public.daily_scores for insert to anon
  with check (
    char_length(company) <= 30
    and char_length(player_id) <= 64
    and secret is not null and char_length(secret) between 16 and 128
    and score >= 0 and score <= 1000000000000
    and weeks >= 0 and weeks <= 520
    and ending in ('bankrupt', 'unicorn', 'acquired', 'fired', 'timeup', 'ipo')
    and day >= 10000 and day <= 40000
  );

-- UPDATE: only the device that created the row (proved by the unreadable secret), and the
-- trigger above still forbids lowering the score or changing identity.
drop policy if exists "anon can improve own daily score" on public.daily_scores;
create policy "anon can improve own daily score"
  on public.daily_scores for update to anon
  using (
    secret is not null
    and secret = nullif(current_setting('request.headers', true)::json ->> 'x-player-secret', '')
  )
  with check (
    char_length(company) <= 30
    and score >= 0 and score <= 1000000000000
    and weeks >= 0 and weeks <= 520
    and ending in ('bankrupt', 'unicorn', 'acquired', 'fired', 'timeup', 'ipo')
  );

-- No DELETE policy for anon: rows cannot be removed from the client.

-- --- 5. what this does NOT fix (accepted, or needs mandatory login) -------------------------
-- * A player can still submit an honest-looking but cheated score for THEMSELVES (no server
--   simulates the game). Closing that needs an authoritative server, not RLS.
-- * display_name is still self-asserted for anonymous players, so a signed-out player can
--   type someone else's handle on their OWN row. Requiring login to post would close it.
-- * Insert flooding is still possible with the anon key (no rate limiting exists). Set a
--   spending cap and usage alerts in the Supabase dashboard; consider Realtime rate limits.
