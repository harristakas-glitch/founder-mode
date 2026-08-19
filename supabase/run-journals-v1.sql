-- Founder Mode — run-journal uploads, v1.
--
-- ============================================================================================
-- THIS IS THE SECOND SQL FILE IN THIS DIRECTORY, AND IT IS OPTIONAL.
--
--   supabase/leaderboard-v6.sql   the daily leaderboard. RUN THAT ONE FIRST. It is required for
--                                 the game's existing features and it is what LEADERBOARD-SETUP.md
--                                 describes. Nothing in this file changes it or depends on it.
--   supabase/run-journals-v1.sql  THIS FILE. Only needed if you want finished and abandoned runs
--                                 uploaded for later analysis (docs/analytics.md). Skip it and
--                                 the game is unaffected — the client's upload simply refuses.
--
-- Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
--
-- The two scripts are deliberately separate. The 2026-08 security review's finding 6 was that
-- `supabase/` had grown to six scripts with four documents each naming a different one as "the one
-- to run", and that this is how a total leaderboard outage survived two weeks. The fix for that is
-- not "never add a second file", it is "every file says what it is, what order it goes in, and
-- what happens if you skip it". This one is doing that. leaderboard-v6.sql was not touched.
--
-- It is idempotent — running it twice is harmless — and it VERIFIES ITSELF at the bottom: §6 runs
-- the whole attack matrix against the policy it just created, as BOTH database roles, and raises
-- with a list of failures if any case comes out wrong.
--
-- SUCCESS LOOKS LIKE: "run_journals v1 self-test passed: ..." in the notices, and no error.
-- FAILURE LOOKS LIKE: an exception listing every case that came out wrong. Send it on rather than
-- editing this file until it passes. The self-test's fixture rows are never left behind either
-- way: an exception out of a DO block rolls the whole block back, and the passing path deletes
-- them explicitly.
-- ============================================================================================
--
-- WHAT THIS TABLE IS FOR
--
-- Founder Mode is deterministic. src/game/replay.ts records a complete, replayable action journal
-- for every solo run — about 4 KB for a 90-week run — and `replayRun(header, journal)` rebuilds the
-- run exactly. Uploading those logs means any metric can be computed retroactively, including ones
-- nobody has thought of yet, without having had to instrument them in advance.
--
-- WHAT THIS TABLE IS NOT FOR: identifying anybody. No player id, no leaderboard id, no session id,
-- no IP column, and no company name — the client replaces it with the literal string 'redacted'
-- before upload (src/analytics/runJournal.ts), and the replay is byte-identical without it. There
-- is no column here that can be joined to a person, and that is a schema decision, not a promise.
--
-- ============================================================================================
-- THE THREAT MODEL, WRITTEN DOWN BEFORE THE SCHEMA
-- ============================================================================================
-- The anon key is public by design (docs/security-review-2026-08.md, accepted risks). So assume a
-- hostile client with a valid key, unlimited time, and no interest in playing the game:
--
--   1. STORAGE DoS — post enormous jsonb until the project hits quota. §10 of leaderboard-v6.sql
--      wrote this warning for this exact feature before it existed: "journal jsonb writable by anon
--      with no size limit is a storage DoS". Bounded on BOTH axes below (entry count AND stored
--      bytes) and in the client, using the client's own JOURNAL_LIMIT rather than a second number.
--   2. POISONING — write rows that corrupt the analysis. Every scalar is bounded and shape-checked;
--      a row that does not look like a run is refused at insert time, not filtered at read time.
--   3. READING OTHER PLAYERS' RUNS — there is no SELECT grant and no SELECT policy for any client
--      role. The table is genuinely insert-only from a browser; only the dashboard can read it.
--   4. EDITING OR DELETING HISTORY — no UPDATE or DELETE grant, and no policy. A row, once written,
--      is not reachable from a client at all.
--   5. SMUGGLING EXTRA COLUMNS — the INSERT grant is COLUMN-LEVEL, so a client cannot name `id` or
--      `created_at`, cannot backdate a row, and cannot write a column added here in the future
--      without that column being granted on purpose.
--
-- NOT DEFENDED, and saying so plainly is the point:
--   * A determined flooder can still insert many small, well-formed rows. Nothing in a client or in
--     RLS can stop that — it needs an edge rate limit (Supabase's own, or Cloudflare in front of
--     /rest/v1) plus a spend cap. This is the SAME accepted risk the leaderboard already carries
--     (leaderboard-v6.sql §10, BACKLOG 1.2), not a new one, and the mitigation is the same one.
--   * A player can upload a journal describing a run they cheated at. The journal is checkable —
--     it either replays to its own fingerprint or it does not — but nothing here does that
--     checking, and a fabricated-but-consistent run is indistinguishable from a real one. This is
--     analysis data, never a score.

