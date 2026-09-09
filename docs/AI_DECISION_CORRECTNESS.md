# AI Decision Correctness Pass (Phase 5)

This document covers the existing AI decision-making stack — `PersonalitySystem`,
`MemorySystem`, `GoalSystem`, `ActionScorer` (incl. `ScoringHelpers`), and
`DecisionEngine` — as it stands after the **AI DECISION CORRECTNESS PASS**.

This pass did **not** redesign the AI architecture, add a commitment/ambition
layer, add new personality/memory/diplomacy/military/economy systems, or touch
the Orchestrator/Command Index/GameState runtime/Supabase/frontend. It fixed
concrete bugs in how the *existing* scoring math represents the state it is
already supposed to evaluate, and documented a few things that turned out to
be non-bugs, placeholders, or out-of-scope simplifications rather than faking
fixes for them.

See also: `docs/CANONICAL_STATE_ARCHITECTURE.md` (canonical types/state) and
`docs/BATTLE_ENGINE_CORRECTNESS.md` (the battle resolver these AI estimates
must stay consistent with, but never call directly).

---

## 1. How AI evaluates military advantage (attack scoring)

`ActionScorer.scoreAttack()` calls `ScoringHelpers.estimateMilitaryAdvantage(attackerArmies, defenderTerritory, allArmies)`,
which calls `CombatPower.computeMilitaryAdvantageRatio()` — the same
power/probability math `BattleEngine` uses, but only as far as an
advantage ratio/score/risk triple, never a resolved outcome (see §8/§10).

**Bug fixed:** `estimateMilitaryAdvantage` used to ignore its `allArmies`
parameter entirely (`const defendingArmies: Army[] = [];`, with the
parameter itself named `_allArmies` to silence the unused-variable lint).
That meant an attack was always scored as if the target territory had **no**
defending field army — only its `garrison` counted. A target with a huge
army stationed on it could be scored as an easy attack.

**Fix:** `defendingArmies` is now derived from the state already available at
the call site — every army in `allArmies` whose `location` equals the target
territory's id:

```ts
const defendingArmies = Array.from(allArmies.values())
  .filter((a) => a.location === defenderTerritory.id);
```

This mirrors how `CombatPower.computeDefenderPower()` (used by `BattleEngine`
itself) combines garrison + stationed field armies, so the AI's *estimate*
of who defends a territory now matches who would *actually* defend it in a
real battle resolution. No new state was needed — `ActionContext.allArmies`
already contains every army in the game, keyed by id, with a `location`.

## 2. How local threat is calculated (defense scoring)

`ActionScorer.scoreDefend()` computes a `borderThreat` for each of my
territories, based on its hostile bordering territories.

**Bug fixed:** this used to be a flat `+15` per hostile bordering territory,
regardless of that territory's actual military strength. It could not tell
"a hostile neighbor with almost no military" apart from "a hostile neighbor
with a large army sitting on the border," and had no way to discount "a
hostile faction with a large *overall* military but nothing near this
particular border" either (it never looked at overall power at all — the old
formula was purely a neighbor *count*).

**Fix — local threat formula:**

```
for each hostile bordering territory N:
    localPower(N) = N.garrison * soldierValue
                  + sum(computeArmyPower(a) for a in allArmies where a.location === N.id)
    borderThreat += localPower(N) / 10
```

(`ScoringHelpers.computeLocalHostilePower(N, allArmies)` implements
`localPower(N)`.) The `/10` scale keeps a "typical" starting garrison
(~150, per `SAMPLE_MAP`) contributing ~15 points — the same order of
magnitude as the old flat constant — while a nearly-undefended border
contributes almost nothing and a heavily reinforced one contributes
proportionally more. `borderThreat` is still summed across all hostile
borders and capped via `Math.min(S.maxFactorWeight, borderThreat)`, unchanged.

Empire-wide `totalMilitaryPower` is deliberately **not** part of this
formula: a faction that is powerful overall but has nothing stationed near
this specific border is not a local threat to it.

`ScoringHelpers.evaluateThreat()` (an older, unused-by-`scoreDefend` helper
that mixes a border term with `targetFaction.totalMilitaryPower /
self.totalMilitaryPower`) and `ScoringHelpers.computeTerritoryMilitaryDefense()`
(unused, and its `garrisonOnly` parameter was a no-op ternary) are left in
place — both are documented in code as unused/limited, not wired into new
scoring, and not a source of any current bad decision since nothing calls
them.

## 3. How expansion strength is evaluated

`ActionScorer.scoreExpand()` compares "my strength" against an unclaimed
target territory's garrison.

**Bug fixed:** "my strength" used to be `ctx.self.totalMilitaryPower` — every
army and every garrison the faction owns, anywhere on the map. A faction with
a huge army on a distant front would look like it could trivially seize an
unclaimed territory on the opposite border, even though nothing it actually
had nearby could act on it.

