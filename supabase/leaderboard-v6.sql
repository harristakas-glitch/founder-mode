-- Founder Mode — leaderboard security, v6.
--
-- ============================================================================================
-- THIS IS THE ONLY SQL FILE IN THIS DIRECTORY. RUN IT. THERE IS NOTHING TO RUN BEFORE IT AND
-- NOTHING TO RUN AFTER IT.
--
-- Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
--
-- It creates the table if it does not exist, so it works on a brand-new project AND on the
-- existing one. It is idempotent: running it twice is harmless. It VERIFIES ITSELF at the
-- bottom — section 9 runs the whole attack matrix against the policies it just created, as
-- BOTH database roles, and raises with a list of failures if any case comes out wrong.
--
-- SUCCESS LOOKS LIKE: "leaderboard v6 self-test passed: ..." in the notices, and no error.
-- FAILURE LOOKS LIKE: an exception whose message lists every case that came out wrong. The
-- self-test's fixture rows are never left behind either way: an exception out of a DO block
-- rolls the whole block back, and the passing path deletes them explicitly. Send the message
-- to whoever asked you to run this rather than trying to patch around it.
--
-- The 2026-08-19 review deleted leaderboard.sql, leaderboard-hardening.sql,
-- leaderboard-secure.sql, leaderboard-v5.sql and auth-upgrade.sql. Every one of them was
-- either superseded by this file or actively harmful to run, and having six scripts in one
-- directory with no marking of which to run is how the outage below survived for two weeks.
-- They remain in git history (`git log -- supabase/`) if the story is ever needed.
-- ============================================================================================
--
-- THE STORY SO FAR — this file has a bad habit and it is worth naming:
--   v2 authenticated with an "x-player-id" header, and player_id is returned by the public
--      SELECT, so an attacker read a victim's id and echoed it back. Verified broken.
--   v3 hid the secret with a column-level REVOKE, which also removed the table-level SELECT that
--      `INSERT ... ON CONFLICT DO UPDATE` requires. Blocked attackers AND every real submission.
--   v4 stored a bcrypt hash instead of hiding anything — sound, and still standing — but shipped
--      a `day` bound of 10000..40000 when the client sends a challenge COUNTER (7, 8, 9...).
--      Blocked attackers AND every real submission, for the second time.
--   v5 fixed the day domain and the id-squatting hole, and wrote every policy `to anon` only.
--      That is the SAME MISTAKE, armed and waiting: see section 8.
--
-- THREE OF FIVE VERSIONS OF THIS FILE HAVE LOCKED OUT EVERY LEGITIMATE PLAYER. The rule that
-- would have caught all three is the one section 9 now enforces: assert the attack is blocked
-- AND the honest path still works, in the same run, for every role that can reach the table.
--
-- WHAT v6 CHANGES ON TOP OF v5
--   A. CRITICAL (latent) — grants every policy to `authenticated`, not just `anon`. Detail in §8.
--   B. Reserves the player_id of any legacy row whose secret is unusable, so it cannot be
--      claimed by a stranger. Detail in §3.
--   C. Self-test now runs the honest path as `authenticated` as well as `anon`, and prints the
--      current challenge number so it can be eyeballed against the game's "Daily #N" label.

create extension if not exists pgcrypto;

-- --- 0a. the table itself ----------------------------------------------------------------------
-- Folded in from the deleted leaderboard.sql so this file is genuinely standalone. Without it,
-- every `alter table` below fails with `relation "public.daily_scores" does not exist` on a fresh
-- project — which is exactly the trap a header saying "supersedes leaderboard.sql" sets for the
-- next person, since "superseded" reads as "do not run it" and the table came from there.
--
-- On the existing project every clause here is a no-op. The unique constraint is load-bearing and
-- not decorative: the client's improve path is `insert ... on conflict (day, player_id) do update`,
-- and ON CONFLICT needs a real unique index on exactly those columns to have anything to conflict
-- against.
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

-- --- 0b. clear out test/junk rows so the stricter checks below can validate ------------------
delete from public.daily_scores
 where day > 100000
    or day <= 0
    or player_id like 'SECTEST-%'
    or player_id like 'SELFTEST-%'
    or player_id like 'victim-%'
    or player_id like 'v3-%'
    or player_id like 'verify-bot-%'
    or player_id = 'claude-test'
    -- rows written by the 2026-08-07 security review while proving the squat lockout and the
    -- client's recovery against the live project (see docs/security-review.md, BACKLOG 1.4)
    or (day = 10001 and company in ('Honest Inc', 'Victim Inc', 'Squatter'));