create extension if not exists pgcrypto;

-- --- 1. the table ------------------------------------------------------------------------------
create table if not exists public.run_journals (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  -- Deterministic per (run, reason) plus an in-memory per-run nonce, so a retry loop dedupes on
  -- the unique index instead of writing a row per attempt. It is NOT an identifier: it is derived
  -- from the seed and the end-state fingerprint, it is never persisted on the device, and it never
  -- survives a page reload. See buildJournalPayload() in src/analytics/runJournal.ts.
  run_key      text not null,
  reason       text not null,      -- 'ended' | 'abandoned'
  mode         text not null,      -- quick | career | arena
  format       text not null,      -- standard | daily_challenge | scenario
  sector       text not null,
  scenario     text,
  founder      text not null,
  ending       text,               -- null for an abandoned run: that IS the interesting case
  weeks        int  not null,
  score        bigint not null,
  seed         bigint not null,
  fingerprint  text not null,
  verified     text not null,      -- verified | unverifiable_desync | legacy_no_journal
  entries      int  not null,
  journal      jsonb not null,
  header       jsonb not null,
  constraint run_journals_run_key_unique unique (run_key)
);

create index if not exists run_journals_created_idx on public.run_journals (created_at desc);
create index if not exists run_journals_shape_idx on public.run_journals (mode, sector, reason);

-- --- 2. the bounds ------------------------------------------------------------------------------
--
-- SHAPE-CHECKED, NOT VALUE-ENUMERATED, and that is a deliberate decision with a history behind it.
-- The obvious constraint here is `sector in ('saas','devtools',…)`. This file refuses to write it.
-- Three of five versions of leaderboard-v6.sql shipped a control that blocked attackers and every
-- legitimate player at once, and the `ending in (…)` list in that file needs a migration every time
-- the game grows an ending — it already caught the team out once when `network` shipped. A new
-- sector must never silently start failing uploads because a SQL file nobody remembered was pinned
-- to last year's content. The threat is oversized and malformed data, and `^[a-z_]{1,32}$` stops
-- that completely; it was never "sector might be spelled wrong".
--
-- `reason` IS enumerated, because it is a two-value vocabulary owned by this feature and defined in
-- this same commit. It cannot drift with game content, so there is nothing to keep in sync.
alter table public.run_journals drop constraint if exists run_journals_sane;
alter table public.run_journals
  add constraint run_journals_sane check (
    char_length(run_key) between 1 and 96
    and reason in ('ended', 'abandoned')
    and mode ~ '^[a-z_]{1,32}$'
    and format ~ '^[a-z_]{1,32}$'
    and sector ~ '^[a-z_]{1,32}$'
    and founder ~ '^[a-z_]{1,32}$'
    and (scenario is null or scenario ~ '^[a-z0-9_.:-]{1,48}$')
    and (ending is null or ending ~ '^[a-z_]{1,32}$')
    and verified ~ '^[a-z_]{1,32}$'
    and fingerprint ~ '^[0-9]{1,20}$'
    and weeks between 0 and 100000
    and score between 0 and 1000000000000
    and seed between 0 and 4294967296
    -- A run with no decisions in it is not data, it is a row. Refusing them costs nothing honest
    -- (every real run journals at least one action) and removes the cheapest flooding payload.
    and entries between 1 and 20000
    and jsonb_typeof(journal) = 'array'
    -- THE ENTRY CAP IS THE CLIENT'S OWN. JOURNAL_LIMIT in src/game/replay.ts is 20,000:
    -- `recordJournal` drops the journal past it and `sanitizeJournal` refuses to read past it, so
    -- no honest run can produce a longer one. The writer's ceiling has to be the reader's ceiling
    -- — that was finding 8 of the 2026-08 review, in this same journal, and it is the same rule.
    and jsonb_array_length(journal) <= 20000
    and jsonb_array_length(journal) = entries
    -- The second axis: 20,000 tiny entries and 20,000 fat ones are very different amounts of
    -- storage. 256 KB is the figure leaderboard-v6.sql §10 recommended for exactly this column,
    -- and the client refuses to send a payload whose JSON exceeds it (MAX_JOURNAL_BYTES). Note
    -- pg_column_size measures STORED size after compression, so it is the storage bound; the
    -- client's is the wire bound. Two different measurements of the same intent, both present.
    and pg_column_size(journal) <= 262144
    and jsonb_typeof(header) = 'object'
    and pg_column_size(header) <= 4096
  ) not valid;

