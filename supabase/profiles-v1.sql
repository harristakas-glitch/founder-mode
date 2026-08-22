-- profiles v1 — the identity layer. Run AFTER leaderboard-v6.sql (any time; independent tables).
--
-- WHAT THIS IS (BACKLOG multiplayer plan, 2026-08-22): one public profile row per signed-in
-- player. A NICKNAME the game displays everywhere instead of the OAuth real name — the real name
-- and email are never copied into this table, so no reader of it can leak them — plus the
-- lifetime achievement badges and per-mode personal bests the profile screen shows.
--
-- THE PRIVACY RULE, stated once and enforced by construction: the signup trigger GENERATES a
-- nickname ("Quiet Falcon 42"); it never derives one from user metadata — and it copies NOTHING
-- else, the provider avatar included (a Google avatar URL is stable per account, so publishing
-- it would link the pseudonym back to the person; review finding, 2026-08-22). display_name on
-- the leaderboard is fed from this nickname by the client from now on.
--
-- WHAT THIS DOES NOT CLAIM: achievements and bests are CLIENT-ASSERTED, like every solo-run
-- number in this game (BACKLOG §3.3). The server caps their size and shape so they cannot be
-- abused as storage, but it cannot verify a badge was earned. The replay-proof machinery can
-- harden this later; a profile that lies only lies about its owner.
--
-- Idempotent: safe to re-run. Self-testing in the v6 discipline: the DO block at the end runs
-- the attack matrix AND the honest path, as anon AND as authenticated, and raises with a list
-- of failures if any case comes out wrong. An exception rolls back the fixtures, so nothing is
-- ever left behind.
-- SUCCESS LOOKS LIKE: "profiles v1 self-test passed: ..." in the notices, and no error.

-- v6 creates the private schema; this guard makes the script self-contained on a fresh project.
create schema if not exists private;

-- ======================= 1. table =======================

create table if not exists public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  nickname    text not null,
  avatar_url  text,
  achievements jsonb not null default '[]'::jsonb,
  bests        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Shape and size constraints. The regex is mirrored by the client (src/net/profile.ts) so the
-- player is told before the database is; 3–24 chars, letters/digits/space/._-, must start and
-- end on a letter or digit.
alter table public.profiles drop constraint if exists profiles_nickname_shape;
alter table public.profiles
  add constraint profiles_nickname_shape check (
    nickname ~ '^[A-Za-z0-9][A-Za-z0-9 _.\-]{1,22}[A-Za-z0-9]$'
    -- and never two spaces in a row: HTML collapses whitespace runs, so 'Quiet  Falcon 42'
    -- RENDERS identically to 'Quiet Falcon 42' — the unique index below would accept the
    -- doubled-space variant and the screen would show two players wearing one name.
    and nickname !~ '  '
  );

alter table public.profiles drop constraint if exists profiles_avatar_https;
alter table public.profiles
  add constraint profiles_avatar_https check (
    avatar_url is null or (avatar_url like 'https://%' and char_length(avatar_url) <= 512)
  );

-- A profile is a profile, not free blob storage: the badge list is an array of short ids, the
-- bests are one small object per mode. 4 KB each holds an order of magnitude more than the game
-- can produce.
alter table public.profiles drop constraint if exists profiles_achievements_shape;
alter table public.profiles
  add constraint profiles_achievements_shape check (
    jsonb_typeof(achievements) = 'array' and pg_column_size(achievements) <= 4096
  );

alter table public.profiles drop constraint if exists profiles_bests_shape;
alter table public.profiles
  add constraint profiles_bests_shape check (
    jsonb_typeof(bests) = 'object' and pg_column_size(bests) <= 4096
  );

-- Impersonation guard: nicknames are unique, case-insensitively. The signup generator retries
-- on collision; a player renaming into a taken name gets a clean 23505 the client translates.
create unique index if not exists profiles_nickname_unique on public.profiles (lower(nickname));

-- ======================= 2. the signup trigger =======================