-- --- 1. THE OUTAGE: the `day` column holds a CHALLENGE NUMBER, not a day-since-epoch ---------
--
-- src/store.ts:
--     const DAILY_EPOCH = 20666            -- days-since-1970 of challenge #1
--     id: Math.floor(Date.now() / 86_400_000) - DAILY_EPOCH + 1
-- and recordRun() parses that `id` back out of the run label and passes it to
-- submitDailyScore(day, ...). So `day` is a small counter starting at 1.
--
-- Two separate controls, deliberately:
--   * a static CHECK constraint with a wide sanity range (constraints must be immutable, and
--     this one also has to hold for old rows on UPDATE), and
--   * a MOVING WINDOW in the INSERT policy, which is where the real anti-junk value is: it
--     stops anyone parking rows on tens of thousands of unused day slots.
--
-- KEEP IN SYNC: if DAILY_EPOCH in src/store.ts ever changes, change 20665 in section 6 too,
-- or submissions start failing again exactly the way they did under v4. Section 9 prints the
-- number this file computes — compare it to the "Daily #N" the game shows today.

-- The two columns later versions added. These MUST come before the constraint below, which
-- names them: on the existing project they already exist and this is a no-op, but on a fresh
-- one the constraint would otherwise fail with `column "display_name" does not exist`. (They
-- also carry what the deleted auth-upgrade.sql did, which is why that file is gone too.)
alter table public.daily_scores add column if not exists display_name text;
alter table public.daily_scores add column if not exists secret text;

alter table public.daily_scores drop constraint if exists daily_scores_sane;
alter table public.daily_scores
  add constraint daily_scores_sane check (
    char_length(company) <= 30
    and char_length(player_id) <= 64
    and (display_name is null or char_length(display_name) <= 24)
    and (secret is null or char_length(secret) <= 128)
    and score >= 0 and score <= 1000000000000
    and weeks >= 0 and weeks <= 520
    and ending in ('bankrupt', 'unicorn', 'acquired', 'fired', 'timeup', 'ipo', 'network')
    and day >= 1 and day <= 100000            -- challenge number, ~270 years of headroom
  ) not valid;

do $$
begin
  alter table public.daily_scores validate constraint daily_scores_sane;
  raise notice 'existing rows validated';
exception when others then
  raise notice 'existing rows left unvalidated (%); new and updated rows are still checked', sqlerrm;
end $$;

-- Table-level grants, deliberately. See the v3 note above: PostgreSQL requires table-level
-- SELECT for `INSERT ... ON CONFLICT DO UPDATE`, which is what the client's upsert compiles to.
-- Hiding the secret column was never what made this safe — it holds a bcrypt hash.
grant select, insert, update on public.daily_scores to anon, authenticated;
-- and no DELETE to anyone: rows cannot be removed from a client, in either role.
revoke delete on public.daily_scores from anon, authenticated;

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
-- owner's submission for that day returned 401. A permanent lockout, plus a row of
-- attacker-chosen text attributed to the victim's id.
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

-- v6 FIX B — the gap in v5's backfill.
--
-- v5 bound only the ids whose row carried a usable secret. Rows written before the secret column
-- existed (leaderboard.sql v1) have `secret is null`, so their player_id stayed UNBOUND while
-- being publicly visible on the leaderboard. A stranger could read such an id, insert a row for
-- it on any day in the window, and the trigger would happily register the id to the ATTACKER's
-- secret — the exact squat v5 §3 exists to prevent, just via the one door it left open.
--
-- These ids are reserved with an unmatchable hash instead of being deleted, because deleting
-- would throw away a real score. The row was already unimprovable (owns_score_row(null) is
-- false), so nothing is lost that was not already lost — and the honest owner self-heals: the
-- client mints a fresh identity when the server says "registered to another device"
-- (src/net/leaderboard.ts), which an attacker holding the id cannot do on their behalf.
insert into private.player_identity (player_id, secret_hash)
select distinct player_id, crypt(gen_random_uuid()::text || gen_random_uuid()::text, gen_salt('bf', 8))
  from public.daily_scores
 where secret is null or char_length(secret) = 0
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
drop policy if exists "players can read daily scores" on public.daily_scores;
create policy "players can read daily scores"
  on public.daily_scores for select to anon, authenticated using (true);

