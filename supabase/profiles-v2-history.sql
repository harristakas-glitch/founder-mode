-- profiles v2 — history travels with the profile. Run AFTER profiles-v1.sql.
--
-- WHY (owner, 2026-08-23): "the history and historical data should be attached on profile
-- across browsers". The hall of fame (top runs, with company names) and the lifetime run
-- counter lived only in localStorage, so two browsers wearing the same profile told two
-- different biographies. This adds both to the profile row; the client merges (union by run
-- identity / high-water counter) so devices enrich each other and neither erases the other.
--
-- PRIVACY NOTE, decided eyes-open: hall entries carry the player-typed COMPANY NAME, and the
-- profile row is world-readable. This is the same exposure class as the leaderboard, which has
-- published player-typed company names next to the nickname since v6. The client scrubs the
-- same character class the leaderboard scrubs (control chars, zero-widths, bidi overrides) and
-- the caps below bound the blob. The 2026-08-22 "company never travels" rule for bests is
-- superseded by this owner decision — bests may now carry a scrubbed company name too (the v1
-- bests cap already holds it; its self-test always wrote one).
--
-- WHAT THIS DOES NOT CLAIM: like achievements and bests, the hall is CLIENT-ASSERTED
-- (BACKLOG §3.3). The server bounds its size and shape so it cannot be abused as storage; it
-- cannot verify a run happened. A profile that lies only lies about its owner.
--
-- Idempotent: safe to re-run. Self-testing in the v6 discipline: the DO block runs the attack
-- matrix AND the honest path and raises with a list of failures if any case comes out wrong.
-- SUCCESS LOOKS LIKE: "profiles v2 self-test passed: ..." in the notices, and no error.

-- ======================= 1. columns =======================

alter table public.profiles add column if not exists hall      jsonb   not null default '[]'::jsonb;
alter table public.profiles add column if not exists run_count integer not null default 0;

-- A hall is ten small rows, not blob storage. 8 KB holds ~5x what an honest client produces
-- (10 entries × ~140 bytes); the client caps count at 10 and every string inside on both push
-- and read (src/net/profile.ts), so the byte cap is the backstop, not the contract.
alter table public.profiles drop constraint if exists profiles_hall_shape;
alter table public.profiles
  add constraint profiles_hall_shape check (
    jsonb_typeof(hall) = 'array' and pg_column_size(hall) <= 8192
  );

-- a lifetime counter, not a scoreboard: bounded so it cannot be abused as a display number
alter table public.profiles drop constraint if exists profiles_run_count_range;
alter table public.profiles
  add constraint profiles_run_count_range check (run_count >= 0 and run_count <= 1000000);

-- the update grant is column-additive; v1 granted the others
grant update (hall, run_count) on public.profiles to authenticated;

-- ======================= 2. self-test =======================
-- v6 rule: assert the attack is refused AND the honest path works, per role, same run.

do $$
declare
  ua uuid := gen_random_uuid();
  failures text[] := '{}';
  n int;
begin
  -- fixture: one real auth.users row so the signup trigger and auth.uid() policies are real
  begin
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'selftest-v2@profiles.test', now(), now());
  exception when others then
    raise notice 'profiles v2 self-test SKIPPED — this role cannot write auth.users (%). NOT proven on this run: the per-role policy behaviour for the new columns. The constraints and grants above are still installed.', sqlerrm;
    return;
  end;

  -- (1) the new columns exist with sane defaults on a fresh profile
  select count(*) into n from public.profiles
   where user_id = ua and hall = '[]'::jsonb and run_count = 0;
  if n <> 1 then failures := failures || 'FRESH PROFILE MISSING hall/run_count DEFAULTS'; end if;

  -- ======================= as the owner =======================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);

  -- (2) the honest path: a real-shaped hall and a counter go in
  begin
    update public.profiles
       set hall = '[{"company":"Selftest Inc","sector":"B2B SaaS","ending":"acquired","weeks":80,"score":1000000,"at":1755800000000},
                    {"company":"Second Co","sector":"Fintech","ending":"bankrupt","weeks":12,"score":0,"at":1755900000000}]'::jsonb,
           run_count = 7
     where user_id = ua;
    if not found then failures := failures || 'OWNER COULD NOT WRITE HALL/RUN_COUNT'; end if;
  exception when others then
    failures := failures || format('OWNER HALL WRITE FAILED: %s', sqlerrm);
  end;

  -- (3) oversize hall refused (the byte cap)
  begin
    update public.profiles
       set hall = (select jsonb_agg(jsonb_build_object('company', repeat('x', 400), 'score', i)) from generate_series(1, 40) i)
     where user_id = ua;
    failures := failures || 'OVERSIZE HALL ACCEPTED';
  exception when others then null;
  end;

  -- (4) mis-shaped hall refused
  begin
    update public.profiles set hall = '{"not":"an array"}'::jsonb where user_id = ua;
    failures := failures || 'NON-ARRAY HALL ACCEPTED';
  exception when others then null;
  end;

  -- (5) counter bounds hold both ways
  begin
    update public.profiles set run_count = -1 where user_id = ua;
    failures := failures || 'NEGATIVE RUN_COUNT ACCEPTED';
  exception when others then null;
  end;
  begin
    update public.profiles set run_count = 99999999 where user_id = ua;
    failures := failures || 'ABSURD RUN_COUNT ACCEPTED';
  exception when others then null;
  end;

  -- ======================= as anon =======================
  reset role;
  execute 'set local role anon';

  -- (6) anon reads the hall (profiles are public by design) but cannot write it
  begin
    select count(*) into n from public.profiles where user_id = ua and jsonb_array_length(hall) = 2;
    if n <> 1 then failures := failures || 'ANON CANNOT READ THE HALL'; end if;
  exception when others then
    failures := failures || format('ANON HALL READ FAILED: %s', sqlerrm);
  end;
  begin
    update public.profiles set hall = '[]'::jsonb, run_count = 0 where user_id = ua;
    if found then failures := failures || 'ANON REWROTE A HALL'; end if;
  exception when others then null;
  end;

  -- ======================= verdict =======================
  reset role;
  delete from public.profiles where user_id = ua;
  begin
    delete from auth.users where id = ua;
  exception when others then null;
  end;

  if array_length(failures, 1) is not null then
    raise exception E'profiles v2 self-test FAILED:\n  - %', array_to_string(failures, E'\n  - ');
  end if;
  raise notice 'profiles v2 self-test passed: fresh profiles default to an empty hall and zero runs; owners record history within caps; oversize/mis-shaped blobs and out-of-range counters refused; anon reads but cannot write';
end;
$$;
