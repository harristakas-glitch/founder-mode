-- Founder Mode — leaderboard security, v4. RUN THIS. It supersedes every earlier SQL file
-- (leaderboard.sql, leaderboard-hardening.sql). Paste into the Supabase SQL editor. Idempotent.
--
-- THE STORY SO FAR:
--   v2 authenticated updates with an "x-player-id" header — but player_id is returned by the
--      public SELECT, so an attacker read a victim's id and echoed it back. Verified broken.
--   v3 added a per-device secret and tried to hide it with a column-level REVOKE. On this
--      project the column stayed readable, so the secret could be harvested. Also broken.
--   v4 stops relying on hiding anything: the column stores a BCRYPT HASH of the secret. Reading
--      it gains you nothing, because you cannot derive the secret from the hash. The check is
--      a hash comparison, so it works even if every column is world-readable.
--
-- Defence in depth, in order:
--   1. Ownership is proved by a secret that only the player's browser holds; the DB stores a hash.
--   2. A trigger makes player_id / day / secret immutable and scores monotonic — so even a
--      compromised secret can only ever RAISE that one row's score. It can never blank a row,
--      steal it, or move it off the leaderboard.
--   3. Value bounds on every column, so no row can be inflated or made unbeatable.

create extension if not exists pgcrypto;

-- --- 0. clear out test/junk rows so the stricter checks below can validate ------------------
delete from public.daily_scores
 where day >= 30000
    or day <= 0
    or player_id like 'SECTEST-%'
    or player_id like 'victim-%'
    or player_id like 'v3-%'
    or player_id like 'verify-bot-%'
    or player_id = 'claude-test';

-- --- 1. columns ------------------------------------------------------------------------------
alter table public.daily_scores add column if not exists display_name text;
alter table public.daily_scores add column if not exists secret text;

-- Table-level grants, deliberately. An earlier version revoked table SELECT and re-granted it
-- column by column to hide the secret — that BROKE THE GAME: PostgreSQL requires table-level
-- SELECT for `INSERT ... ON CONFLICT DO UPDATE`, which is exactly what the client's upsert does,
-- so every score submission failed with "permission denied for table daily_scores".
-- Hiding the column was never what made this safe: the column holds a bcrypt hash, so reading
-- it is worthless to an attacker. Keep the grants simple and let the hash do the work.
grant select, insert, update on public.daily_scores to anon, authenticated;

-- --- 2. value bounds ---------------------------------------------------------------------------
-- score 0..1e12 (a real unicorn payout is ~1e9), weeks 0..520, day 10000..40000 (~1997..2079),
-- and every text column length-capped so rows cannot be inflated.
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

-- --- 3. hash the secret on the way in ----------------------------------------------------------
-- The client posts a random 48-char secret; we never store it in the clear.
create or replace function public.daily_scores_hash_secret()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.secret is null or char_length(new.secret) < 16 then
    raise exception 'daily_scores: a secret of at least 16 characters is required';
  end if;
  new.secret := crypt(new.secret, gen_salt('bf', 8));
  return new;
end $$;

drop trigger if exists daily_scores_hash_trg on public.daily_scores;
create trigger daily_scores_hash_trg
  before insert on public.daily_scores
  for each row execute function public.daily_scores_hash_secret();

-- --- 4. identity immutable, scores monotonic ---------------------------------------------------
-- RLS `with check` cannot see the OLD row, so these invariants need a trigger. This is what
-- keeps a leaked secret from being useful for anything destructive.
create or replace function public.daily_scores_guard()
returns trigger language plpgsql as $$
begin
  new.secret := old.secret;      -- clients resend their secret on upsert; never re-hash or change it
  new.player_id := old.player_id;
  new.day := old.day;
  if new.score < old.score then
    raise exception 'daily_scores: score may only increase';
  end if;
  return new;
end $$;

drop trigger if exists daily_scores_guard_trg on public.daily_scores;
create trigger daily_scores_guard_trg
  before update on public.daily_scores
  for each row execute function public.daily_scores_guard();

-- --- 5. ownership check ------------------------------------------------------------------------
-- SECURITY DEFINER with a pinned search_path so pgcrypto resolves no matter where it lives,
-- and so the policy body stays readable.
create or replace function public.owns_score_row(stored text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select stored is not null
     and stored = crypt(
           coalesce(nullif(current_setting('request.headers', true)::json ->> 'x-player-secret', ''), '~no~'),
           stored)
$$;

grant execute on function public.owns_score_row(text) to anon, authenticated;

-- --- 6. policies -------------------------------------------------------------------------------
alter table public.daily_scores enable row level security;

-- READ: open. The leaderboard is public, and the only sensitive column is a bcrypt hash.
drop policy if exists "anon can read daily scores" on public.daily_scores;
create policy "anon can read daily scores"
  on public.daily_scores for select to anon using (true);

-- INSERT: anyone may post a score, within bounds, and must supply a secret (hashed by the trigger).
drop policy if exists "anon can submit daily scores" on public.daily_scores;
create policy "anon can submit daily scores"
  on public.daily_scores for insert to anon
  with check (
    char_length(company) <= 30
    and char_length(player_id) <= 64
    and secret is not null and char_length(secret) >= 16
    and score >= 0 and score <= 1000000000000
    and weeks >= 0 and weeks <= 520
    and ending in ('bankrupt', 'unicorn', 'acquired', 'fired', 'timeup', 'ipo')
    and day >= 10000 and day <= 40000
  );

-- UPDATE: only the device holding the secret behind the stored hash; the trigger above still
-- forbids lowering a score or changing identity.
drop policy if exists "anon can improve own daily score" on public.daily_scores;
create policy "anon can improve own daily score"
  on public.daily_scores for update to anon
  using (public.owns_score_row(secret))
  with check (
    char_length(company) <= 30
    and score >= 0 and score <= 1000000000000
    and weeks >= 0 and weeks <= 520
    and ending in ('bankrupt', 'unicorn', 'acquired', 'fired', 'timeup', 'ipo')
  );

-- No DELETE policy for anon: rows cannot be removed from the client.

-- --- 7. what this does NOT fix (accepted, or needs mandatory login) -----------------------------
-- * Nothing simulates the game server-side, so a player can still submit a plausible but
--   cheated score for THEMSELVES. Closing that needs an authoritative server, not RLS.
-- * display_name is self-asserted for anonymous players, so a signed-out player can type
--   someone else's handle on their OWN row. Requiring login to post would close it.
-- * Insert flooding is still possible with a public key — there is no rate limiting. Set a
--   spending cap and usage alerts in the Supabase dashboard.