do $$
begin
  alter table public.run_journals validate constraint run_journals_sane;
  raise notice 'existing run_journals rows validated';
exception when others then
  raise notice 'existing rows left unvalidated (%); new rows are still checked', sqlerrm;
end $$;

-- --- 3. grants: insert-only, and column by column ----------------------------------------------
--
-- Table-level privileges are revoked first so that re-running this file after a column is added
-- cannot leave a stale broader grant behind. Then INSERT is granted on EXACTLY the columns the
-- client sends. `id` and `created_at` are absent on purpose: a client that cannot name `created_at`
-- cannot backdate a row, which is the cheapest way to make the timeline trustworthy.
revoke all on public.run_journals from anon, authenticated;
grant insert (
  run_key, reason, mode, format, sector, scenario, founder,
  ending, weeks, score, seed, fingerprint, verified, entries, journal, header
) on public.run_journals to anon, authenticated;
-- No SELECT: the client never reads back, and supabase-js sends `Prefer: return=minimal` when
-- `.insert()` is called without `.select()`, so the honest path needs no read privilege at all.
-- No UPDATE, no DELETE, in either role.

-- --- 4. RLS -------------------------------------------------------------------------------------
alter table public.run_journals enable row level security;

-- BOTH ROLES, always. Finding 5 of the 2026-08 review: supabase-js derives its session storage key
-- from the project ref alone, so the moment social login is enabled a signed-in player's client
-- starts sending their JWT and PostgREST switches the request role from `anon` to `authenticated`.
-- A policy written `to anon` only would then refuse every signed-in player — silently, and only for
-- the players engaged enough to sign in. It has happened three times in this project's history.
-- `authenticated` gains nothing extra here: the policy grants no more than `anon` already has.
drop policy if exists "players can upload run journals" on public.run_journals;
create policy "players can upload run journals"
  on public.run_journals for insert to anon, authenticated
  with check (
    char_length(run_key) between 1 and 96
    and reason in ('ended', 'abandoned')
    and entries between 1 and 20000
    and jsonb_typeof(journal) = 'array'
    and jsonb_array_length(journal) <= 20000
    and pg_column_size(journal) <= 262144
    and jsonb_typeof(header) = 'object'
    and pg_column_size(header) <= 4096
  );

-- Deliberately no SELECT, UPDATE or DELETE policy. With RLS on and no policy for an operation,
-- that operation matches nothing — a belt to §3's braces, so removing one does not open the other.

-- --- 5. what the dashboard reads ----------------------------------------------------------------
-- A convenience view for the owner, in the `private` schema leaderboard-v6.sql already created and
-- which PostgREST does not expose. It exists so that reading the table from the SQL editor does not
-- mean scrolling past 4 KB of jsonb per row.
create schema if not exists private;
create or replace view private.run_journal_summary as
  select created_at, reason, mode, format, sector, ending, weeks, score, entries, verified,
         pg_column_size(journal) as journal_bytes
    from public.run_journals
   order by created_at desc;
revoke all on private.run_journal_summary from public, anon, authenticated;

-- --- 6. SELF-TEST: prove both directions, in both roles, then roll it all back -------------------
-- Blocking an attacker is half of it. The other half is that the feature works — and in this
-- project the half that gets forgotten is always the second one.
do $$
declare
  base   jsonb := '[{"w":1,"a":"advance"},{"w":2,"a":"advance"}]'::jsonb;
  head   jsonb := '{"companyName":"redacted","founderKind":"hacker"}'::jsonb;
  huge   jsonb;
  n        int;
  failures text[] := '{}';
