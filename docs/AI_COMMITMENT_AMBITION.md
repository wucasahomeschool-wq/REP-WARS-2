# AI Commitment & Ambition Pass (Phase 8)

> **Phase 17N.2:** `EXPAND`/`SCOUT` are not production actions. Ambition still
> layers onto ATTACK/DECLARE_WAR. Personalities are authored per world.
> See `docs/WORLD_DEFINITION.md`.

This document describes the **AI Warlord Engine** after the commitment /
ambition pass. It does **not** implement an Orchestrator, an authoritative
runtime `GameState`, persistence, a frontend, or continuous-world timing.

Related: `docs/AI_DECISION_CORRECTNESS.md` (scoring math),
`docs/CANONICAL_STATE_ARCHITECTURE.md` (types),
`docs/BATTLE_ENGINE_CORRECTNESS.md` (no-retreat battle rule).

---

## 1. Existing AI architecture

Data flow (unchanged in shape, with a commitment step inserted after selection):

```
world state (GameStateSnapshot)
  → WarlordState.buildContext (observations)
  → GoalSystem (active goals; optional faction targets from generation context)
  → ActionScorer.scoreAllActions (candidates + personality + goals + ambition)
  → DecisionEngine.selectWithRandomness
  → Decision + AICommitment
  → (future Orchestrator executes; this pass only proposes)
```

Preserved systems:

| System | Role |
| --- | --- |
| `PersonalitySystem` | Six presets; trait biases on action types, risk, revenge, trust |
| `MemorySystem` | Historical grievances / trust used in scoring |
| `GoalSystem` | Long-term goals and action alignment bonuses/penalties |
| `ActionScorer` / `ScoringHelpers` | Candidate generation and numeric scores |
| `DecisionEngine` | Seeded selection among near-ties; now also commitment lifecycle |

The AI remains independent of `BattleEngine`, `WorldSimulator` (events),
`MapEngine`, and any future Orchestrator. It estimates; it does not resolve
battles, apply events, mutate ownership, or advance a clock.

**What was missing before this pass:** every `decide()` call produced a fresh
strategic action. There was no record of an in-flight commitment, so a
simulation that re-evaluated every turn would re-pick (and, in the CLI
harness, re-execute) as if the previous choice had never been made.
`WarlordSnapshot.lastActions` is history only. There was also **no ambition
field** — personality traits were the only intensity knobs, and several
generated goals (`destroy_rival`, `form_alliance`) never received a
`targetFaction`, so they never affected scores.

---

## 2. Commitment lifecycle

Statuses:

| Status | Meaning |
| --- | --- |
| `pending` | Reserved for a future decide-vs-commit split. Unused today. |
| `committed` | AI has selected and committed. `decide()` creates this state. |
| `executing` | Future Orchestrator has started carrying the action out (`beginExecution`). |
| `completed` | Action finished successfully. Next `decide()` may reassess. |
| `interrupted` | Abandoned for an external reason (Orchestrator / tests). Next `decide()` may reassess. |
| `failed` | Cannot be carried out (including **invalid target**). Next `decide()` may reassess. |

Invariant: while status is `pending`, `committed`, or `executing`,
`DecisionEngine.decide()` returns the **existing** commitment (`isNewCommitment:
false`) instead of scoring a new strategic action. It does **not** sleep, wait
N ticks, or invent duration. Timing is an Orchestrator concern.

`completeCommitment` / `interruptCommitment` / `failCommitment` / `beginExecution`
are the explicit transitions. This pass does not auto-complete after a number
of turns.

The CLI simulation harness acts as a **stub orchestrator**: it executes only
*new* commitments, then immediately `completeCommitment` so the next turn can
reassess. That preserves the existing “one resolved action per turn” demo
without pretending the engine owns a clock.

---

## 3. Commitment state model

Canonical type: `AICommitment` in `src/types/index.ts`.

Stored on `WarlordState.activeCommitment` (AI-owned). Not written onto
territories, armies, resources, diplomacy, or event state.

