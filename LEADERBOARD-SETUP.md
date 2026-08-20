# Daily leaderboard setup

1. Create a free project at https://supabase.com (any name, any region).
2. In the project: Settings → API → copy the "Project URL" and "anon public" key.
3. Paste both into `src/net/config.ts` (replacing the `YOUR-…` placeholders).
4. In the Supabase dashboard: SQL Editor → New query → paste `supabase/leaderboard-v6.sql` → Run.
   That is the only SQL file in the repo — it creates the table *and* secures it, and it is safe
   to re-run. It checks its own work: a successful run prints `leaderboard v6 self-test passed`,
   and a failed one raises with a list of exactly which cases came out wrong.
5. Done — daily scores now submit and the global leaderboard appears automatically.
