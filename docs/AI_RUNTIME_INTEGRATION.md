# AI Runtime Integration (Phase 16)

Phase 15 closed the MOVE → ATTACK strategic gap. This phase audited the
full AI decision path — `DecisionEngine` → `ActionScorer` → `AICommitment`
→ `RESOLVE_COMMITMENT` → `ContinuousWorldEngine` → `BattleEngine`/`GoalSystem`/
`MemorySystem` → reassessment — running inside the real
`Orchestrator`/`ContinuousWorldEngine` runtime (not the legacy
`src/simulation/cli.ts` turn-based demo loop), found several concrete
places where the AI's decision model and its actual executable
capabilities disagreed, and fixed them. **No new gameplay systems, no
BattleEngine/MapEngine changes, no multi-hop pathfinding.**

## 1. Audit findings

Tracing a complete AI ATTACK from decision through reassessment surfaced
four real bugs, all in the *canonical* Orchestrator/`ContinuousWorldEngine`
runtime (not in the legacy CLI demo, which mostly worked around them):

1. **Attack scorer/executor mismatch (Phase 15 follow-up).**
   `ActionScorer.scoreAttack` only considered armies *already standing* on
   a legal staging tile (`armiesBorderingTerritory`). A target only
   reachable via Phase 15's one-hop staging march was never scored at
   all — the AI could execute a staged attack (via `startStrategicAttack`)
   but would never *choose* one, because the scorer's notion of
   "attackable" was narrower than the executor's.
2. **MOVE scorer/executor mismatch.** `ActionScorer.scoreMove` picked a
   destination based on the best-scoring army/neighbor pair without
   checking whether that specific army was actually free to move.
   `executeMoveCommitment` (`src/orchestration/handlers.ts`) only ever
   assigns a MOVE to a *stationary* army with no conflicting attack
   intent, and searches independently for one adjacent to the chosen
   destination — so a MOVE commitment could be created for a destination
   that no free army was actually adjacent to, executing successfully
   only by coincidence (some other free army happening to also border it)
   or failing outright with `NOT_ADJACENT`.
3. **`lastActions` was never populated on the canonical decision path.**
   `ActionScorer.scoreWait` reads `ctx.self.lastActions` to penalize
   consecutive WAITs (anti-repetition). `src/simulation/cli.ts`'s legacy
   demo loop pushes onto `lastActions` after every decision — but
   `DecisionEngine.decide()` itself never did. Since
   `handleAiDecide`/`ContinuousWorldEngine` call `decide()` directly and
   never touch `lastActions`, **the anti-repetition logic was dead code in
   the actual game runtime**: `ctx.self.lastActions` was always `[]`, so a
   faction with nothing better to do could WAIT every single eligible tick
   forever with no escalating penalty.
4. **A faction with zero territories and zero armies still ran
   `AI_DECIDE` forever.** `WARLORD_SPECS`'s `celestial_theocracy` starts
   with `startingTerritories: []` and an empty starting army — a "ghost
   empire" from tick 0 by design, but nothing treated it as eliminated.
   It could still be selected for NEGOTIATE/TRADE/DECLARE_WAR/OFFER_PEACE
   (which don't require territory) or WAIT, forever, with nothing behind
   any of it.

Everything else audited (EXPAND, REINFORCE, BUILD, SCOUT, DEFEND, RETREAT,
goal alignment, commitment lifecycle, `ContinuousWorldEngine` tick
ordering) was already internally consistent — see "Not changed" below.

## 2. Decision → execution feasibility layer

New file: `src/engine/feasibility.ts`. It answers *"can this action
actually happen against the current `GameStateSnapshot`?"* as a separate
question from `ActionScorer`'s *"how desirable is it?"* — matching the
distinction the phase asked for, without introducing a second
combat/movement formula:

- `getAttackFeasibility(ctx, targetId) → 'immediate' | 'staging' | 'unreachable'`
  calls the exact same `listImmediateAttackingArmies` /
  `selectDelayedAttackPlan` functions `startStrategicAttack` (Phase 15)
  uses to actually execute an attack, so the scorer and the executor can
  never disagree about reachability. No multi-hop planning is attempted;
  `unreachable` covers everything beyond one legal staging hop.
- `isMoveDestinationFeasible(ctx, destId)` — true only if at least one of
  the faction's armies is stationary (not moving, no conflicting
  `attackIntent` — via `armyHasActiveStrategicOperation`) and adjacent to
  the destination, mirroring `executeMoveCommitment`'s own selection
  rule.

