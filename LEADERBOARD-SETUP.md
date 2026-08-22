# Daily leaderboard setup

1. Create a free project at https://supabase.com (any name, any region).
2. In the project: Settings → API → copy the "Project URL" and "anon public" key.
3. Paste both into `src/net/config.ts` (replacing the `YOUR-…` placeholders).
4. In the Supabase dashboard: SQL Editor → New query → paste `supabase/leaderboard-v6.sql` → Run.
   It creates the table *and* secures it, and it is safe to re-run. It checks its own work: a
   successful run prints `leaderboard v6 self-test passed`, and a failed one raises with a list
   of exactly which cases came out wrong.
5. Same editor, second query: paste `supabase/leaderboard-v7-proof.sql` → Run. Additive and
   idempotent; it adds the replay-proof columns (BACKLOG §3.1), so every submitted score carries
   the journal that proves it. Always AFTER v6, ideally in the same sitting.
6. Done — daily scores now submit and the global leaderboard appears automatically.
