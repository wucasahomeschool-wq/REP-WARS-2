# Battle Engine Correctness — Phase 4

This document describes the **current, corrected** behavior of `BattleEngine`
after the Battle Engine Correctness Pass. It does not describe a redesign —
the combat formula, unit strengths, and general shape of the resolver are
unchanged from before this pass. What changed is internal *consistency*:
the no-retreat rule is now actually enforced, siege-engine casualties are no
longer mixed into troop casualty totals, and several dead/contradictory
fields were removed.

Scope of this pass: `src/battle/BattleEngine.ts`, `src/battle/CombatPower.ts`,
the shared battle literal-union types in `src/types/index.ts`, the
`combat.retreat` block in `src/constants/balance.ts`, and the battle
tests/docs. No other engine (map, events, AI decision-making, orchestration,
economy) was touched.

## 1. Current battle model

`BattleEngine.resolve(input: BattleInput): BattleResult` is a pure function:

1. Compute attacker/defender **effective power** (`CombatPower.ts`).
2. Compute attacker win probability from the two power values.
3. Draw one seeded random roll; compare it to the win probability to decide
   the winner.
4. Compute casualty rates for the winner and loser and split them across
   unit categories.
5. Classify the outcome (decisive / narrow / pyrrhic victory, or stalemate).
6. Decide territory capture (attacker-win-only, gated on relative advantage
   and remaining attacker strength).
7. Assemble a fully-detailed `BattleResult` (per-side breakdowns, narrative
   log, summary, raw calculation numbers).

Nothing here was redesigned; steps 1–3 and 6 use the same formulas as
before this pass. Step 4 (casualties) and the loser's fate are what changed
— see §4–6.

## 2. What constitutes combat power

Unchanged. From `CombatPower.ts`:

```
rawPower   = soldiers·1 + knights·4 + siegeEngines·6 [+ garrison·1 for defender]
effective  = rawPower × quality × moraleMultiplier × defenseBonus
```

`defenseBonus` is `1.0` for the attacker and `terrain × fortification ×
capital` for the defender (`terrainAndFortToDefenseBonus`). Quality and
morale multipliers come from `BALANCE.combat`.

## 3. How win probability is calculated

Unchanged: `computeWinProbability(a, d) = a / (a + d)` (both floored to a
tiny epsilon to avoid division by zero). This is a simple, explainable
model: equal power ⇒ 50/50 odds; probability is always in `(0, 1)`; more
attacker power (holding defender power fixed) strictly increases attacker
win probability, and vice versa for defender power. See the regression
tests in `tests/run.ts` ("probability bounds & monotonicity").

## 4. How casualties are calculated (and the no-retreat fix)

Both sides get a casualty **rate** applied uniformly across their own unit
categories via `splitCasualties(unitBreakdown, rate)`
(`Math.round(count × rate)`, capped at `count`, so a category can never lose
more than it had).

Before this pass, the rate for the *loser* was a graduated value
(`loserMinRate`..`loserMaxRate`, i.e. 15%–98%) — the same "everyone loses a
fraction of their force" model used for the winner, just with a higher
range. That directly contradicted the no-retreat rule: a "decisively
defeated" army could still end the battle with ~2%–85% of its troops
intact, and the engine additionally computed `retreated` /
`retreatSurvivorsPct` fields implying those survivors *escaped*.

**Fix:** the losing side's casualty rate is now forced to `1.0` (100%,
every unit category) whenever there is an actual winner and loser. The
winner still uses the original graduated `winnerMinRate`..`winnerMaxRate`
(0.5%–25%) model, unchanged. The only case that keeps the old graduated
loser-rate model is the internal `isStalemate` branch (see §8 — practically
unreachable, and there is no "loser" there by definition).

Net effect: **the losing side of a real battle now always ends with 0
remaining troops and 0 remaining siege engines.** The winning side keeps
its original, unchanged partial-casualty behavior.

## 5. How siege units are accounted for

Siege engines are tracked with their own casualty count and their own rate,
**separate from the troop aggregate**:

- `BattleSideBreakdown.initialTroops` / `remainingTroops`: soldiers + knights
  (+ garrison for the defender). Excludes siege engines. Unchanged in
  meaning from before this pass.
- `BattleSideBreakdown.initialSiegeEngines` / `remainingSiegeEngines`: **new**
  top-level fields, siege-only, symmetric with the troop fields above.
- `CasualtyBreakdown.total` / `casualtyRate`: troop-only casualties/rate
  (soldiers + knights + garrison). **Previously this mixed in siege-engine
  casualties while `initialTroops`/`remainingTroops` excluded them** — e.g. 10
  soldiers + 100 siege engines could report `total: 37` casualties against
  `initialTroops: 10`, and a `casualtyRate` over 100%. That bug is fixed by
  simply excluding siege from `total`/`casualtyRate`, matching what
  `initialTroops`/`remainingTroops` already excluded.
