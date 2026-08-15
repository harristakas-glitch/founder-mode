#!/bin/bash
# Mutation harness for test/rival-aggression.test.ts. Breaks one thing in src/game/engine.ts at a
# time, re-runs the test, and reports which assertions caught it. Restores the file afterwards.
#
# Usage: bash scripts/mutate-rival-aggression.sh
set -u
cd "$(dirname "$0")/.."
ENGINE=src/game/engine.ts
BACKUP=$(mktemp)
cp "$ENGINE" "$BACKUP"
restore() { cp "$BACKUP" "$ENGINE"; }
trap restore EXIT

run_mutation() {
  local name="$1"; shift
  restore
  "$@" || { echo "!! $name — sed found nothing, mutation did not apply"; return; }
  local out
  out=$(npx tsx test/rival-aggression.test.ts 2>&1)
  if echo "$out" | grep -q "ALL PASS"; then
    echo "SURVIVED  $name"
  else
    local n
    n=$(echo "$out" | grep -c "✗")
    echo "killed($n)  $name"
    echo "$out" | grep "✗" | sed 's/^/            /'
  fi
}

# --- the gate ---
run_mutation "gate: rivals act regardless of the capability" \
  perl -0pi -e "s/if \(r\.alive && can\(s, 'rivalAggression'\)\) rivalAggressionStep/if (r.alive) rivalAggressionStep/" "$ENGINE"
run_mutation "gate: rivals never act at all" \
  perl -0pi -e "s/if \(r\.alive && can\(s, 'rivalAggression'\)\) rivalAggressionStep/if (false) rivalAggressionStep/" "$ENGINE"
run_mutation "gate: stance ignores the capability" \
  perl -0pi -e "s/if \(!r\.alive \|\| !can\(s, 'rivalAggression'\)\) return calm/if (!r.alive) return calm/" "$ENGINE"

# --- the notice ---
run_mutation "notice: strike on the very week they are announced" \
  perl -0pi -e "s/if \(s\.week < r\.hostileSince \+ RIVAL_AGGRO_NOTICE\) return/if (false) return/" "$ENGINE"
run_mutation "notice: never announce, just hit" \
  perl -0pi -e "s/if \(r\.hostileSince === undefined\) \{/if (false) {/" "$ENGINE"
run_mutation "notice: shorten the notice to zero" \
  perl -0pi -e "s/export const RIVAL_AGGRO_NOTICE = 1/export const RIVAL_AGGRO_NOTICE = 0/" "$ENGINE"

# --- answerability ---
run_mutation "answer: shield locked to Arena again" \
  perl -0pi -e "s/return can\(s, 'pvpActions'\) \|\| can\(s, 'rivalAggression'\)/return can(s, 'pvpActions')/" "$ENGINE"
run_mutation "answer: a counter-raid mints users instead of moving them" \
  perl -0pi -e "s/if \(kind === 'raid'\) r\.users = Math\.max\(0, r\.users - Math\.max\(0, s\.users - before\)\)/if (kind === 'raid') r.users = r.users/" "$ENGINE"
run_mutation "answer: the shield stops deflecting" \
  perl -0pi -e "s/if \(\(s\.flags\.shield \?\? 0\) > 0\) \{\n    \/\/ the retainer runs/if (false) {\n    \/\/ the retainer runs/" "$ENGINE"

# --- situational, not a timer ---
run_mutation "situational: raid ignores whether you are growing" \
  perl -0pi -e "s/if \(share >= RIVAL_RAID_SHARE_FLOOR && growth >= RIVAL_RAID_GROWTH\)/if (share >= RIVAL_RAID_SHARE_FLOOR)/" "$ENGINE"
run_mutation "situational: raid ignores their grip on the market" \
  perl -0pi -e "s/if \(share >= RIVAL_RAID_SHARE_FLOOR && growth >= RIVAL_RAID_GROWTH\)/if (growth >= RIVAL_RAID_GROWTH)/" "$ENGINE"
run_mutation "situational: smear back to OR (everyone hostile always)" \
  perl -0pi -e "s/if \(ahead >= RIVAL_SMEAR_AHEAD && s\.hype >= RIVAL_SMEAR_HYPE\)/if (ahead >= RIVAL_SMEAR_AHEAD || s.hype >= RIVAL_SMEAR_HYPE)/" "$ENGINE"
run_mutation "situational: poach without a team worth poaching" \
  perl -0pi -e "s/if \(r\.stage > STAGES\.indexOf\(s\.stage\) \+ 1 && s\.employees\.length >= 4\)/if (r.stage > STAGES.indexOf(s.stage) + 1)/" "$ENGINE"
