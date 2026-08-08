-- Founder Mode — leaderboard security, v5. RUN THIS. It supersedes leaderboard.sql,
-- leaderboard-hardening.sql and leaderboard-secure.sql. Paste into the Supabase SQL editor.
-- Idempotent, and it VERIFIES ITSELF at the bottom: section 8 runs the whole attack matrix
-- against the policies it just created and raises if any case comes out wrong.
--
-- THE STORY SO FAR:
--   v2 authenticated with an "x-player-id" header — but player_id is returned by the public
--      SELECT, so an attacker read a victim's id and echoed it back. Verified broken.
--   v3 hid the secret with a column-level REVOKE, which also removed the table-level SELECT that
--      `INSERT ... ON CONFLICT DO UPDATE` requires. Blocked attackers AND every real submission.
--   v4 stored a bcrypt hash instead of hiding anything. The ownership check is sound and still
--      stands in v5 — but v4 shipped with a `day` bound that does not match the value the game
--      actually sends, so it repeated v3's mistake in a quieter way. See section 1.
--
-- WHAT v5 CHANGES
--   1. CRITICAL — fixes the `day` domain. v4 required `day between 10000 and 40000`; the client
--      sends the DAILY CHALLENGE NUMBER (7, 8, 9, ...). Every real submission has been rejected.
--   2. Binds each player_id to the first device that used it, so a stranger can no longer squat
--      a victim's id and lock them out of a day's leaderboard.
--   3. Moves the ownership function out of the PostgREST-exposed schema, so it stops being a
--      free bcrypt-burning RPC that anyone with the public key can call in a loop.
--
-- Defence in depth, in order:
--   1. player_id is claimed once and bound to a bcrypt hash of that device's secret.
--   2. Ownership of a row is proved by that same secret; the DB only ever stores hashes.
--   3. A trigger makes player_id / day / secret immutable and scores monotonic — so even a
--      leaked secret can only ever RAISE that one row's score.
--   4. Value bounds on every column, plus a moving window on `day`.

create extension if not exists pgcrypto;

-- --- 0. clear out test/junk rows so the stricter checks below can validate ------------------
delete from public.daily_scores
 where day > 100000
    or day <= 0
    or player_id like 'SECTEST-%'
    or player_id like 'victim-%'
    or player_id like 'v3-%'
    or player_id like 'verify-bot-%'
    or player_id = 'claude-test'
    -- rows written by the 2026-08-07 security review while proving the squat lockout and the
    -- client's recovery against the live project (see docs/security-review.md)
    or (day = 10001 and company in ('Honest Inc', 'Victim Inc', 'Squatter'));

-- --- 1. THE OUTAGE: the `day` column holds a CHALLENGE NUMBER, not a day-since-epoch ---------
--
-- src/store.ts:
--     const DAILY_EPOCH = 20666            -- days-since-1970 of challenge #1
--     id: Math.floor(Date.now() / 86_400_000) - DAILY_EPOCH + 1
-- and src/store.ts parses that `id` back out of the run label and passes it to
-- submitDailyScore(day, ...). So `day` is 7 today, 8 tomorrow — a small counter starting at 1.
--
-- v4's `day >= 10000 and day <= 40000` therefore rejected 100% of genuine submissions with
-- "new row violates row-level security policy". Verified against production on 2026-08-07:
-- identical payloads, day=9999 -> HTTP 401, day=10000 -> HTTP 201, real value = 7.
--
-- Two separate controls, deliberately:
--   * a static CHECK constraint with a wide sanity range (constraints must be immutable, and
--     this one also has to hold for old rows on UPDATE), and
--   * a MOVING WINDOW in the INSERT policy, which is where the real anti-junk value is: it
--     stops anyone parking rows on tens of thousands of unused day slots.
--
-- KEEP IN SYNC: if DAILY_EPOCH in src/store.ts ever changes, change 20665 in section 6 too,
-- or submissions start failing again exactly the way they did under v4.

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
    and day >= 1 and day <= 100000            -- challenge number, ~270 years of headroom
  ) not valid;

do $$
begin
  alter table public.daily_scores validate constraint daily_scores_sane;
  raise notice 'existing rows validated';
exception when others then
  raise notice 'existing rows left unvalidated (%); new and updated rows are still checked', sqlerrm;
end $$;

alter table public.daily_scores add column if not exists display_name text;
alter table public.daily_scores add column if not exists secret text;

-- Table-level grants, deliberately. See the v3 note above: PostgreSQL requires table-level
-- SELECT for `INSERT ... ON CONFLICT DO UPDATE`, which is what the client's upsert compiles to.
-- Hiding the secret column was never what made this safe — it holds a bcrypt hash.
grant select, insert, update on public.daily_scores to anon, authenticated;

-- --- 2. a schema PostgREST does not expose ----------------------------------------------------
-- Supabase exposes `public` (and graphql_public) over REST. Anything in `public` that anon may
-- execute is a callable endpoint. v4's public.owns_score_row(text) was therefore a free
-- bcrypt-on-demand service: POST /rest/v1/rpc/owns_score_row, ~25ms of server CPU per call,
-- no rate limit, on a project with no spend cap. Confirmed callable in production.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

