-- leaderboard v7 — the proof columns. ADDITIVE ONLY; run AFTER leaderboard-v6.sql.
--
-- WHY THIS EXISTS (BACKLOG §3.1): the determinism work made score cheating detectable — a run is
-- exactly reproducible from its config plus its ordered action log, and `verifyRun` (src/game/
-- replay.ts) replays a submission and compares an end-state fingerprint. The client has built and
-- locally stored that proof since replayProof.ts landed. The ONLY missing piece was somewhere to
-- put it: without these columns a player can verify their own run and nobody else can check it,
-- so the leaderboard displays unverified numbers.
--
-- WHAT THIS DOES AND DOES NOT CLAIM. Carrying the proof does not verify anything by itself —
-- verification happens when a CLIENT (or a future edge function) pulls a row and replays it.
-- These columns make every submission auditable by anyone; they do not make the database an
-- authority. That honest framing is why the columns are nullable: a legacy run without a journal
-- is still a legal submission, it simply shows as unverified, exactly as it does today.
--
-- Idempotent like every script in this directory: `if not exists` throughout, safe to re-run.

alter table public.daily_scores add column if not exists fingerprint text;
alter table public.daily_scores add column if not exists journal jsonb;

-- A hostile client could otherwise use the journal column as free blob storage. 256 KB holds a
-- 104-week run's action log with an order of magnitude to spare (measured proofs run 5-40 KB);
-- anything larger is not a game journal.
alter table public.daily_scores drop constraint if exists daily_scores_journal_size;
alter table public.daily_scores
  add constraint daily_scores_journal_size check (
    journal is null or pg_column_size(journal) < 262144
  );

-- The fingerprint is a hash rendered as text; cap it so it cannot be abused either.
alter table public.daily_scores drop constraint if exists daily_scores_fingerprint_size;
alter table public.daily_scores
  add constraint daily_scores_fingerprint_size check (
    fingerprint is null or char_length(fingerprint) <= 64
  );

-- No policy changes: v6's insert/select policies already cover whole-row access, and the columns
-- are written by the same insert path. Nothing to grant, nothing to revoke.
