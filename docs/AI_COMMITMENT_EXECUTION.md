# AI commitment execution (Phase 12)

Phase 12 makes the Phase 8 commitment lifecycle **honestly executable**
through the Phase 10 Orchestrator. Phase 13 schedules that same
`RESOLVE_COMMITMENT` path from the Continuous World Engine when a
commitment's simulation duration elapses. No persistence, frontend,
fitness, or TRADE/OFFER_PEACE gameplay.

```
AI Decision
    ↓
Commitment
    ↓
Orchestrator (RESOLVE_COMMITMENT)
    ↓
validate against CURRENT GameState
    ↓
Shared Domain Operation  (same as player commands where they exist)
    ↓
GameState + invariants
    ↓
Commitment Result
    ↓
Complete / Fail
    ↓
AI Reassessment (AI_DECIDE)
```

**Invariant:** an active executable commitment can be attempted. If the world
has moved on (stale target, no troops, unaffordable), the commitment **fails**
and is no longer active. It must not sit `committed` forever while doing
nothing. Unsupported actions fail with `FEATURE_NOT_IMPLEMENTED` and the
same terminal status.

---

## Shared player / AI operations

| Action | Player command | AI commitment | Shared function |
| --- | --- | --- | --- |
| ATTACK | `ATTACK` | yes | `executeAttack` → `startStrategicAttack` → BattleEngine (immediate or one-hop staging then battle) |
| BUILD | `BUILD` | yes | `handleBuild` + `BALANCE.territory.fortificationCostPerLevel` |
| REINFORCE | `REINFORCE` | yes | `handleReinforce` + `BALANCE.economy.reinforcementCost` |
| EXPAND | `EXPAND` | yes | `executeExpand` + `ScoringHelpers.computeLocalUsableMilitaryPower` |
| SCOUT | `SCOUT` | yes | `handleScout` |
| MOVE | `MOVE` | yes | `handleMove` → `beginArmyMovement` (commitment picks a stationary adjacent army; stays `executing` until arrival) |
| NEGOTIATE | `NEGOTIATE` | yes | `handleNegotiate` |
| DECLARE_WAR | `DECLARE_WAR` | yes | `handleDeclareWar` |
| RETREAT | — (uses MOVE) | yes | `executeStrategicRetreat` → `handleMove` |
| WAIT | — | yes | complete immediately, no world mutation |
| DEFEND | — | yes | complete immediately (hold posture; no invented garrison mechanic) |
| OFFER_PEACE | catalog unsupported | fail | `FEATURE_NOT_IMPLEMENTED` |
| TRADE | catalog unsupported | fail | `FEATURE_NOT_IMPLEMENTED` |

DecisionEngine / ActionScorer may still **score** TRADE and OFFER_PEACE.
Scoring was not redesigned. Execution will not fake them.

---

## Action compatibility matrix

| Action | AI can choose? | AI can commit? | Orchestrator execute? | Shared domain? | Status |
| --- | --- | --- | --- | --- | --- |
| ATTACK | yes | yes | yes | BattleEngine | **executable** |
| DEFEND | yes | yes | complete no-op | — | **executable as posture** (no extra mutation) |
| REINFORCE | yes | yes | yes | BALANCE reinforce | **executable** |
| EXPAND | yes | yes | yes | local usable power | **executable** |
| SCOUT | yes | yes | yes | handleScout | **executable** |
| BUILD | yes | yes | yes | BALANCE build | **executable** |
| MOVE | yes | yes | yes | handleMove | **executable** |
| NEGOTIATE | yes | yes | yes | handleNegotiate | **executable** |
| OFFER_PEACE | yes (scored) | yes | no | — | **unsupported** |
| DECLARE_WAR | yes | yes | yes | handleDeclareWar | **executable** |
| TRADE | yes (scored) | yes | no | — | **unsupported** |
| RETREAT | yes | yes | yes | handleMove | **executable** (strategic, not battle) |
| WAIT | yes | yes | complete no-op | — | **executable** (one resolution; not infinite) |

Classification lives in `src/engine/executableActions.ts`.

---

## EXPAND

Existing CLI rules (Phase 6), now also on the Orchestrator:

- Target must be **unowned**
- Strength = `ScoringHelpers.computeLocalUsableMilitaryPower()` (adjacent
  armies + bordering owned garrisons — **not** empire-wide power)
- Succeeds when local power `> (garrison + garrisonBuffer) * soldierValue * successLocalPowerRatio`
- Costs `BALANCE.territory.expansionClaim.goldCost`
- Applies garrison reduction / min garrison / neighbor opinion hit from the
  same BALANCE block (values unchanged from cli.ts)

No cities, travel time, or new geometry.

---

## DEFEND and WAIT

There is no separate defend-move or wait-timer model.

- **WAIT** completes on this resolution step with no resource grant (the
  CLI harness’s half-income WAIT is harness-only, not a second economy).
- **DEFEND** completes if the target is still owned: “hold this land.”
  No invented reinforcement. The AI can reassess next `AI_DECIDE`.

Neither remains `committed`/`executing` after `RESOLVE_COMMITMENT`.

---

## RETREAT

Strategic repositioning off **non-owned** ground onto an adjacent **owned**
territory, via `handleMove` / `beginArmyMovement`. The army marches over
world ticks like any other MOVE. BattleEngine’s no-retreat elimination
rule is untouched. RETREAT never calls battle math.

---

## Stale commitments

Before execution, `validateCommitmentTarget` runs on **current** GameState.

If invalid (target captured, no longer unowned, missing entity, …):

- commitment status → `failed`
- world entities unchanged
- `CommandResponse.success === false` with `INVALID_TARGET` (or the domain
  error: `INSUFFICIENT_TROOPS`, `INSUFFICIENT_RESOURCES`, …)
- `payload.reassessmentRequired === true`

`RESOLVE_COMMITMENT` **commits** that failed status (it does not throw in a
way that rolls back the failure). That is required so the commitment cannot
stay active.

A **completed** commitment is not active; a second resolve returns
`ACTION_NOT_ALLOWED` and does not mutate the world.

---

## Lifecycle

`DecisionEngine`: `beginExecution` / `completeCommitment` / `failCommitment`
/ `interruptCommitment` (unchanged).

After a terminal status, the Continuous World Engine will call `AI_DECIDE`
again only after `BALANCE.world.reassessmentIntervalTicks` (not every
simulation step). Direct `AI_DECIDE` commands are unchanged.

GameState invariants still validate **in-flight** targets only (completed
ATTACK may have captured its target).

---

## Mutation boundary

DecisionEngine, ActionScorer, GoalSystem, PersonalitySystem, MemorySystem
do not write territories, armies, resources, diplomacy ledgers, or events.
The Orchestrator applies domain results inside `runStateTransaction`.

---

## Why unsupported actions do not silently succeed

TRADE does not exchange resources. OFFER_PEACE does not end war. Returning
`success: true` would be a fake. They return `FEATURE_NOT_IMPLEMENTED` and
mark the commitment `failed` so the AI can reassess.