To make this possible without duplicating `isLegalStagingTerritory` /
`listImmediateAttackingArmies` / `selectDelayedAttackPlan` /
`factionArmies` / `isAdjacent` for the scorer's read-only
`GameStateSnapshot` shape, their parameter types were narrowed from the
full `GameState` to `GameStateSnapshot` (the only fields they ever read:
`territories`/`armies`/`factions`). `GameState` still structurally
satisfies `GameStateSnapshot`, so every existing caller
(`startStrategicAttack`, `src/army/movement.ts`,
`src/orchestration/handlers.ts`) is unaffected — this is a strict
narrowing, not a behavior change.

### Per-action feasibility audit (executable actions)

| Action | Selectable | Commitment created | Executes | Async progress | Terminal state | Reassess after |
|---|---|---|---|---|---|---|
| ATTACK | yes | yes | `executeAttack` → `startStrategicAttack` | yes (staging march) | completed/failed | yes |
| MOVE | yes | yes | `executeMoveCommitment` → `handleMove` | yes (march) | completed/interrupted/failed | yes |
| EXPAND | yes | yes | `executeExpand` | no (immediate) | completed/failed | yes |
| REINFORCE | yes | yes | `handleReinforce` | no (immediate) | completed/failed | yes |
| BUILD | yes | yes | `handleBuild` | no (immediate) | completed/failed | yes |
| SCOUT | yes | yes | `handleScout` | no (immediate) | completed/failed | yes |
| DEFEND | yes | yes | posture no-op | no | completed | yes |
| WAIT | yes | yes | no-op | no | completed | yes |
| RETREAT | yes | yes | `executeStrategicRetreat` → `handleMove` | yes (march) | completed/interrupted/failed | yes |
| NEGOTIATE | yes | yes | `handleNegotiate` | no | completed | yes |
| DECLARE_WAR | yes | yes | `handleDeclareWar` | no | completed | yes |
| TRADE | yes (scored) | yes | rejected: `isUnsupportedCommitmentAction` → `FEATURE_NOT_IMPLEMENTED` | — | failed | yes |
| OFFER_PEACE | yes (scored) | yes | rejected: `isUnsupportedCommitmentAction` → `FEATURE_NOT_IMPLEMENTED` | — | failed | yes |

TRADE/OFFER_PEACE remain explicitly unsupported at execution
(`src/engine/executableActions.ts`); they can still score highly (e.g. a
diplomatic personality biased toward them) but always fail cleanly and
immediately at `RESOLVE_COMMITMENT`, which frees the faction to reassess
next cadence — they cannot get "stuck" as a preferred-but-impossible
action. This was already correct before this pass; verified, not changed.

## 3. Attack feasibility (detail)

Before: `scoreAttack` iterated `ctx.enemyNeighbors` (every enemy
territory adjacent to ANY owned territory — i.e., every *structurally*
staging-eligible target) but only scored it if an eligible army already
stood on a legal staging tile; otherwise the target was skipped
entirely, silently.

After: `getAttackFeasibility` is called per target. `unreachable`
targets are still skipped (an impossible attack must not be scored as
executable). `staging` targets ARE now scored — using the single
candidate army `selectDelayedAttackPlan` would actually march — with a
flat `BALANCE.scoring.stagingAttackPenalty` (12) and a
`'requires marching to a staging territory first'` reasoning entry, so a
slower two-step attack does not outscore an equally-good immediate one
elsewhere, without disqualifying it outright. See
`tests/aiRuntime.ts`, "attack feasibility layer" / "ActionScorer /
DecisionEngine feasibility integration".

## 4. Move feasibility (detail)

