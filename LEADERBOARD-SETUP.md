# Daily leaderboard setup

1. Create a free project at https://supabase.com (any name, any region).
2. In the project: Settings → API → copy the "Project URL" and "anon public" key.
3. Paste both into `src/net/config.ts` (replacing the `YOUR-…` placeholders).
4. In the Supabase dashboard: SQL Editor → New query → paste `supabase/leaderboard-v6.sql` → Run.
   That is the one to run for the leaderboard, and the only one you need for anything on this
   page — it creates the table *and* secures it, and it is safe to re-run. It checks its own
   work: a successful run prints `leaderboard v6 self-test passed`, and a failed one raises with
   a list of exactly which cases came out wrong.
5. Done — daily scores now submit and the global leaderboard appears automatically.

---

There is now a **second, optional** script in `supabase/`: `run-journals-v1.sql`, which creates the
table product analytics uploads finished and abandoned runs into. It is unrelated to the
leaderboard, it is not needed for anything above, and skipping it costs nothing — the client's
upload simply refuses. Run `leaderboard-v6.sql` first regardless.

`docs/analytics.md` is the whole story: what is collected, what is not, and the one line that
switches it on. Analytics ships **off**.