-- INSERT: anyone may post a score for a recent challenge, within bounds, with a secret.
-- The window is generous backwards (a daily run started days ago and finished today is still
-- legitimate) and almost closed forwards — a future challenge number is never honest.
drop policy if exists "anon can submit daily scores" on public.daily_scores;
drop policy if exists "players can submit daily scores" on public.daily_scores;
create policy "players can submit daily scores"
  on public.daily_scores for insert to anon, authenticated
  with check (
    char_length(company) <= 30
    and char_length(player_id) <= 64
    and secret is not null and char_length(secret) >= 16
    and score >= 0 and score <= 1000000000000
    and weeks >= 0 and weeks <= 520
    and ending in ('bankrupt', 'unicorn', 'acquired', 'fired', 'timeup', 'ipo', 'network')
    and day >= 1 and day <= 100000
    and day between private.current_challenge() - 14 and private.current_challenge() + 1
  );

-- UPDATE: only the device holding the secret behind the stored hash. The guard trigger still
-- forbids lowering a score or changing identity, so `day` is not re-checked here on purpose —
-- it cannot change, and re-checking it would lock players out of improving an older row.
drop policy if exists "anon can improve own daily score" on public.daily_scores;
drop policy if exists "players can improve own daily score" on public.daily_scores;
create policy "players can improve own daily score"
  on public.daily_scores for update to anon, authenticated
  using (private.owns_score_row(secret))
  with check (
    char_length(company) <= 30
    and score >= 0 and score <= 1000000000000
    and weeks >= 0 and weeks <= 520
    and ending in ('bankrupt', 'unicorn', 'acquired', 'fired', 'timeup', 'ipo', 'network')
  );

-- No DELETE policy for either role: rows cannot be removed from the client.

-- The v4 function was an unauthenticated bcrypt endpoint; drop it now that the policies above
-- reference the private copy instead.
drop function if exists public.owns_score_row(text);

-- --- 8. v6 FIX A: why every policy names BOTH roles --------------------------------------------
--
-- v5 wrote every policy `to anon`. RLS policies apply only to the roles they name, so under v5
-- the `authenticated` role has table grants and NO policies at all — which means SELECT returns
-- zero rows and INSERT is refused, for everyone who is signed in.
--
-- That is not hypothetical, and it is not "only if the client is changed":
--
--   * BACKLOG 1.2 is an open owner action to switch the Google provider on. Nothing else has to
--     change for this to fire.
--   * supabase-js derives its session storage key from the project ref alone
--     (`defaultStorageKey = sb-<ref>-auth-token`) and `persistSession` defaults to true, so the
--     leaderboard client in src/net/leaderboard.ts and the Realtime client in src/net/online.ts
--     share ONE session. The moment a player signs in, the leaderboard client starts attaching
--     that user's JWT, PostgREST switches the request role from `anon` to `authenticated`, and
--     under v5 the player's leaderboard goes blank and their scores stop posting.
--
-- So enabling social login would have taken the leaderboard down for exactly the players who
-- engaged most — the third time this file has shipped a control that blocks attackers and every
-- real user at once. Naming both roles costs nothing: `authenticated` gets no extra power here,
-- because ownership is proved by the x-player-secret header and not by the session.
--
-- The client is fixed independently too — leaderboard.ts now builds its client with
-- `persistSession: false`, so it stays anonymous whatever happens to auth. Two independent
-- fixes for one hole, on purpose: neither of them needs the other to be correct.

-- --- 9. SELF-TEST: prove both directions, in both roles, then roll it all back ------------------
-- Blocking an attacker is only half of it. v3, v4 and (latently) v5 all blocked attackers AND
-- legitimate players, and all three shipped. This block asserts the honest path works as loudly
-- as it asserts the attacks fail, and it now does so for `authenticated` as well as `anon`.
do $$
declare
  vsecret  text := 'selftest-victim-secret-0123456789abcdef';
  asecret  text := 'selftest-attacker-secret-0123456789abcd';
  usecret  text := 'selftest-signedin-secret-0123456789abcd';
  legacy   text := 'selftest-legacy-thief-0123456789abcdef';
  vid      text := 'SELFTEST-victim';
  sid      text := 'SELFTEST-squatted';
  signedid text := 'SELFTEST-signedin';
  lid      text := 'SELFTEST-legacy';
  today    int  := private.current_challenge();
  n        int;
  failures text[] := '{}';