`scoreMove` now skips any army with `armyHasActiveStrategicOperation(army)`
(already moving, or mid-strategic-attack) before considering it as a
candidate for `bestTarget`. Since `bestTarget` is always derived from a
neighbor of an army that passed this filter, the chosen destination is
now guaranteed to have at least one genuinely free adjacent army —
`isMoveDestinationFeasible` is exported for direct testing/reuse but the
scorer's own loop already enforces the same invariant structurally.

## 5–6. EXPAND / REINFORCE / BUILD / SCOUT — audited, not changed

- **EXPAND**: `scoreExpand` and `executeExpand` already share
  `ScoringHelpers.computeLocalUsableMilitaryPower` (Engine Execution
  Consistency pass, Phase ≤15) — verified still true, no drift.
- **REINFORCE/BUILD**: scorer and executor already read the same
  `BALANCE.economy.reinforcementCost` /
  `BALANCE.territory.fortificationCostPerLevel` — verified.
- **SCOUT**: `scoreScout` only proposes territories that are unknown or
  stale (`scoutedTurnsAgo > 5`); `handleScout`/map-mode scouting has no
  separate affordability gate to drift from. No change needed.

## 7. DEFEND / WAIT / RETREAT loops

- **WAIT**: fixed at the root cause (see finding #3 above) rather than
  adding a new mechanism: `DecisionEngine.decide()` now calls
  `recordLastAction(warlord.snapshot, turn, action, targetId)` every time
  it creates a commitment (both the normal path and the "no actions
  available" WAIT fallback), capped at 20 entries — the exact bookkeeping
  the legacy CLI loop already did, just moved to the one place every
  caller (`AI_DECIDE`, tests, CLI) goes through. `scoreWait`'s existing
  `-20` penalty for 2+ consecutive WAITs (in the last 2 turns) now
  actually fires in the real runtime.
- **DEFEND**: audited; `scoreDefend` already scores `-20` when
  `borderThreat === 0`, so a DEFEND with no actual threat is already
  deprioritized every reassessment — no repetition-specific fix was
  needed once `lastActions`/cadence work correctly, and DEFEND is
  intentionally allowed to persist *while a real border threat persists*
  (that is correct behavior, not a stall).
- **RETREAT**: confirmed still strategic repositioning only
  (`executeStrategicRetreat` → `handleMove`); never touches
  `BattleEngine`. Unchanged.

## 8. Goal progress

New file: `src/engine/outcomeFeedback.ts`,
`applyCommitmentOutcomeFeedback(state, factionId, commitment, outcome)`.

**Important architecture note (a real bug caught during implementation,
not shipped):** goal progress must mutate the *canonical* `GameState`
draft directly (`state.factions.get(factionId).goals`), **not**
`WarlordState.goals` (the `GoalSystem` wrapper built by
`buildWarlordStates`/`rebindWarlordRuntime`). Handlers run against a
freshly cloned transaction draft (`runStateTransaction` clones the state
*before* calling the handler); `WarlordState.snapshot`/`.goals` are only
re-pointed at the new draft *after* the handler returns
(`Orchestrator.execute`). Mutating `ws.goals` from inside a handler lands
on the pre-transaction object and is silently discarded — the same class
of pitfall `GameState.commitments`'s doc comment describes for
`AICommitment` (solved there via the explicit
`syncCommitmentsFromWarlordStates` bridge). Goals have no second copy to
begin with (`WarlordSnapshot.goals` IS canonical), so the fix is simply
to mutate the draft's own array, matching how every other handler already
uses `requireFactionSnapshot(state, id)` / `pushMemory(snapshot, ...)`.

Wired into both terminal-commitment boundaries so there is exactly one
feedback path:
- `handleResolveCommitment`'s immediate completion/failure
  (`src/orchestration/handlers.ts`).
- `applyCommitmentTerminal` (movement/attack-arrival completion, failure,
  interruption via `ContinuousWorldEngine`).

On `completed`, if the commitment has an `originatingGoalId`, the goal's
`progress` advances by a flat, documented-as-coarse amount
(`GOAL_PROGRESS_ON_SUCCESS`: ATTACK/EXPAND 15, DECLARE_WAR 8, NEGOTIATE 6,
DEFEND 5, REINFORCE/BUILD 4). Failed/interrupted commitments never move
goal progress in either direction — a failed attempt is neutral, not a
setback. This is deliberately not a planning system: it only nudges the
goal `DecisionEngine.originatingGoalId` already assigned at decision time
(via `GoalSystem.evaluateActionAlignment`) — no new goal-selection logic.
Goal progress is plain `WarlordSnapshot` data, so it already survives
`cloneGameState` with no extra work (verified in
`tests/aiRuntime.ts`).

## 9. Memory / outcome feedback

One new `MemoryEventType`: `'action_failed'` (deliberately generic, not
one type per action). `applyCommitmentOutcomeFeedback` pushes it
(`withFaction: null`, small magnitude) for a failed/interrupted
ATTACK/EXPAND/MOVE/RETREAT commitment via the existing `pushMemory`
helper. It does not feed `MemorySystem.summarizeForFaction` (which is
specifically about relations with *another* faction) — its only purpose
is making failures visible in `MemorySystem.getEntries()` instead of
vanishing. Battle win/loss and territory gained/lost were already
recorded correctly by `src/orchestration/applyBattle.ts` — verified, not
duplicated.

## 10. Faction elimination

`isFactionEliminated(snapshot)` (`src/engine/DecisionEngine.ts`) —
`territories.length === 0 && armies.length === 0`. No new `GameState`
field: fully derived from already-canonical data, so there is nothing new
to clone, validate, or desync. `ContinuousWorldEngine.advanceOneFaction`
checks it immediately after the "does this faction have an active
commitment" branch and before the reassessment-cadence check: an
eliminated faction never starts a new `AI_DECIDE`, but a commitment it
already had active at the moment of elimination is still allowed to
resolve/fail/interrupt normally (no discontinuity is introduced
mid-flight). No exile/comeback mechanic is implied or built — a faction
that somehow regains a territory or army is simply no longer
"eliminated" by the same check, automatically.

`celestial_theocracy` is a living SAMPLE_MAP faction (Golden Hills + Eastern
Hills). Elimination is still derived (`territories.length === 0 &&
armies.length === 0`); tests cover that with an injected empty faction
rather than a broken sample start.

## 11. Personality differentiation

Not rewritten — verified via the new long-simulation harness across
multiple seeds (`tests/longSimulation.ts`, "personality differentiation").
Aggregating war-like actions (ATTACK + DECLARE_WAR) for the aggressive
`ashen_horde` vs. defensive `iron_kingdom`, and BUILD/REINFORCE actions
for economic `merchant_republic` vs. aggressive `ashen_horde`, across 5
seeds × 60 ticks, confirms existing `PersonalitySystem`
biases/`BALANCE.ambition` still produce the intended directional
differences inside the real continuous-world runtime — this was at risk
of *not* being true before the feasibility/`lastActions` fixes in this
pass (a starved-of-valid-targets aggressive faction would previously just
WAIT indefinitely without escalating penalty, flattening the intended
distinction).

## 12. Long-term AI behavior test harness

New file: `src/simulation/longRunHarness.ts`, `runLongSimulation(opts)`.
**A test harness, not a second engine** — it drives the real
`Orchestrator` → `ADVANCE_WORLD` → `ContinuousWorldEngine` chain (same
path as `cli.ts --world`) in a loop (chunked to respect
`BALANCE.world.maxElapsedTicksPerAdvance`), and aggregates statistics
purely from the `WorldAdvanceResult` payloads and before/after
`GameState` snapshots it already returns: per-faction action counts,
battles resolved/failed, territories that changed owner, eliminations,
and engine/command errors. It never calls `DecisionEngine`/
`ActionScorer`/`BattleEngine` directly.

## 13. Stalls found and fixed

The `lastActions` wiring bug (§1.3) was the primary stall risk: with it
fixed, `tests/longSimulation.ts`'s "no faction is stuck repeating only
WAIT..." test confirms no non-eliminated faction spends an entire 100-tick
run doing nothing but WAIT. The MOVE feasibility fix (§4) removes a class
of MOVE commitments that would previously fail immediately at
`RESOLVE_COMMITMENT` and force an extra reassessment cycle before the AI
found something else to do. The elimination fix (§10) removes the
"ghost empire still deciding" case entirely.

## 14. Continuous-world ordering

Documented in full as a doc comment on `ContinuousWorldEngine.advance()`
(see that file) and summarized: per tick — world tick increment → (every
`ticksPerEventTurn` ticks) EventEngine step → stale-attack-intent
invalidation → movement progression → pending-attack resolution (sorted
army id) → per-faction AI advance (sorted faction id; eliminated and
in-flight factions skipped) → orphan-commitment reconciliation. Audited
for the specific failure modes the phase called out (AI deciding before
movement completes, battle after reassessment, event changing ownership
after attack validated, destroyed army still deciding, commitment
completing after faction invalid) — all are prevented by the ordering
already in place; only the elimination check (§10) and the attack/move
feasibility fixes (§3–4) were missing pieces, not ordering bugs.

## 15. Determinism

No `Date.now()`/`Math.random()` was introduced. `runLongSimulation` is
seeded and produces byte-identical `WorldAdvanceResult`-derived statistics
and final `GameState` (territories/resources/action counts) for two runs
with the same seed and tick count — verified in `tests/longSimulation.ts`,
"deterministic 50-tick simulation" / "deterministic 100-tick simulation".
`recordLastAction`/`isFactionEliminated`/feasibility checks are all pure
reads or simple deterministic mutations of already-canonical state; none
consume RNG.

## 16. Tests

`tests/aiRuntime.ts` (~24 tests: attack/move feasibility, ActionScorer
integration, faction elimination, `lastActions` wiring, goal progress,
memory feedback, real Orchestrator RESOLVE_COMMITMENT wiring) and
`tests/longSimulation.ts` (~13 tests: determinism, invariants, no orphan
armies/impossible commitments, personality differentiation, no
WAIT-only stalls, longer multi-faction runs) — 37 new tests, combined
with 1 pre-existing test corrected for the intentional elimination
behavior change (`'multiple AI factions advance independently'`), for
268/268 passing overall (`npm test`).

## 17. Performance / scope

No new full-map scans were introduced: `getAttackFeasibility`/
`isMoveDestinationFeasible` reuse the exact same bounded
territory/army-list traversals `ActionScorer` and `startStrategicAttack`
already performed. `isFactionEliminated` is an O(1) length check.
`runLongSimulation` calls `ADVANCE_WORLD` in bounded chunks rather than
one tick at a time to minimize command-dispatch overhead over long runs.

## 18. Not changed / explicitly out of scope

- BattleEngine, MapEngine: untouched.
- No multi-hop attack or movement planning.
- No new gameplay systems (cities, recruitment, supply lines, TRADE,
  OFFER_PEACE execution).
- No exile/comeback mechanic for eliminated factions — elimination is a
  read-only classification of existing data, not a new lifecycle state
  machine.
- Personality presets themselves (`PersonalitySystem`) were not modified.

## 19. Known remaining limitations

- Goal-progress deltas are flat and coarse by design (documented in
  `outcomeFeedback.ts`); they are bookkeeping, not a scored planning
  layer, and do not distinguish a decisive victory from a pyrrhic one.
- `action_failed` memory entries are self-referential
  (`withFaction: null`) and do not currently feed
  `MemorySystem.summarizeForFaction`; they exist for introspection/tests,
  not diplomatic reasoning about a third party's failures.
- Attack feasibility is still one-hop-staging-or-immediate only, per
  Phase 15's explicit scope; a target beyond one hop is `unreachable` to
  both the scorer and the executor, by design.
- `runLongSimulation` is a statistics harness; it does not attempt to
  auto-classify "stuck" commitments beyond what `checkGameStateInvariants`
  and the explicit elimination/orphan-army/impossible-commitment checks
  in `tests/longSimulation.ts` already cover.