- `CasualtyBreakdown.siegeEngines` / `siegeCasualtyRate`: siege-only
  casualties/rate, computed against the siege-only denominator.

Both categories still lose at the *same underlying rate* (siege engines are
not mechanically special — they just get their own clearly-named aggregate
fields instead of being folded into the troop aggregate). This satisfies
the invariant `remaining + casualties = initial` independently for troops
and for siege engines, for both sides, in every battle — see the "Result
arithmetic is consistent" regression test.

## 6. What happens to the losing army (no-retreat rule)

**Armies do not retreat.** The side that loses a resolved battle (i.e.
`winner !== 'draw'`) is eliminated:

- `remainingTroops === 0` and `remainingSiegeEngines === 0` for the loser.
- The defender's garrison is included in this elimination when the
  defender loses (`remaining.garrison === 0`).
- This holds regardless of whether the win was decisive, narrow, or
  pyrrhic — the margin only affects the *winner's* casualties, not whether
  the loser is eliminated.

Removed as part of this fix (all were either genuinely dead code or
directly contradicted the rule):

| Removed | Was |
|---|---|
| `BattleSideBreakdown.retreated` | Boolean flag implying the losing side partially escaped. |
| `BattleSideBreakdown.retreatSurvivorsPct` | "% of survivors that escape" for a retreating side. |
| `retreatSurvival()` helper | Computed the above from morale/cavalry. |
| `BALANCE.combat.retreat.*` | Config block (`baseSurvivalRate`, `cavalryBoostRetreat`, etc.) that fed the helper above. |
| `TerritoryOutcome.retreat_required` | Never produced by the resolver (dead) — and retreat-flavored. |
| `TerritoryOutcome.surrendered` | Never produced by the resolver as a `territoryOutcome` value (dead) — distinct from the still-used `defenderSurrendered` boolean, see below. |
| `BattleEventType.retreat` | Never emitted by the resolver (dead) — retreat-flavored. |
| `BattleOutcomeType.mutual_heavy_losses` | Never produced — the if/else chain has no branch that assigns it. |

`BattleSideBreakdown.routed` is **kept** — it is a narrative flavor flag for
the losing side of a *decisive* victory and does not imply any surviving
remnant (it never did; the confusion was only in `retreated`/
`retreatSurvivorsPct`, which are gone). Narrative event text that used to
say the loser "flees the field" / "is driven off" was reworded to
"routed and annihilated" / "shattered and destroyed" to match elimination
instead of escape.

This is unrelated to the separate, still-supported `RETREAT` **strategic
action** in `ActionScorer`/`GoalSystem`/`ACTION_NAMES` — that's a
pre-battle army repositioning decision made by the AI layer, not a
post-battle survival mechanic, and this pass does not touch it.

## 7. Territory capture behavior

Unchanged mechanics: on attacker victory, territory is `captured` only if
`relativeAdvantage >= neededAdvantage` (10%, or 25% for a capital) **and**
the attacker retains at least 5% of its initial troop count
(`captureMinAttackerRemainingRatio`). Otherwise it's `contested` (attacker
won the field but couldn't secure the territory). On defender victory,
territory is `unchanged`.

`defenderSurrendered` used to be an independent probabilistic check
(`totalDefenderCasualties / totalDefenderInitial >= 0.9`) gating a
"surrender" narrative event. Since the defender (as the loser) is now
*always* 100% eliminated whenever territory is captured, that 90%
threshold is trivially always true — it's simplified to a direct alias for
"territory was captured", kept as its own field/event for API stability and
narrative flavor. It never contradicts `territoryOutcome`.

Capture and elimination are independent facts: the loser is eliminated
whenever there's a winner/loser, **regardless** of whether the winner
manages to actually capture the territory (a `contested` outcome still
means the defender's army was wiped out — they just didn't hold enough
ground/strength to flip ownership).

## 8. BattleResult authoritative fields

- `winner` / `loser`: `'attacker' | 'defender' | 'draw'`. `'draw'` only
  occurs via the `isStalemate` branch, which requires the two sides'
  effective power to be **exactly** equal (`winProb === 0.5` in floating
  point) *and* the RNG roll to land within `1e-9` of exactly `0.5` —
  practically unreachable with continuous RNG output, kept unchanged from
  before this pass since it's a pre-existing formula detail, not something
  this pass was asked to redesign.
- `outcomeType`: one of the six victory subtypes or `'stalemate'` (see
  table above for the removed `mutual_heavy_losses`).
- `territoryOutcome`: `'unchanged' | 'captured' | 'contested'` (narrowed
  from a 5-value union — the other two were dead, see §6).