**Fix — local/usable strength:** there is no troop-movement model in this
codebase (armies only have a static `location`), so "usable" strength for a
given expansion target is defined the same way `scoreAttack` already defines
usable attacking strength: field armies stationed in a territory that
borders the target, plus the garrisons of my own territories that border the
target (a garrison can plausibly push into adjacent unclaimed land):

```
myLocalPower = sum(computeArmyPower(a) for a in myArmies
                    where a.location borders targetTerr)
             + sum(t.garrison * soldierValue for t in myTerritories
                    bordering targetTerr)
advantage = localOpposition == 0 ? 100
          : myLocalPower <= 0 ? -maxFactorWeight
          : log2(myLocalPower / localOpposition) * 25
```

**Documented limitation:** armies/garrisons that are not adjacent to the
target contribute nothing, even if they could in principle reach it over
several turns — this codebase has no turn-based movement/logistics model to
determine that, and inventing one is out of scope for this pass. This is a
known simplification, not a claim that distant forces "could never help."

`cli.ts`'s `simulateDecisionOutcomes()` EXPAND execution branch still checks
`ws.snapshot.totalMilitaryPower` (empire-wide) when deciding whether an
EXPAND actually succeeds. That is a separate, pre-existing simplification in
the CLI's turn-simulation demo harness (not the `ActionScorer`/`DecisionEngine`
AI layer this pass covers) and was intentionally left untouched — flagged
here rather than expanded into scope. See §9.

## 4. How reinforcement affordability is determined

**Bug fixed:** `ActionScorer.scoreReinforce()` used to check
`resources.gold > 500` and `resources.food > 300` — thresholds with no
relationship to the actual cost of a REINFORCE action, which
`src/simulation/cli.ts`'s `simulateDecisionOutcomes()` charged as flat inline
literals (`250` gold, `150` food, for `+100` garrison). Scoring and execution
disagreed about what REINFORCE costs.

**Fix:** the CLI's literals were moved into a new, single authoritative
config, `BALANCE.economy.reinforcementCost = { gold: 250, food: 150,
garrisonGain: 100 }` (values unchanged — not rebalanced, just relocated).
Both call sites now read from it:

* `ActionScorer.scoreReinforce()`: `goldOK = resources.gold >= RC.gold`,
  `foodOK = resources.food >= RC.food`.
* `cli.ts`'s REINFORCE execution: destructures `{ gold, food, garrisonGain }`
  from the same constant instead of inline numbers.

The older, still-present `BALANCE.economy.reinforcementCostPerSoldier`
(`{ gold: 5, food: 3 }`) remains — and remains unused by any engine, as it
was before this pass — with a comment clarifying it is not the authoritative
REINFORCE cost, to avoid a future reader assuming it is wired up somewhere.

## 5. How trade safety is evaluated

`ActionScorer.scoreTrade()` computes `mySurplus[k]` per resource from
`resources[k] / (income[k] * 12)` (a genuine multi-turn safety-reserve
figure — >2 "years" of banked supply at current income before any surplus is
recognized at all, scaling up to 1.0 by ~5 years).

**Bug fixed:** a second bonus (`theirScarcity[k] > 0.5 && scarcity[k] < 0.2
→ +20 flat`) rewarded trading purely because *my current need* for a
resource (via `evaluateResourceNeed`'s separate, independently-tunable
months-of-supply formula) was low — without referencing `mySurplus[k]` at
all. Under today's specific constants this condition happens to be
mathematically equivalent to `mySurplus[k]` being truthy (both reduce to
`resources[k] > 24 * income[k]`), so it was not visibly wrong today, but:

* it relied on a coincidence between two independently-tunable magic numbers
  (the `10` in `evaluateResourceNeed` and the `12`/`2`/`0.2` in `scoreTrade`)
  rather than an explicit safety check — a future balance tweak to either
  formula could silently break the coincidence and reopen exactly the "they
  need X, I don't need X" hole the audit described; and
* it was a **flat** `+20` regardless of how deep the surplus was — a
  razor-thin sliver of surplus (`mySurplus[k] ≈ 0.0003`) got the same bonus
  as a maxed-out one (`mySurplus[k] = 1`).

**Fix:** the bonus now requires `mySurplus[k]` explicitly and scales by its
magnitude, exactly like the complementarity bonus just above it:

```ts
if (theirScarcity[k] > 0.5 && mySurplus[k]) { matchScore += 20 * mySurplus[k]; }
```

A razor-thin surplus now contributes almost nothing; a deep, multi-year
surplus contributes close to the old flat bonus; no surplus at all
contributes nothing, no matter how badly the partner needs the resource.
Regression tests in `tests/run.ts` ("trade respects surplus depth...")
exercise all three cases with concrete numbers.