-- The generator is its own function so the self-test can exercise it directly.
create or replace function private.generate_nickname() returns text
language plpgsql
as $$
declare
  adjectives text[] := array['Quiet','Bold','Feral','Patient','Sly','Lucid','Rogue','Solar',
                             'Nimble','Stoic','Vivid','Wry','Keen','Deft','Calm','Late'];
  nouns      text[] := array['Falcon','Otter','Comet','Harbor','Signal','Ledger','Summit','Drift',
                             'Kestrel','Anchor','Meridian','Quartz','Aurora','Vector','Fathom','Ember'];
  candidate text;
  attempt int := 0;
begin
  loop
    candidate := adjectives[1 + floor(random() * array_length(adjectives, 1))::int]
              || ' ' || nouns[1 + floor(random() * array_length(nouns, 1))::int]
              || ' ' || (10 + floor(random() * 90))::int;
    exit when not exists (select 1 from public.profiles where lower(nickname) = lower(candidate));
    attempt := attempt + 1;
    if attempt >= 8 then
      -- the space is effectively unexhaustible (23k combos); this is a formality, not a path
      candidate := 'Founder ' || floor(random() * 1000000)::int;
      exit;
    end if;
  end loop;
  return candidate;
end;
$$;

-- Fires as the auth admin on signup; security definer so it can write public.profiles. It reads
-- NO metadata at all: not the name (that is the point of the nickname) and — review fix,
-- 2026-08-22 — not the avatar either. The provider avatar URL is stable per Google account and
-- world-readable here, so publishing it links the pseudonym straight back to the person; the
-- player's own session still shows them their photo locally, but the public row starts bare.
-- A nickname collision between concurrent signups retries rather than failing the sign-in.
create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt int := 0;
begin
  loop
    begin
      insert into public.profiles (user_id, nickname)
      values (new.id, private.generate_nickname())
      on conflict (user_id) do nothing;
      return new;
    exception when unique_violation then
      attempt := attempt + 1;
      if attempt >= 4 then
        -- give up on beauty, never on the sign-in itself
        insert into public.profiles (user_id, nickname)
        values (new.id, 'Founder ' || substr(replace(new.id::text, '-', ''), 1, 8))
        on conflict (user_id) do nothing;
        return new;
      end if;
    end;
  end loop;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill: anyone who signed up before this script existed (the owner already has) gets a
-- profile now, by the same generator — and, like the trigger, no avatar.
insert into public.profiles (user_id, nickname)
select u.id, private.generate_nickname()
from auth.users u
where not exists (select 1 from public.profiles p where p.user_id = u.id)
on conflict (user_id) do nothing;

-- One-time scrub for rows written by the previous version of this script, which copied the
-- provider avatar: a Google avatar URL is stable per account and de-pseudonymizes the profile.
-- Targeted at provider-hosted URLs only, so a future deliberate custom avatar survives re-runs.
update public.profiles set avatar_url = null
 where avatar_url like 'https://lh3.googleusercontent.com%'
    or avatar_url like 'https://pbs.twimg.com%';

-- updated_at maintains itself; user_id and created_at are immutable however the update arrives.
create or replace function public.profiles_guard_update() returns trigger
language plpgsql
as $$
begin
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_before_update on public.profiles;
create trigger profiles_before_update
  before update on public.profiles
  for each row execute procedure public.profiles_guard_update();

-- ======================= 3. row level security =======================

alter table public.profiles enable row level security;

-- Profiles are public by nature — the lobby and the leaderboard will render them for everyone.
-- There is nothing sensitive IN the table to protect (that is the whole design), so read is open.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to anon, authenticated using (true);

-- Only you edit your row. Inserts happen only through the signup trigger (definer), deletes only
-- through the auth cascade — neither role gets either verb.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (nickname, avatar_url, achievements, bests, updated_at) on public.profiles to authenticated;

revoke all on function private.generate_nickname() from public, anon, authenticated;