- `attacker` / `defender`: full `BattleSideBreakdown` — `initialTroops`,
  `remainingTroops`, `initialSiegeEngines`, `remainingSiegeEngines`,
  `unitBreakdown` (initial, per-category), `remaining` (per-category),
  `casualties` (per-category + troop `total`/`casualtyRate` +
  `siegeCasualtyRate`), `moraleChange`, `routed`.
- `defenderSurrendered`: alias for "territory was captured" (see §7).
- `events` / `readableLog` / `summary`: narrative-only, derived from the
  above; never a second source of truth for troop counts.
- `calculation`: raw numbers backing the narrative log (power, probability,
  roll, casualties, remaining) — always derived from the same
  `attacker`/`defender` breakdowns, not computed independently.

No field on `BattleResult` can contradict another: casualty/remaining
counts are always derived from one `splitCasualties()` call per side, and
every narrative/summary field is built from those same numbers, not
recomputed separately.

## 9. No-retreat rule (summary)

**Armies do not retreat.** A losing army's field forces (troops + siege)
and, for a defeated defender, its garrison, are eliminated in the battle
that defeats them — full stop, independent of victory margin. See §6.

## 10. Determinism expectations

Unchanged: `BattleEngine.resolve()` is a pure function of its `BattleInput`
(including `seed`). The same input (including the same `seed`) always
produces a bit-identical `BattleResult` — verified by the seeded
reproducibility tests in `tests/run.ts` and `battleTests.ts`
(`runSeededReproducibilityTest`). `resolve()` does not mutate its input
(attacker/defender army arrays, territory object) — verified by a
dedicated regression test.

## 11. Known intentionally-simple aspects

These are pre-existing, deliberate simplifications this pass did **not**
change (per the pass's explicit scope — no rebalancing, no new mechanics):

- Win probability is a plain `attackerPower / (attackerPower +
  defenderPower)` ratio — no morale-of-the-moment swings, no terrain
  ambush/flank bonuses beyond the static defense-bonus multiplier.
- The "moderate advantage" range between the narrow and decisive victory
  thresholds has no distinct label — it falls back to "narrow" (this was
  already true before the pass; a redundant duplicate `if`/`else` branch
  that always produced the same value was collapsed into one branch as a
  no-op cleanup, not a behavior change).
- `battlePhases` on `BattleResult` is always `[]` — it's a placeholder for a
  future cinematic/phase system and was already unused before this pass.
  Not built out further; not removed either, since removing a field with an
  always-consistent (empty) value isn't necessary to prevent contradictory
  results.
- Most `BattleEventType` values (`first_strike`, `charge`, `rally`, `flank`,
  `ambush`, `critical_hit`) are declared but never emitted by the resolver.
  These are unrelated to the no-retreat rule and were left alone — only
  `retreat` (retreat-flavored and dead) was removed.
- The near-unreachable exact-tie `isStalemate` branch still uses the
  original graduated winner/loser casualty split instead of forced
  elimination, since there is no "loser" in a draw by definition. This
  branch requires floating-point-exact equal power on both sides and a
  random roll within `1e-9` of 0.5; it was not otherwise touched.

## 12. Deferred battle improvements

Explicitly out of scope for this pass (do not implement without a separate,
explicit request):

- A real "moderate/normal victory" outcome label distinct from "narrow".
- Building out `battlePhases` into an actual multi-phase battle
  presentation.
- Wiring `BattleEngine` into `src/simulation/cli.ts`'s `ATTACK` decision
  outcome — see the integration gap noted below.
- Morale, terrain ambush/flank bonuses, generals, tactics, fatigue,
  formations, new unit types, new resources, or new combat equations.

### Remaining integration problem (not fixed in this pass)

`src/simulation/cli.ts`'s `simulateDecisionOutcomes()` — the code that
applies the effects of an AI's chosen `Decision` each turn in `npm run
simulate` — handles the `'ATTACK'` case by only recording diplomacy/memory
changes (opinion hits, `attack_made`/`attack_received` memory entries). It
**never calls `BattleEngine.resolve()`**, so no troops, casualties, or
territory ownership are actually affected by an "attack" in that simulation
loop today. This isn't a duplicate/competing battle implementation (there is
no manual power/casualty math there) — it's simply an unwired integration
gap. `runBattleMode()` (the `--battles` CLI path) and `battleTests.ts` /
`battleStressTests.ts` *do* call `BattleEngine.resolve()` correctly and are
the only real battle-resolution call sites in the repository — confirmed by
a full-repository search for `BattleEngine`/`BattleInput`/`BattleResult`/
`computeWinProbability`/casualty-calculation logic. Per this pass's
instructions, the CLI integration gap is documented here, not fixed, since
fixing it means redesigning how the decision simulation loop applies
attack outcomes — out of scope for a Battle Engine correctness pass.
