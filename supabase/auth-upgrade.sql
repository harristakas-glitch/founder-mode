-- Social-login upgrade: signed-in players get their handle on the leaderboard.
-- Run this once in the Supabase SQL Editor (safe to re-run).
alter table public.daily_scores add column if not exists display_name text;