run_mutation "situational: no grace period" \
  perl -0pi -e "s/export const RIVAL_AGGRO_MIN_WEEK = 12/export const RIVAL_AGGRO_MIN_WEEK = 0/" "$ENGINE"
run_mutation "situational: no visibility floor" \
  perl -0pi -e "s/export const RIVAL_AGGRO_MIN_USERS = 120/export const RIVAL_AGGRO_MIN_USERS = 0/" "$ENGINE"
run_mutation "situational: dead rivals keep attacking" \
  perl -0pi -e "s/if \(!r\.alive \|\| !can\(s, 'rivalAggression'\)\) return calm/if (!can(s, 'rivalAggression')) return calm/" "$ENGINE"

# --- paid for ---
run_mutation "cost: attacking is free (momentum)" \
  perl -0pi -e "s/export const RIVAL_ATTACK_MOMENTUM_COST = 0\.94/export const RIVAL_ATTACK_MOMENTUM_COST = 1/" "$ENGINE"
run_mutation "cost: attacking is free (product)" \
  perl -0pi -e "s/export const RIVAL_ATTACK_PRODUCT_COST = 1\.6/export const RIVAL_ATTACK_PRODUCT_COST = 0/" "$ENGINE"
run_mutation "cost: no cooldown between campaigns" \
  perl -0pi -e "s/if \(s\.week < \(r\.aggroCooldown \?\? 0\)\) return/if (false) return/" "$ENGINE"

# --- scaling ---
run_mutation "scale: leverage is flat" \
  perl -0pi -e "s/return RIVAL_RAID_LEVERAGE_MIN \+ \(RIVAL_RAID_LEVERAGE_MAX - RIVAL_RAID_LEVERAGE_MIN\) \* rivalGrip\(share\)/return 1/" "$ENGINE"
run_mutation "scale: leverage inverted (big rivals punch soft again)" \
  perl -0pi -e "s/return RIVAL_RAID_LEVERAGE_MIN \+ \(RIVAL_RAID_LEVERAGE_MAX - RIVAL_RAID_LEVERAGE_MIN\) \* rivalGrip\(share\)/return RIVAL_RAID_LEVERAGE_MAX - (RIVAL_RAID_LEVERAGE_MAX - RIVAL_RAID_LEVERAGE_MIN) * rivalGrip(share)/" "$ENGINE"
run_mutation "scale: frequency does not ramp" \
  perl -0pi -e "s/return Math\.round\(RIVAL_AGGRO_COOLDOWN - \(RIVAL_AGGRO_COOLDOWN - RIVAL_AGGRO_COOLDOWN_MIN\) \* rivalGrip\(share\)\)/return RIVAL_AGGRO_COOLDOWN/" "$ENGINE"
run_mutation "scale: the magnitude multiplier is dropped on the victim's side" \
  perl -0pi -e "s/const lost = Math\.round\(raidMagnitude\(s\.users\) \* scale\)/const lost = raidMagnitude(s.users)/" "$ENGINE"
run_mutation "scale: share measured against the wrong denominator" \
  perl -0pi -e "s/return clamp\(r\.users \/ Math\.max\(1, effectiveTam\(s\)\), 0, 1\)/return clamp(r.users \/ Math.max(1, s.users), 0, 1)/" "$ENGINE"

# --- legibility ---
run_mutation "legible: the hit no longer says why" \
  perl -0pi -e "s/body: opts\.why \? \`\\\$\{opts\.why\}\\\\n\\\\n\\\$\{what\}\` : what/body: what/" "$ENGINE"
run_mutation "legible: the attack message loses its metadata" \
  perl -0pi -e "s/meta: \{ rivalAttack: kind, rivalName: fromCompany \},\n    title: \`\\\$\{def\.emoji\}/title: \`\\\$\{def.emoji}/" "$ENGINE"
run_mutation "legible: deflections are not marked as such" \
  perl -0pi -e "s/meta: \{ rivalAttack: kind, rivalName: fromCompany, deflected: true \},/meta: { rivalName: fromCompany },/" "$ENGINE"
run_mutation "legible: hostileRivals reports nobody" \
  perl -0pi -e "s/return s\.rivals\.filter\(\(r\) => r\.alive && rivalStance\(s, r\)\.attack !== null\)/return []/" "$ENGINE"

restore
echo "--- engine restored ---"
git diff --stat "$ENGINE"