-- --- 3. player_id is claimed once, by one device ----------------------------------------------
-- v4 let anyone INSERT a row under any player_id. Since (day, player_id) is unique, a stranger
-- could pre-insert a row carrying a victim's player_id — ids are public, they are in the
-- leaderboard everyone reads — and the victim's own upsert would then fail the ownership USING
-- check forever. Verified against production: the squatter's insert returned 201 and the real
-- owner's submission for that day returned 401. That is a permanent lockout plus a row of
-- attacker-chosen text attributed to the victim's id.
--
-- Binding player_id to the first secret that used it closes it. A squatter cannot register an id
-- that is already bound, and any id visible on the leaderboard is bound by definition — its
-- owner had to submit a score to get it there.
create table if not exists private.player_identity (
  player_id text primary key,
  secret_hash text not null,
  created_at timestamptz not null default now()
);

-- Not exposed, not readable, not writable by any client role. Only the SECURITY DEFINER trigger
-- below touches it, and that runs as the owner.
alter table private.player_identity enable row level security;
revoke all on private.player_identity from public, anon, authenticated;

-- Backfill so nobody who already has a row loses the ability to improve it. daily_scores.secret
-- is a bcrypt hash of the same per-device secret, so it transfers as-is.
insert into private.player_identity (player_id, secret_hash)
select distinct on (player_id) player_id, secret
  from public.daily_scores
 where secret is not null and char_length(secret) > 0
 order by player_id, created_at desc nulls last
on conflict (player_id) do nothing;

-- --- 4. hash the secret on the way in, and enforce the identity binding -----------------------
create or replace function public.daily_scores_hash_secret()
returns trigger language plpgsql security definer set search_path = public, private, extensions as $$
declare
  known text;
begin
  if new.secret is null or char_length(new.secret) < 16 then
    raise exception 'daily_scores: a secret of at least 16 characters is required';
  end if;

  select secret_hash into known from private.player_identity where player_id = new.player_id;

  if known is null then
    -- first sighting of this id: it belongs to whoever is holding this secret
    insert into private.player_identity (player_id, secret_hash)
      values (new.player_id, crypt(new.secret, gen_salt('bf', 8)))
      on conflict (player_id) do nothing;
  elsif known <> crypt(new.secret, known) then
    raise exception 'daily_scores: player_id is registered to another device'
      using errcode = '42501';
  end if;

  new.secret := crypt(new.secret, gen_salt('bf', 8));
  return new;
end $$;

drop trigger if exists daily_scores_hash_trg on public.daily_scores;
create trigger daily_scores_hash_trg
  before insert on public.daily_scores
  for each row execute function public.daily_scores_hash_secret();

-- --- 5. identity immutable, scores monotonic ---------------------------------------------------
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

-- --- 6. ownership check + the current-challenge window -----------------------------------------
create or replace function private.owns_score_row(stored text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select stored is not null
     and stored = crypt(
           coalesce(nullif(current_setting('request.headers', true)::json ->> 'x-player-secret', ''), '~no~'),
           stored)
$$;
grant execute on function private.owns_score_row(text) to anon, authenticated;

-- Today's challenge number, mirroring dailyInfo() in src/store.ts (DAILY_EPOCH = 20666).
create or replace function private.current_challenge()
returns int language sql stable as $$
  select (floor(extract(epoch from now()) / 86400)::int - 20665)
$$;
grant execute on function private.current_challenge() to anon, authenticated;

-- --- 7. policies -------------------------------------------------------------------------------
alter table public.daily_scores enable row level security;

-- READ: open. The leaderboard is public, and the only sensitive column is a bcrypt hash.
drop policy if exists "anon can read daily scores" on public.daily_scores;
create policy "anon can read daily scores"
  on public.daily_scores for select to anon using (true);

-- INSERT: anyone may post a score for a recent challenge, within bounds, with a secret.
-- The window is generous backwards (a daily run started days ago and finished today is still
-- legitimate) and almost closed forwards — a future challenge number is never honest.
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
    and day >= 1 and day <= 100000
    and day between private.current_challenge() - 14 and private.current_challenge() + 1
  );

-- UPDATE: only the device holding the secret behind the stored hash. The guard trigger still
-- forbids lowering a score or changing identity, so `day` is not re-checked here on purpose —
-- it cannot change, and re-checking it would lock players out of improving an older row.
drop policy if exists "anon can improve own daily score" on public.daily_scores;
create policy "anon can improve own daily score"
  on public.daily_scores for update to anon
  using (private.owns_score_row(secret))
  with check (
    char_length(company) <= 30
    and score >= 0 and score <= 1000000000000
    and weeks >= 0 and weeks <= 520
    and ending in ('bankrupt', 'unicorn', 'acquired', 'fired', 'timeup', 'ipo')
  );

-- No DELETE policy for anon: rows cannot be removed from the client.