begin
  raise notice 'current challenge number computed by this file: % — compare with the game''s "Daily #N"', today;

  -- A legacy row with no usable secret: exactly what leaderboard.sql v1 left behind, and the
  -- shape v5's backfill skipped. The BEFORE INSERT trigger refuses a null secret (correctly),
  -- so the trigger comes off just long enough to plant the fixture — this runs as the table
  -- owner, before any `set role`.
  alter table public.daily_scores disable trigger daily_scores_hash_trg;
  insert into public.daily_scores (day, player_id, company, score, weeks, ending, secret)
    values (today, lid, 'Legacy Inc', 10, 5, 'ipo', null)
    on conflict (day, player_id) do nothing;
  alter table public.daily_scores enable trigger daily_scores_hash_trg;

  -- Now run FIX B's backfill exactly as §3 does, so what is under test is the statement that
  -- will actually run against the real table — not a hand-seeded stand-in for it.
  insert into private.player_identity (player_id, secret_hash)
  select distinct player_id, crypt(gen_random_uuid()::text || gen_random_uuid()::text, gen_salt('bf', 8))
    from public.daily_scores
   where secret is null or char_length(secret) = 0
  on conflict (player_id) do nothing;

  if not exists (select 1 from private.player_identity where player_id = lid) then
    failures := failures || 'FIX B DID NOT RESERVE A null-secret player_id';
  end if;

  -- ======================= as an anonymous player (the default) =======================
  execute 'set local role anon';
  perform set_config('request.headers', json_build_object('x-player-secret', vsecret)::text, true);

  -- (1) honest insert must succeed
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (today, vid, 'Victim Inc', 100, 10, 'unicorn', null, vsecret);
  exception when others then
    failures := failures || format('ANON HONEST INSERT FAILED: %s', sqlerrm);
  end;

  -- (2) honest improvement must succeed (this is the exact upsert the client performs)
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (today, vid, 'Victim Inc', 500, 11, 'unicorn', null, vsecret)
    on conflict (day, player_id) do update
      set score = excluded.score, weeks = excluded.weeks, company = excluded.company;
    select score into n from public.daily_scores where day = today and player_id = vid;
    if n <> 500 then failures := failures || format('ANON HONEST IMPROVE DID NOT APPLY (score=%s)', n); end if;
  exception when others then
    failures := failures || format('ANON HONEST IMPROVE FAILED: %s', sqlerrm);
  end;

  -- (3) the leaderboard must be readable
  select count(*) into n from public.daily_scores where day = today;
  if n = 0 then failures := failures || 'ANON COULD NOT READ THE LEADERBOARD'; end if;

  -- (4) a score may not be lowered, even by the owner
  begin
    update public.daily_scores set score = 1 where day = today and player_id = vid;
    failures := failures || 'SCORE WAS LOWERED';
  exception when others then null;
  end;

  -- now act as the attacker: same public anon key, a different secret
  perform set_config('request.headers', json_build_object('x-player-secret', asecret)::text, true);

  -- (5) a stranger must not be able to overwrite the victim's row
  update public.daily_scores set company = 'PWNED', score = 999999999 where day = today and player_id = vid;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'STRANGER OVERWROTE A ROW'; end if;

  -- (6) a stranger must not be able to delete it
  begin
    delete from public.daily_scores where day = today and player_id = vid;
    get diagnostics n = row_count;
    if n <> 0 then failures := failures || 'STRANGER DELETED A ROW'; end if;
  exception when others then null;
  end;

  -- (7) v5's fix: a stranger must not be able to squat an id that is already bound
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (today - 1, vid, 'Squatter', 1, 1, 'bankrupt', null, asecret);
    failures := failures || 'SQUATTER CLAIMED A BOUND player_id';
  exception when others then null;
  end;

  -- (8) v6 FIX B: nor an id whose only row carries no usable secret
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (today - 1, lid, 'Squatter', 1, 1, 'bankrupt', null, legacy);
    failures := failures || 'SQUATTER CLAIMED A LEGACY (null-secret) player_id';
  exception when others then null;
  end;

  -- (9) ...but an id nobody has claimed is still free to register (new players must work)
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (today, sid, 'Newcomer', 42, 3, 'ipo', null, asecret);
  exception when others then
    failures := failures || format('NEW PLAYER COULD NOT REGISTER: %s', sqlerrm);
  end;

  -- (10) the day window: a far-future challenge number must be refused
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (39000, 'SELFTEST-future', 'Future', 1, 1, 'ipo', null, asecret);
    failures := failures || 'A FAR-FUTURE day WAS ACCEPTED';
  exception when others then null;
  end;

  -- (11) value bounds still bite
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (today, 'SELFTEST-huge', 'Huge', 99999999999999, 1, 'ipo', null, asecret);
    failures := failures || 'AN ABSURD SCORE WAS ACCEPTED';
  exception when others then null;
  end;

  -- (12) an unknown ending must be refused (the client mirrors this list)
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (today, 'SELFTEST-ending', 'Weird', 1, 1, 'transcended', null, asecret);
    failures := failures || 'AN UNKNOWN ending WAS ACCEPTED';
  exception when others then null;
  end;

  -- ================== as a SIGNED-IN player — v6 FIX A ==================
  -- Everything above, in the role a player gets the moment social login is enabled. Under v5
  -- every one of these fails, because v5's policies name `anon` and nothing else.
  reset role;
  execute 'set local role authenticated';
  perform set_config('request.headers', json_build_object('x-player-secret', usecret)::text, true);

  -- (13) a signed-in player must be able to READ the leaderboard
  begin
    select count(*) into n from public.daily_scores where day = today;
    if n = 0 then failures := failures || 'SIGNED-IN PLAYER SAW AN EMPTY LEADERBOARD'; end if;
  exception when others then
    failures := failures || format('SIGNED-IN READ FAILED: %s', sqlerrm);
  end;

  -- (14) ...and to POST a score
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (today, signedid, 'SignedIn Inc', 250, 8, 'acquired', 'harris', usecret);
  exception when others then
    failures := failures || format('SIGNED-IN INSERT FAILED: %s', sqlerrm);
  end;

  -- (15) ...and to improve it
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (today, signedid, 'SignedIn Inc', 900, 9, 'acquired', 'harris', usecret)
    on conflict (day, player_id) do update
      set score = excluded.score, weeks = excluded.weeks, company = excluded.company;
    select score into n from public.daily_scores where day = today and player_id = signedid;
    if n <> 900 then failures := failures || format('SIGNED-IN IMPROVE DID NOT APPLY (score=%s)', n); end if;
  exception when others then
    failures := failures || format('SIGNED-IN IMPROVE FAILED: %s', sqlerrm);
  end;

  -- (16) and a signed-in stranger is still just a stranger to someone else's row
  update public.daily_scores set company = 'PWNED', score = 999999999 where day = today and player_id = vid;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'SIGNED-IN STRANGER OVERWROTE A ROW'; end if;

  -- (17) ...and still cannot squat a bound id
  begin
    insert into public.daily_scores (day, player_id, company, score, weeks, ending, display_name, secret)
    values (today - 2, vid, 'Squatter', 1, 1, 'bankrupt', null, usecret);
    failures := failures || 'SIGNED-IN SQUATTER CLAIMED A BOUND player_id';
  exception when others then null;
  end;

  reset role;
  delete from public.daily_scores where player_id like 'SELFTEST-%';
  delete from private.player_identity where player_id like 'SELFTEST-%';

  if array_length(failures, 1) is not null then
    raise exception E'leaderboard v6 self-test FAILED:\n  - %', array_to_string(failures, E'\n  - ');
  end if;
  raise notice 'leaderboard v6 self-test passed: anon AND authenticated can submit, improve and read; squat/overwrite/delete/lower/inflate/unknown-ending all refused';