-- ======================= 4. self-test =======================
-- The v6 rule: assert the attack is refused AND the honest path works, in the same run, for
-- every role that can reach the table. An exception rolls the fixtures back.

do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  nick_b text;
  failures text[] := '{}';
  n int;
begin
  -- Fixtures: two real auth.users rows, made as postgres, so the ACTUAL signup trigger fires.
  -- If this dashboard cannot write auth.users there is no honest way to exercise the trigger or
  -- the policies' auth.uid() behaviour — a half-simulation that inserts profiles directly would
  -- prove nothing the constraints don't already prove (and cannot even run: profiles.user_id
  -- references auth.users, so orphan fixtures violate the FK — the first version of this script
  -- had exactly that dead branch). So: skip LOUDLY, naming what was not proven.
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    values
      (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'selftest-a@profiles.test', '{"avatar_url": "https://example.com/a.png", "full_name": "REAL NAME MUST NOT APPEAR"}'::jsonb, now(), now()),
      (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'selftest-b@profiles.test', '{"picture": "http://insecure.example/b.png"}'::jsonb, now(), now());
  exception when others then
    raise notice 'profiles v1 self-test SKIPPED — this role cannot write auth.users (%). NOT proven on this run: the signup trigger, the no-metadata-copied rule, and the per-role policy matrix. The constraints and grants above are still installed.', sqlerrm;
    return;
  end;

  -- (1) the trigger made both profiles
  select count(*) into n from public.profiles where user_id in (ua, ub);
  if n <> 2 then failures := failures || format('SIGNUP TRIGGER DID NOT CREATE 2 PROFILES (n=%s)', n); end if;

  -- (2) the real name never reached the table
  if exists (select 1 from public.profiles where user_id = ua and nickname ilike '%REAL NAME%') then
    failures := failures || 'NICKNAME DERIVED FROM METADATA NAME';
  end if;

  -- (3) NOTHING was copied from provider metadata — the avatar included (both fixtures carry one)
  if exists (select 1 from public.profiles where user_id in (ua, ub) and avatar_url is not null) then
    failures := failures || 'PROVIDER METADATA REACHED THE PROFILE (avatar copied)';
  end if;

  select nickname into nick_b from public.profiles where user_id = ub;

  -- ======================= as anon =======================
  execute 'set local role anon';

  begin
    select count(*) into n from public.profiles where user_id in (ua, ub);
    if n <> 2 then failures := failures || 'ANON CANNOT READ PROFILES'; end if;
  exception when others then
    failures := failures || format('ANON READ FAILED: %s', sqlerrm);
  end;

  begin
    insert into public.profiles (user_id, nickname) values (gen_random_uuid(), 'Sneaky Insert 11');
    failures := failures || 'ANON INSERTED A PROFILE';
  exception when others then null;
  end;

  begin
    update public.profiles set nickname = 'Stolen Name 11' where user_id = ua;
    if found then failures := failures || 'ANON UPDATED A PROFILE'; end if;
  exception when others then null;
  end;

  begin
    delete from public.profiles where user_id = ua;
    if found then failures := failures || 'ANON DELETED A PROFILE'; end if;
  exception when others then null;
  end;

  -- ======================= as user A (signed in) =======================
  reset role;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);

  -- (8) honest rename works
  begin
    update public.profiles set nickname = 'Selftest Alpha 42' where user_id = ua;
    if not found then failures := failures || 'OWNER COULD NOT RENAME THEMSELVES'; end if;
  exception when others then
    failures := failures || format('OWNER RENAME FAILED: %s', sqlerrm);
  end;

  -- (9) honest badge + bests writes work, within their caps
  begin
    update public.profiles
       set achievements = '["unicorn", "first-blood"]'::jsonb,
           bests = '{"quick": {"score": 1000000, "weeks": 80, "ending": "acquired", "company": "Selftest Inc", "at": 1755800000}}'::jsonb
     where user_id = ua;
    if not found then failures := failures || 'OWNER COULD NOT WRITE BADGES/BESTS'; end if;
  exception when others then
    failures := failures || format('OWNER BADGES/BESTS WRITE FAILED: %s', sqlerrm);
  end;

  -- (10) another player's row is out of reach (the update silently matches zero rows)
  begin
    update public.profiles set nickname = 'Hijacked 99' where user_id = ub;
    if found then failures := failures || 'USER A UPDATED USER B''S PROFILE'; end if;
  exception when others then null;
  end;

  -- (11) identity columns are immutable even through an owner update
  begin
    update public.profiles set user_id = ub where user_id = ua;
    if exists (select 1 from public.profiles where user_id = ua and nickname = 'Selftest Alpha 42') then null;
    else failures := failures || 'USER_ID WAS REWRITTEN BY AN OWNER UPDATE'; end if;
  exception when others then null; -- a refusal is equally fine
  end;

  -- (12) malformed nicknames are refused
  begin
    update public.profiles set nickname = 'x' where user_id = ua;
    failures := failures || 'ONE-CHARACTER NICKNAME ACCEPTED';
  exception when others then null;
  end;
  begin
    update public.profiles set nickname = '<script>alert(1)</script>' where user_id = ua;
    failures := failures || 'MARKUP NICKNAME ACCEPTED';
  exception when others then null;
  end;

  -- (13) a taken nickname is refused, case-insensitively
  begin
    update public.profiles set nickname = upper(nick_b) where user_id = ua;
    failures := failures || 'NICKNAME COLLISION ACCEPTED';
  exception when unique_violation then null;
  when others then null;
  end;

  -- (13b) the doubled-space variant of a taken name is refused too — HTML collapses whitespace,
  -- so 'Quiet  Falcon 42' WEARS 'Quiet Falcon 42' on every screen
  begin
    update public.profiles set nickname = replace(nick_b, ' ', '  ') where user_id = ua;
    failures := failures || 'DOUBLED-SPACE IMPERSONATION ACCEPTED';
  exception when others then null;
  end;

  -- (13c) a signed-in player cannot INSERT a second profile or DELETE one — the header's
  -- 'neither role gets either verb', proven for this role and not just anon
  begin
    insert into public.profiles (user_id, nickname) values (gen_random_uuid(), 'Second Self 11');
    failures := failures || 'AUTHENTICATED INSERTED A PROFILE';
  exception when others then null;
  end;
  begin
    delete from public.profiles where user_id = ua;
    if found then failures := failures || 'AUTHENTICATED DELETED A PROFILE'; end if;
  exception when others then null;
  end;

  -- (14) oversize and mis-shaped blobs are refused
  begin
    update public.profiles set achievements = to_jsonb(array_fill('padding-padding-padding'::text, array[400])) where user_id = ua;
    failures := failures || 'OVERSIZE ACHIEVEMENTS ACCEPTED';
  exception when others then null;
  end;
  begin
    update public.profiles set achievements = '{"not": "an array"}'::jsonb where user_id = ua;
    failures := failures || 'NON-ARRAY ACHIEVEMENTS ACCEPTED';
  exception when others then null;
  end;
  begin
    update public.profiles set avatar_url = 'javascript:alert(1)' where user_id = ua;
    failures := failures || 'NON-HTTPS AVATAR UPDATE ACCEPTED';
  exception when others then null;
  end;

  -- ======================= verdict =======================
  reset role;
  -- fixtures out, whatever happened (auth cascade removes profiles when users were real)
  delete from public.profiles where user_id in (ua, ub);
  begin
    delete from auth.users where id in (ua, ub);
  exception when others then null;
  end;

  if array_length(failures, 1) is not null then
    raise exception E'profiles v1 self-test FAILED:\n  - %', array_to_string(failures, E'\n  - ');
  end if;
  raise notice 'profiles v1 self-test passed: the signup trigger creates bare pseudonymous profiles; anon reads but cannot write; owners rename and record within caps; hijack/impersonation (case AND whitespace)/markup/oversize all refused; provider metadata never enters the table';
end;
$$;