Fields:

- `id` — deterministic (`cmt_<seed36>_<factionHash36>_<turn>_<seq36>_<action>_<target>`)
- `warlordId`, `action`, `targetId` / `targetName`
- `status`, `createdTurn`, `statusReason`
- `originatingGoalId` (highest-priority aligned goal, if any)
- `reason[]` (scoring reasoning plus later status notes)
- `priority` / `score` / `confidence`
- `personalityBias`, `ambitionInfluence`
- `factorBreakdown` (inspectable scoring factors)

`Decision` repeats the actionable fields plus `commitment`, `isNewCommitment`,
`originatingGoalId`, `personalityBias`, and `ambitionInfluence` so a future
Orchestrator can see what was chosen and why without a logging framework.

IDs: no `Date.now()`, `Math.random()`, or non-seeded UUIDs. Same engine seed +
same warlord state + same turn of first creation → same id. Per-warlord
sequence prevents collisions after reassessment. Faction hash prevents
cross-warlord collisions.

Returned commitments are clones. Mutating the object on a `Decision` does not
change `WarlordState.activeCommitment`.

---

## 4. How ambition influences goals/actions

`WarlordSnapshot.ambition` is a `[0, 1]` scalar. Default
`BALANCE.ambition.defaultValue` (0.5). At that value **every extra ambition
contribution is 0**, so pre-ambition scores are unchanged.

Applied in `ActionScorer.applyAmbitionModifiers` *after* existing personality,
memory, military, and goal-alignment math:

1. **Goal persistence** — extra = `(goal alignment contribution) * (ambition - 0.5) * goalPersistenceScale`.
   High ambition amplifies aligned long-term goals; low ambition shrinks them.
2. **Strategic push** — extra = `(ambition - 0.5) * strategicPushWeight` on
   `ATTACK` / `DECLARE_WAR` when the faction is **not** under
   immediate local threat.

Immediate threat (`ScoringHelpers.factionUnderImmediateThreat`): any owned
territory whose neighboring hostile local power
(garrison + stationed armies on those neighbors) outmatches the troops
actually standing there. Empire-wide `totalMilitaryPower` is not used.
Fixed-capital status is not part of this check.

Under threat:

- `DECLARE_WAR` gets **no** ambition extras (including goal-persistence amp).
- Offensive strategic-push is skipped (including on `ATTACK`).
- `DEFEND` / `REINFORCE` are not penalized or boosted by ambition.

Ambition never rewrites personality presets and never calls Battle/Event/Map
engines.

---

## 5. How personality differs from ambition

| | Personality | Ambition |
| --- | --- | --- |
| What it is | Which *kinds* of actions the warlord prefers | How *hard* they stick to long-term goals |
| Encoded as | Six presets × ten traits | One `[0, 1]` scalar on the snapshot |
| Scoring factor | `Personality bias` (and risk/revenge/trust helpers) | `Ambition (goal persistence)`, `Ambition (strategic push)` |
| Survival | Defensive traits still raise DEFEND/REINFORCE | Must not override an immediate local threat |

The six presets (`defensive`, `aggressive`, `expansionist`, `opportunistic`,
`diplomatic`, `economic`) are unchanged. Tests assert that swapping
personality changes `Personality bias` at fixed ambition, and swapping
ambition does **not** change `Personality bias`.

---

## 6. Reassessment rules

Reassess (score and create a **new** commitment) when:

- there is no active commitment
- the active commitment is `completed`, `failed`, or `interrupted`
- the recorded target is invalid / the action is impossible against current state
  (the engine **fails** the commitment, then reassesses in the same `decide()` call)

Do **not** reassess merely because a different candidate now has a slightly
higher score. That is the difference between “pick an action every tick” and
“commit, then follow through until there is a reason to stop.”

There is no tick delay, cooldown, or wall-clock duration in the engine.

---

## 7. Target invalidation behavior

