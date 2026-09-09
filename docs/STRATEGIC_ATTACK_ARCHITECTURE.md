# Strategic attack architecture (Phase 15)

Phase 15 closes the Phase 14 gap: an army can attack immediately from a
**legal staging territory**, or march **one adjacent hop** onto such a
tile and then fight. Armies do **not** walk into the enemy target before
BattleEngine resolves combat.

```
Player/AI ATTACK
      ↓
startStrategicAttack  (shared domain operation)
      ↓
   ┌── immediate legal staging  → BattleEngine.resolve
   └── else one-hop to staging  → Army.movement + Army.attackIntent
                                      ↓
                           ContinuousWorldEngine
                                      ↓
                           executeReadyStrategicAttack
                                      ↓
                           BattleEngine.resolve
                                      ↓
                           applyBattleResultToGameState
```

Player and AI use the same operation. BattleEngine remains the only
combat-math authority.

---

## Attack-position rule (before vs after)

**Phase 14 (documented gap):** an attacking army was any **stationary**
force whose **current location’s `neighboring` list included the
target**, with `soldiers + knights > 100`. After a MOVE onto the target
hex, the army was no longer “bordering,” so there was no MOVE → ATTACK
chain. ATTACK did **not** require a war declaration (opinion/state may
still change as a consequence).

**Phase 15 legal staging:**

A territory **S** is a legal staging tile for attacker **F** against
target **T** iff:

1. `S` exists and `T` exists
2. `S.id !== T.id` (never stage on the target)
3. `S.owner === F` (attacker-owned; not enemy, not unowned, not ally)
4. `S.neighboring` includes `T`

An army may **immediate-attack** T when it is stationary on a legal
staging tile, eligible (`soldiers + knights > 100`), and has no
`pending_movement` attack intent.

It may **delay-attack** when it can MOVE one hop onto a legal staging
tile. Multi-hop pathfinding is deferred.

Diplomacy: ATTACK still does **not** require `at_war`. Existing opinion /
relationship updates after a resolved battle are unchanged.

---

## Immediate vs delayed

| | Immediate | Delayed |
| --- | --- | --- |
| Condition | ≥1 eligible army already on a legal staging tile | none immediate; a one-hop plan exists |
| Command return | `attackOutcome: 'battle_resolved'` + `battleResult` | `attackOutcome: 'movement_started_for_attack'`, `arrivalPending: true` |
| World tick | unchanged | unchanged (command does not wait) |
| Combat | `BattleEngine.resolve` now | after CWE arrival |

If several armies are already on legal staging tiles, **all** of them
join one `BattleInput` (same as the old bordering-force set, tightened
to owned staging).

If none can fight now, **one** army and **one** staging tile are chosen
(see below) and a march starts.

---

## Staging selection

`selectDelayedAttackPlan(state, attackerId, targetId)`:

- Candidates: eligible, idle armies (not moving, no active attack intent)
  that are adjacent to a legal staging tile other than their current
  location.
- Sort: **shortest `calculateMovementDuration`**, then **staging
  territory id**, then **army id**.
- Never selects the enemy target, enemy-owned land, or unowned land.

If no immediate force and no one-hop plan: `INSUFFICIENT_TROOPS` (or
`ACTION_NOT_ALLOWED` if the only otherwise-legal force is still
marching).

---

## Canonical attack intent

`AICommitment` only stores `action: ATTACK` and `targetId`. That is not
enough for player delayed attacks (no commitment) or for “what happens
after this march.” Intent lives on the **army**, same pattern as
`Army.movement`:

```ts
Army.attackIntent?: StrategicAttackIntent | null
// targetTerritoryId, stagingTerritoryId, createdAtTick,
// status: 'pending_movement' | 'ready',
// commitmentId: string | null
```

Live statuses only. Completed / failed / cancelled are **not** stored;
the field is cleared. Schema version **4**.