end $$;

-- --- 10. what this does NOT fix (accepted, or needs an owner decision) --------------------------
-- * Nothing simulates the game server-side, so a player can still submit a plausible but
--   cheated score for THEMSELVES. Closing that needs replay verification server-side (see the
--   note below) or an authoritative server. RLS cannot do it at any level of cleverness.
-- * display_name is self-asserted for anonymous players, so a signed-out player can put
--   someone else's handle on their OWN row. Requiring login to post would close it.
-- * INSERT is still an unauthenticated bcrypt endpoint: every insert costs one or two
--   bcrypt(cost 8) operations (~25ms of server CPU each), the anon key is public by design, and
--   the identity binding means a flooder just mints a fresh player_id per row — for free. v5
--   removed the public RPC; it did not remove the cost, it moved it. This needs an edge rate
--   limit (Supabase's own, or Cloudflare in front of /rest/v1), plus a spending cap and usage
--   alerts. Nothing in this file, or in any client, can fix it.
--
-- IF YOU ADD THE REPLAY-PROOF COLUMNS (BACKLOG 8.1 #1), BOUND THEM FIRST.
-- `journal jsonb` writable by anon with no size limit is a storage DoS: the journal ceiling is
-- 20,000 entries (JOURNAL_LIMIT), the anon key is public, and there is no rate limit. Add the
-- columns with the bound attached in the same statement, not afterwards:
--
--   alter table public.daily_scores add column if not exists journal jsonb;
--   alter table public.daily_scores add column if not exists fingerprint text;
--   alter table public.daily_scores add constraint daily_scores_proof_bounded check (
--     (journal is null or (jsonb_typeof(journal) = 'array'
--                          and jsonb_array_length(journal) <= 20000
--                          and pg_column_size(journal) <= 262144))
--     and (fingerprint is null or char_length(fingerprint) <= 32)
--   );
--
-- and add `journal`/`fingerprint` to the daily_scores_guard trigger's immutable list if a proof
-- should not be swappable after the fact.