`validateCommitmentTarget` (DecisionEngine):

- **WAIT**: always valid (no entity).
- **Territory actions** (`ATTACK`, `BUILD`, `DEFEND`,
  `REINFORCE`, `MOVE`, `RETREAT`): target id must exist in
  `gameState.territories` (except `MOVE`/`RETREAT` with a null target, which
  means “no viable destination,” not a missing entity).
  - `ATTACK` also fails if the tile is unowned or self-owned.
  - `DEFEND` / `REINFORCE` / `BUILD` fail if the tile is no longer self-owned.
- **Faction actions** (`NEGOTIATE`, `TRADE`, `DECLARE_WAR`, `OFFER_PEACE`):
  target must exist in `gameState.factions` and must not be self.

Invalid → **fail** (not interrupt). Failure means “this commitment cannot be
executed as specified,” which is the existing architecture’s closest match;
interrupt is reserved for an external/orchestrator abort of a still-possible
action.

`GoalSystem.invalidateMissingTargets` completes goals whose
`targetFaction` / `targetTerritory` no longer exist so they leave
`getActiveGoals`. It does **not** invent replacements. `control_region`
uses authored `Territory.regionId` against `goal.targetRegion`.

---

## 8. Strategic RETREAT interpretation

**This is (B): a separate strategic army-positioning action, not battlefield
retreat.**

Battle rule (unchanged): a defeated army is **eliminated**. `BattleEngine`
does not emit retreat outcomes; `TerritoryOutcome` has no `retreat_required`;
`BattleEventType` has no `retreat`.

`ActionType.RETREAT` scores pulling a field army **off a territory this
faction does not own** when locally outnumbered. Armies standing on owned
land are never RETREAT candidates. Strategic RETREAT executes through the
Orchestrator (`executeStrategicRetreat` → `handleMove`); it is not a
battlefield retreat and never calls BattleEngine.

---

## 9. What the AI does NOT do

- Execute actions against the world (no ownership, army, resource, diplomacy,
  or event mutation inside `decide()` / commitment updates).
- Resolve battles or call `BattleEngine`.
- Advance time, sleep, or simulate duration.
- Own an authoritative runtime `GameState`.
- Persist to Supabase or drive a UI.
- Fabricate region membership for `control_region`.
- Add personalities, rewrite scoring formulas, or rebalance except where
  ambition extras are **zero** at the default 0.5.
- Auto-complete commitments after N turns.

---

## 10. What the future Orchestrator will be responsible for

- Authoritative world state and applying execution results.
- Reading `Decision.commitment` / `WarlordState.activeCommitment`.
- Calling `beginExecution`, then later `complete` / `interrupt` / `fail`.
- Real duration, travel time, and “still executing” across ticks.
- Command routing / command index.
- Updating goal `progress` from actual outcomes.
- Dynamic goals such as `protect_territory` / `break_siege` when sieges exist.
- Passing region data into the AI if `control_region` should become real.

The excluded draft in `src/orchestration/gameState.ts` (wall-clock
`committedAtMs` / `simulatedDurationMs`) is **not** the model this pass
added. Canonical commitments are turn-based `AICommitment` in `src/types/index.ts`.

---

## Goal generation notes (this pass)

`GoalSystem.generateInitialGoals` accepts optional `InitialGoalContext`
(`otherFactionIds`, `rivalFactionIds`, `allianceCandidateIds`). Without it,
`destroy_rival` / `form_alliance` still have `targetFaction: null` and do not
mis-align against arbitrary factions (Phase 5 guarantee).

`SimulationBuilder` **does** pass that context from existing relationship
specs, so those goals now affect scoring in the sample world. Targets are
picked deterministically from the provided ids (sorted + salt hash) without
consuming the simulation RNG (reputation/stability rolls stay as they were).

Still unused at generation time: `protect_territory`, `break_siege` (alignment
logic already exists). `control_region` still only aligns with `BUILD`.
Goal progress is still not advanced by the AI — that is execution.