## 6. How strategic goals identify targets

Goals are created **only** by `GoalSystem.generateInitialGoals()` — `addGoal()`
has no other caller anywhere in this repo. That method only receives
`(personalityType, factionId, currentTurn, rng)`; it has no visibility into
other factions, territories, or diplomacy, so it can only ever create goals
whose `targetFaction`/`targetTerritory`/`targetRegion` are `null` unless a
future caller is changed to supply real ones.

**Bug fixed — `control_region`:** `checkAlignment()`'s `control_region` case
used to derive a "region" via `terr.id.split('_')[0]`. This is the exact bug
named in the audit: `MapEngine`-generated ids like `t_23_mis` split to the
literal string `t`; hand-authored `SAMPLE_MAP` ids like `north_valley` split
to the arbitrary token `north`. Neither is a real region id. There is, in
fact, no region concept on the canonical `Territory` type at all — region
membership only exists one layer up, in `MapWorldState.regions`, which
`GoalSystem`/`ActionContext` never receive — so this could not be made
*correct* without adding a `Territory.regionId`-equivalent field, an actual
data-model change out of scope for a bug-fix pass. The broken id-parsing
branch (and the `goal.targetRegion`-gated ATTACK/EXPAND alignment it fed,
which was separately dead anyway — see below) was **removed**, not
"fixed" with a fabricated region derivation. `control_region`'s
unconditional `BUILD` fallback (fortify wherever the goal targets) is
unchanged and remains its only currently-functional alignment path.

**Documented placeholders — `destroy_rival` / `form_alliance`:** both cases
gate all their logic behind `if (goal.targetFaction)`. Since
`generateInitialGoals` never sets `targetFaction` (it has no faction
context to pick one from), every `destroy_rival`/`form_alliance` goal
actually generated today has `targetFaction: null`, making both cases
permanently dead code in practice — the goal exists (a faction can be seen
to "have" it) but it never contributes a score bonus/penalty for any action.
This is documented in code as an intentional placeholder rather than
"fixed" by inventing a target-selection heuristic, per this pass's explicit
instruction not to fabricate targets or add goal-planning sophistication. A
future pass that wires goal generation up to the rest of the faction set (or
adds dynamic goal creation via `addGoal()`) can set a real `targetFaction`.

**Documented as functional-but-unused — `protect_territory` / `break_siege`:**
both cases' alignment logic is correct and doesn't depend on any of the
buggy/always-null patterns above, but neither goal type is ever generated by
`generateInitialGoals` for any personality today — so no faction currently
holds one. Not a bug; noted so a future pass adding dynamic goal creation
(sieges, capital defense, etc.) knows the alignment logic already works and
only goal *creation* is missing.

**Functional today, no changes needed:** `expand_to_resources`,
`dominant_faction`, `prepare_for_invasion`, and `economic_growth` don't
depend on a target being set (or handle a missing one gracefully) and were
already correct.

## 7. How personality modifiers affect action scoring

Audited `PERSONALITY_PRESETS` (in `PersonalitySystem.ts`) against
`PersonalityType` and `ACTION_PERSONALITY_BIAS` against `ActionType` (both in
`src/types/index.ts`):

* All 6 `PersonalityType` values (`defensive`, `aggressive`, `expansionist`,
  `opportunistic`, `diplomatic`, `economic`) have a preset, each with every
  one of the 10 `Personality` trait fields present and in `[0, 1]`.
* All 13 `ActionType` values have an `ACTION_PERSONALITY_BIAS` entry
  pointing at a real trait key. `RETREAT`'s battle-unrelated *strategic*
  action bias (`defensiveness`) is untouched — the removals in Phase 4 were
  to `BattleEventType`'s `retreat` literal and `BALANCE.combat.retreat`,
  never to the `ActionType` union, so there was nothing obsolete to clean up
  here.
* `PersonalitySystem.getActionBias/getRiskModifier/getRevengeModifier/getDiplomaticTrustModifier`
  are applied consistently everywhere `ActionScorer` scores an action (every
  `scoreX()` method starts from `baseScored()`, which applies personality
  bias + randomness uniformly).

No dead or invalid personality references were found; regression tests
(`tests/run.ts`, "personality reference sanity") assert both invariants
(every action has a finite bias for every preset; every preset's traits are
all in `[0, 1]`) so a future accidental preset/action-type drift is caught.

## 8. What `DecisionEngine` does and does not own

**Owns:** turning a `ScoredAction[]` (from `ActionScorer`) into one `Decision`
per warlord per turn, via `selectWithRandomness()` — weighting near-ties by a
normalized/exponentiated score and picking among them with a seeded RNG, or
picking a lone leader deterministically when there is no meaningful tie.

