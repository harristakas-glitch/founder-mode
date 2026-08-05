# Daily leaderboard setup

1. Create a free project at https://supabase.com (any name, any region).
2. In the project: Settings → API → copy the "Project URL" and "anon public" key.
3. Paste both into `src/net/config.ts` (replacing the `YOUR-…` placeholders).
4. In the Supabase dashboard: SQL Editor → New query → paste `supabase/leaderboard.sql` → Run.
5. Done — daily scores now submit and the global leaderboard appears automatically.