This is the answer to “what is this army trying to do after it arrives?”
There is no second GameState map and no hidden CWE cache.

`commitmentId` links AI ATTACK; player delayed attacks use `null`.

---

## Player behavior

`ATTACK` returns immediately:

- battle happened, or
- march + intent recorded

A second ATTACK on the same target while a plan is pending is
`ACTION_NOT_ALLOWED`. An army with movement or attack intent cannot
`MOVE` until the operation finishes.

World advancement later resolves the pending fight automatically.

---

## AI commitments

Same `startStrategicAttack` / `executeAttack` path.

- Immediate: executing → BattleEngine → completed (win or loss still
  **completes** the commitment; the attack was carried out).
- Delayed: executing + `arrivalPending`; CWE **does not** `AI_DECIDE`
  while the ATTACK commitment is `executing`; arrival →
  `executeReadyStrategicAttack` → complete or fail.

Invalid / interrupted marches fail or interrupt the commitment. Orphan
`executing` ATTACK with no army intent cannot stay active.

---

## ContinuousWorldEngine

Each tick, CWE:

1. `invalidateStaleAttackIntents` (missing/friendly target, illegal staging)
2. `progressArmyMovements` (army-id order)
3. MOVE/RETREAT arrivals still complete those commitments.
4. ATTACK-linked **arrivals are not** auto-completed as MOVE.
5. Interrupted marches interrupt/fail the linked commitment (intent was
   already cleared on the army).
6. Stationary armies with active `attackIntent`, sorted by army id, call
   `host.executePendingAttack` → `executeReadyStrategicAttack` (same
   BattleEngine path). If the first battle captures the target, later
   intents on that target fail closed (no second battle for a stale plan).

CWE does not contain combat formulas.

---

## Invalidation / cleanup

`executeReadyStrategicAttack` re-checks **current** GameState:

- army exists, idle, at staging
- target exists and is still foreign-owned
- staging still legal
- army still eligible

Failures clear `attackIntent` (and fail a linked commitment). Destroyed
armies drop intent with the entity; orphan ATTACK commitments fail.

Committed GameState must not dangle (`attackIntent` target/staging must
exist). Between commands, deleting a target without cleanup is an
invariant violation. Same-tick EventEngine deletions are sanitized by
`invalidateStaleAttackIntents` before movement progress so the tick can
commit.

Post-battle: `applyBattleResultToGameState` is unchanged (capture still
moves surviving attackers onto the taken tile). Intents on participants
and on the same target for that faction are cleared. Movement is cleared.

One plan produces at most one `BattleEngine.resolve`.

---

## Determinism

Identical GameState, worldSeed, commands, elapsedTicks ⇒ identical
staging choice, movement, battle seed, BattleResult, and GameState.

The battle seed is frozen on `attackIntent.battleSeed` when the attack is
issued (command seed override, or `deriveBattleSeed` at that tick). Delayed
resolution does not re-hash from a later EventEngine `turn`.

No `Date.now()` / `Math.random()` in this path. Same-tick ready attacks:
army-id order.

---

## Intentionally deferred

- Multi-hop pathfinding
- Staging on allied/unowned land
- Marching into the target hex to fight
- Recruitment / split / merge / supply
- TRADE / OFFER_PEACE, cities, persistence, frontend, fitness
- Changing ActionScorer so AI “wants” one-hop attacks (scoring still
  uses bordering armies; execution supports one-hop when an ATTACK
  commitment or player command asks for it)

---

## Files

| File | Role |
| --- | --- |
| `src/army/strategicAttack.ts` | Shared operation, staging, intent |
| `src/orchestration/handlers.ts` | ATTACK / pending-arrival wrapper |
| `src/world/ContinuousWorldEngine.ts` | Invalidation + arrival coordination |
| `src/types/index.ts` | `StrategicAttackIntent` |
| `src/army/index.ts` | Re-exports |

CLI: `node dist/simulation/cli.js --attack-chain`