**Bug fixed (not a redesign):** the weighting/selection *math* is unchanged
and was already functioning as designed — near-ties (within
`tiebreakerRandomness * spread` of the top score) get meaningful seeded
random variation; a clear leader is picked deterministically. That is left
alone per this pass's instructions. The bug was in how the result was
reported: `candidates` were built by mapping the sorted list into brand-new
`{ ...s, weight }` object copies, `selected` was drawn from those copies, and
`alternatives = sorted.filter((s) => s !== selected)` compared by object
*reference*. Since `selected` was never reference-identical to anything in
the original `sorted` array (it was always a fresh copy), the filter never
removed anything — `Decision.topAlternatives` (and the verbose CLI's
"Alternatives:" list) **always included the very action that had just been
selected**, displayed as if it were a distinct alternative. Fixed by
tracking the chosen *index* into `sorted` instead of relying on copied-object
identity; the selection weights/probabilities themselves are byte-for-byte
the same formula as before. Regression test: "topAlternatives never includes
the action that was actually selected."

**Static-environment repetition (audited, not changed):** repeatedly calling
`decide()` against an *unchanged* state can legitimately keep returning the
same action (e.g. repeated `EXPAND` if nothing in the state ever updates to
reflect a previous decision). This is not a `DecisionEngine` bug — each call
still draws a fresh, turn-salted RNG fork (`hashFactionId(id) ^ turn`), so
tie-breaking randomness is not artificially frozen — it is a consequence of
scoring the same inputs and getting the same (correct) answer. Per this
pass's explicit instruction, no artificial memory/cooldown was added to
suppress this; `scoreWait()`'s existing consecutive-WAIT penalty is the only
repetition-aware logic in the scorer and was left as-is. Determinism itself
is covered by a regression test ("DecisionEngine.decide is deterministic for
a fixed seed given identical state").

**Does not own:** resolving what actually *happens* when an action is taken
(battle outcomes, territory capture, resource transfer) — see §10.

## 9. What remains intentionally deferred / out of scope

* **Region-aware `control_region` goals** — needs a real region concept
  reachable from `Territory`/`ActionContext` (e.g. a `regionId` field, or
  passing `MapWorldState.regions` through); not added this pass (§6).
* **Dynamic/targeted goal creation** for `destroy_rival`, `form_alliance`,
  `protect_territory`, `break_siege` — needs `generateInitialGoals` (or a new
  caller of `addGoal()`) to have visibility into other factions/territories;
  not added this pass, to avoid inventing goal-planning logic (§6).
* **`cli.ts`'s EXPAND execution** still uses empire-wide `totalMilitaryPower`
  to decide whether an expansion attempt succeeds, inconsistent in spirit
  with the now-local `ActionScorer.scoreExpand()` estimate. `cli.ts`'s
  `simulateDecisionOutcomes()` is a simple demo/turn-simulation harness, not
  part of the `ActionScorer`/`DecisionEngine` AI layer this pass's problem
  list named, and was left untouched rather than expanding scope (§3).
* **`cli.ts`'s ATTACK execution never calls `BattleEngine.resolve()` at
  all** (it only updates diplomacy/memory) — a pre-existing integration gap
  first noted in the Phase 4 (Battle Engine Correctness) pass. Still not a
  duplicate battle resolver (there still is no second resolution model — see
  §10), just a missing wire-up in the demo harness. Not fixed here; still out
  of scope for an AI-scoring-focused pass.
* **Troop movement / logistics** — `scoreExpand`'s "local strength" fix
  explicitly does not model whether a distant army could redeploy in time to
  help; this is a documented simplification, not a claim of correctness
  about movement (§3).
* **No new AI systems** — no commitments, ambition, long-term strategic
  planning overhaul, new personality/memory/diplomacy/military/economy
  systems, continuous world, Orchestrator, Command Index, GameState runtime,
  Supabase, or frontend work was done in this pass.

## 10. `BattleEngine` is the sole authoritative battle resolver

`ActionScorer`/`ScoringHelpers` only ever call into `CombatPower.ts`'s
*estimate* helpers (`computeMilitaryAdvantageRatio`, which itself calls
`computeAttackerPower`/`computeDefenderPower`/`computeWinProbability`) to
produce a `{ advantage, ratio, risk }` triple for scoring purposes. These
functions compute power/probability only — no casualties, no winner, no
territory-capture decision. `BattleEngine.resolve()` (in
`src/battle/BattleEngine.ts`) is the **only** place a battle is actually
resolved into a winner, casualties, and a territory outcome.

This boundary was audited and found already correct: nothing in
`ActionScorer.ts` imports, instantiates, or calls `BattleEngine`. A
regression test (`tests/run.ts`, "AI does not resolve battles itself")
statically checks `ActionScorer.ts` for any `BattleEngine` import/
instantiation/`.resolve(` call, so a future change that starts duplicating
battle resolution inside AI scoring will fail CI rather than silently
introducing a second, divergent battle model.