-- The v4 function was an unauthenticated bcrypt endpoint; drop it now that the policies above
-- reference the private copy instead.
drop function if exists public.owns_score_row(text);

-- --- 8. SELF-TEST: prove both directions, then roll it all back --------------------------------
-- Blocking an attacker is only half of it. v3 and v4 both blocked attackers AND legitimate
-- players, and both shipped. This block asserts the honest path works as loudly as it asserts
-- the attacks fail. If anything is wrong it raises and you will see it immediately.
do $$
declare
  vsecret  text := 'selftest-victim-secret-0123456789abcdef';
  asecret  text := 'selftest-attacker-secret-0123456789abcd';
  vid      text := 'SELFTEST-victim';
  sid      text := 'SELFTEST-squatted';
  today    int  := private.current_challenge();
  n        int;
  failures text[] := '{}';
begin
  -- act as an anonymous player holding the victim's secret
  execute 'set local role anon';
  perform set_config('request.headers', json_build_object('x-player-secret', vsecret)::text, true);

  -- (1) honest insert must succeed
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (today, vid, 'Victim Inc', 100, 10, 'unicorn', null, vsecret);
  exception when others then
    failures := failures || format('HONEST INSERT FAILED: %s', sqlerrm);
  end;

  -- (2) honest improvement must succeed (this is the exact upsert the client performs)
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (today, vid, 'Victim Inc', 500, 11, 'unicorn', null, vsecret)
    on conflict (day, player_id) do update
      set score = excluded.score, weeks = excluded.weeks, company = excluded.company;
    select score into n from public.daily_scores where day = today and player_id = vid;
    if n <> 500 then failures := failures || format('HONEST IMPROVE DID NOT APPLY (score=%s)', n); end if;
  exception when others then
    failures := failures || format('HONEST IMPROVE FAILED: %s', sqlerrm);
  end;

  -- (3) a score may not be lowered, even by the owner
  begin
    update public.daily_scores set score = 1 where day = today and player_id = vid;
    failures := failures || 'SCORE WAS LOWERED';
  exception when others then null;
  end;

  -- now act as the attacker: same public anon key, a different secret
  perform set_config('request.headers', json_build_object('x-player-secret', asecret)::text, true);

  -- (4) a stranger must not be able to overwrite the victim's row
  update public.daily_scores set company = 'PWNED', score = 999999999 where day = today and player_id = vid;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'STRANGER OVERWROTE A ROW'; end if;

  -- (5) a stranger must not be able to delete it
  begin
    delete from public.daily_scores where day = today and player_id = vid;
    get diagnostics n = row_count;
    if n <> 0 then failures := failures || 'STRANGER DELETED A ROW'; end if;
  exception when others then null;
  end;

  -- (6) THE v5 FIX: a stranger must not be able to squat an id that is already bound
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (today - 1, vid, 'Squatter', 1, 1, 'bankrupt', null, asecret);
    failures := failures || 'SQUATTER CLAIMED A BOUND player_id';
  exception when others then null;
  end;

  -- (7) ...but an id nobody has claimed is still free to register (new players must work)
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (today, sid, 'Newcomer', 42, 3, 'ipo', null, asecret);
  exception when others then
    failures := failures || format('NEW PLAYER COULD NOT REGISTER: %s', sqlerrm);
  end;

  -- (8) the day window: a far-future challenge number must be refused
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (39000, 'SELFTEST-future', 'Future', 1, 1, 'ipo', null, asecret);
    failures := failures || 'A FAR-FUTURE day WAS ACCEPTED';
  exception when others then null;
  end;

  -- (9) value bounds still bite
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (today, 'SELFTEST-huge', 'Huge', 99999999999999, 1, 'ipo', null, asecret);
    failures := failures || 'AN ABSURD SCORE WAS ACCEPTED';
  exception when others then null;
  end;

  reset role;
  delete from public.daily_scores where player_id like 'SELFTEST-%';
  delete from private.player_identity where player_id like 'SELFTEST-%';

  if array_length(failures, 1) is not null then
    raise exception E'leaderboard v5 self-test FAILED:\n  - %', array_to_string(failures, E'\n  - ');
  end if;
  raise notice 'leaderboard v5 self-test passed: honest submit + improve work, squat/overwrite/delete/lower/inflate all refused';
end $$;

-- --- 9. what this does NOT fix (accepted, or needs an owner decision) ---------------------------
-- * Nothing simulates the game server-side, so a player can still submit a plausible but
--   cheated score for THEMSELVES. Closing that needs an authoritative server, not RLS.
-- * display_name is self-asserted for anonymous players, so a signed-out player can put
--   someone else's handle on their OWN row. Requiring login to post would close it.
-- * Insert flooding: the identity binding means a flooder must mint a fresh player_id per row,
--   which it can do for free. There is no rate limiting anywhere and the anon key is public.
--   This needs an edge rate limit (Supabase/Cloudflare) plus a spending cap and usage alerts.
--   Nothing in this file, or in any client, can fix it.