begin
  -- ======================= as an anonymous player (the default) =======================
  execute 'set local role anon';

  -- (1) the honest upload must succeed
  begin
    insert into public.run_journals (run_key, reason, mode, format, sector, scenario, founder,
                                     ending, weeks, score, seed, fingerprint, verified, entries, journal, header)
    values ('SELFTEST-anon-ended', 'ended', 'quick', 'standard', 'saas', null, 'hacker',
            'unicorn', 90, 1000, 12345, '4213076921', 'verified', 2, base, head);
  exception when others then
    failures := failures || format('ANON HONEST UPLOAD FAILED: %s', sqlerrm);
  end;

  -- (2) an ABANDONED run must upload too — it is the whole point of the feature, and a policy
  --     that quietly required an ending would measure only the survivors
  begin
    insert into public.run_journals (run_key, reason, mode, format, sector, scenario, founder,
                                     ending, weeks, score, seed, fingerprint, verified, entries, journal, header)
    values ('SELFTEST-anon-abandoned', 'abandoned', 'career', 'daily_challenge', 'fintech', null, 'operator',
            null, 3, 0, 999, '17', 'verified', 2, base, head);
  exception when others then
    failures := failures || format('ANON ABANDONED UPLOAD FAILED: %s', sqlerrm);
  end;

  -- (3) a duplicate run_key must not create a second row (the retry-dedupe path)
  begin
    insert into public.run_journals (run_key, reason, mode, format, sector, founder,
                                     ending, weeks, score, seed, fingerprint, verified, entries, journal, header)
    values ('SELFTEST-anon-ended', 'ended', 'quick', 'standard', 'saas', 'hacker',
            'unicorn', 90, 1000, 12345, '4213076921', 'verified', 2, base, head)
    on conflict (run_key) do nothing;
  exception when others then
    failures := failures || format('ANON RETRY (on conflict do nothing) FAILED: %s', sqlerrm);
  end;

  -- (4) the client must not be able to READ anything back
  begin
    select count(*) into n from public.run_journals;
    failures := failures || format('ANON COULD READ THE TABLE (%s rows)', n);
  exception when others then null;
  end;

  -- (5) ...or change a row
  begin
    update public.run_journals set score = 999999 where run_key = 'SELFTEST-anon-ended';
    failures := failures || 'ANON COULD UPDATE A ROW';
  exception when others then null;
  end;

  -- (6) ...or delete one
  begin
    delete from public.run_journals where run_key = 'SELFTEST-anon-ended';
    failures := failures || 'ANON COULD DELETE A ROW';
  exception when others then null;
  end;

  -- (7) ...or backdate one: `created_at` is not in the column grant
  begin
    insert into public.run_journals (run_key, reason, mode, format, sector, founder, weeks, score,
                                     seed, fingerprint, verified, entries, journal, header, created_at)
    values ('SELFTEST-backdate', 'ended', 'quick', 'standard', 'saas', 'hacker', 5, 0,
            1, '1', 'verified', 2, base, head, '1999-01-01');
    failures := failures || 'ANON COULD SET created_at';
  exception when others then null;
  end;

  -- (8) the storage DoS: a journal past the entry cap
  begin
    insert into public.run_journals (run_key, reason, mode, format, sector, founder, weeks, score,
                                     seed, fingerprint, verified, entries, journal, header)
    select 'SELFTEST-toomany', 'ended', 'quick', 'standard', 'saas', 'hacker', 5, 0,
           1, '1', 'verified', 20001, jsonb_agg('{"w":1,"a":"advance"}'::jsonb), head
      from generate_series(1, 20001);
    failures := failures || 'A 20001-ENTRY JOURNAL WAS ACCEPTED';
  exception when others then null;
  end;

  -- (9) ...and one past the byte cap, well inside the entry cap.
  --
  -- The payload is deliberately HIGH-ENTROPY (random bytes, base64) rather than `repeat('x', …)`.
  -- A 300 KB run of one repeated character compresses to almost nothing, so a fixture built that
  -- way can slip under a size bound and make this case report a pass it did not earn — the test
  -- would be measuring the compressor, not the constraint.
  select jsonb_agg(jsonb_build_object('w', 1, 'a', 'advance', 'p',
           jsonb_build_object('v', encode(gen_random_bytes(48), 'base64'))))
    into huge
    from generate_series(1, 4000);
  begin
    insert into public.run_journals (run_key, reason, mode, format, sector, founder, weeks, score,
                                     seed, fingerprint, verified, entries, journal, header)
    values ('SELFTEST-toobig', 'ended', 'quick', 'standard', 'saas', 'hacker', 5, 0,
            1, '1', 'verified', 4000, huge, head);
    failures := failures || format('A %s-BYTE JOURNAL WAS ACCEPTED (4000 entries, inside the entry cap)',
                                   pg_column_size(huge));
  exception when others then null;
  end;

  -- (10) an empty journal is a row, not data
  begin
    insert into public.run_journals (run_key, reason, mode, format, sector, founder, weeks, score,
                                     seed, fingerprint, verified, entries, journal, header)
    values ('SELFTEST-empty', 'ended', 'quick', 'standard', 'saas', 'hacker', 5, 0,
            1, '1', 'verified', 0, '[]'::jsonb, head);
    failures := failures || 'AN EMPTY JOURNAL WAS ACCEPTED';
  exception when others then null;
  end;

  -- (11) `entries` must describe the journal it ships with, or the column is decoration
  begin
    insert into public.run_journals (run_key, reason, mode, format, sector, founder, weeks, score,
                                     seed, fingerprint, verified, entries, journal, header)
    values ('SELFTEST-lying', 'ended', 'quick', 'standard', 'saas', 'hacker', 5, 0,
            1, '1', 'verified', 999, base, head);
    failures := failures || 'A LYING entries COUNT WAS ACCEPTED';
  exception when others then null;
  end;

  -- (12) prose in a slug column: the shape check, not an enum list
  begin
    insert into public.run_journals (run_key, reason, mode, format, sector, founder, weeks, score,
                                     seed, fingerprint, verified, entries, journal, header)
    values ('SELFTEST-prose', 'ended', 'quick', 'standard', 'Hyperloop for Cats, Inc.', 'hacker', 5, 0,
            1, '1', 'verified', 2, base, head);
    failures := failures || 'A COMPANY NAME WAS ACCEPTED AS A SECTOR';
  exception when others then null;
  end;

  -- (13) ...but a sector this file has never heard of is still fine. This is the case that keeps
  --      the next content update from silently switching uploads off.
  begin
    insert into public.run_journals (run_key, reason, mode, format, sector, founder, weeks, score,
                                     seed, fingerprint, verified, entries, journal, header)
    values ('SELFTEST-future', 'ended', 'quick', 'standard', 'quantum_biotech', 'hacker', 5, 0,
            1, '1', 'verified', 2, base, head);
  exception when others then
    failures := failures || format('A FUTURE SECTOR WAS REFUSED: %s', sqlerrm);
  end;

  -- ======================= as a signed-in player =======================
  execute 'set local role authenticated';

  -- (14) everything above must hold for a signed-in player too
  begin
    insert into public.run_journals (run_key, reason, mode, format, sector, founder, weeks, score,
                                     seed, fingerprint, verified, entries, journal, header)
    values ('SELFTEST-auth-ended', 'ended', 'quick', 'standard', 'saas', 'hacker', 40, 5, 7,
            '99', 'verified', 2, base, head);
  exception when others then
    failures := failures || format('SIGNED-IN UPLOAD FAILED: %s', sqlerrm);
  end;

  -- (15) ...including not being able to read the table
  begin
    select count(*) into n from public.run_journals;
    failures := failures || format('SIGNED-IN COULD READ THE TABLE (%s rows)', n);
  exception when others then null;
  end;

  -- ======================= back as the owner: check what actually landed =======================
  reset role;

  select count(*) into n from public.run_journals where run_key like 'SELFTEST-%';
  if n <> 4 then
    failures := failures || format('EXPECTED 4 SELFTEST ROWS (anon ended+abandoned, future sector, signed-in), GOT %s', n);
  end if;

  select score into n from public.run_journals where run_key = 'SELFTEST-anon-ended';
  if n <> 1000 then failures := failures || format('THE RETRY OVERWROTE A ROW (score=%s)', n); end if;

  if not exists (select 1 from public.run_journals
                  where run_key = 'SELFTEST-anon-abandoned' and ending is null) then
    failures := failures || 'THE ABANDONED RUN DID NOT LAND WITH A NULL ending';
  end if;

  if exists (select 1 from public.run_journals where created_at < now() - interval '1 hour') then
    failures := failures || 'A ROW CARRIES A created_at THE CLIENT CHOSE';
  end if;

  delete from public.run_journals where run_key like 'SELFTEST-%';

  if array_length(failures, 1) is not null then
    raise exception E'run_journals v1 self-test FAILED:\n  - %', array_to_string(failures, E'\n  - ');
  end if;
  raise notice 'run_journals v1 self-test passed: anon AND authenticated can upload finished and abandoned runs; read/update/delete/backdate/oversize/empty/miscounted/prose all refused; an unknown future sector still uploads';
end $$;

-- --- 7. reading the data ------------------------------------------------------------------------
-- From the SQL editor (the only place that can read this table):
--
--   select * from private.run_journal_summary limit 50;
--
--   -- where do runs stop, by sector — the abandonment curve the events also measure
--   select sector, reason, count(*), percentile_cont(0.5) within group (order by weeks) as median_weeks
--     from public.run_journals group by 1, 2 order by 1, 2;
--
--   -- one run, replayable: feed header+journal to replayRun() in src/game/replay.ts
--   select header, journal from public.run_journals where run_key = '…';
--
-- HOUSEKEEPING, worth setting a reminder for rather than discovering later: nothing deletes old
-- rows. At 4 KB a run this is small for a long time, but it is not self-limiting. When it stops
-- being small:
--
--   delete from public.run_journals where created_at < now() - interval '180 days';
