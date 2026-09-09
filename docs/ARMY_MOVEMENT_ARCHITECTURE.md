# Army movement architecture (Phase 14)

Phase 14 replaces Phase 13’s placeholder MOVE duration with adjacent-only
army travel over **world ticks**. Armies are entities distinct from
territory ownership. Player and AI use the same domain operation.

```
AI/player command
      ↓
Orchestrator
      ↓
beginArmyMovement (shared domain operation)
      ↓
GameState (army.movement status = moving; location still origin)
      ↓
ContinuousWorldEngine (each worldTick)
      ↓
progressArmyMovements
      ↓
arrival / interruption → GameState update
```

No persistence, frontend, cities, recruitment, supply lines, TRADE,
OFFER_PEACE, BattleEngine redesign, battlefield retreat, global turns,
or wall-clock waits.

---

## Army location

Canonical type: `Army` in `src/types/index.ts` (schema version 4 includes
`attackIntent`; movement itself landed in version 3).

| Field | Role |
| --- | --- |
| `owner` | Faction that owns the army during movement |
| `location` | Current territory. **Stays at origin until arrival.** |
| troops / `morale` / `supply` | Unchanged this phase |
| `movement` | `null` / omitted = stationary; otherwise in-transit state |
| `attackIntent` | Phase 15 pending strategic attack; `null` / omitted = none |

There is one army map: `GameState.armies`. No duplicate “stack”, hex, or
coordinate model.

Territory ownership is independent: an army leaving a tile does **not**
change `Territory.owner`. Conquest still follows BattleEngine /
`applyBattle`; it does not delete unrelated armies.

---

## Movement state

```ts
interface ArmyMovement {
  originTerritoryId: TerritoryId;
  destinationTerritoryId: TerritoryId;
  startedAtTick: number;
  durationTicks: number;
  status: 'moving' | 'arrived' | 'interrupted' | 'cancelled';
  commitmentId: string | null; // AI MOVE/RETREAT; null for player MOVE
}
```

While marching, `status` on the army is always `'moving'` and
`location === originTerritoryId`.

On **arrival**, `location` becomes the destination and `movement` is
cleared (`null`). The tick result records `arrived`.

On **interrupt** (missing dest/origin, lost adjacency, missing owner
faction), `movement` is cleared; the army stays at origin. Linked AI
commitments are interrupted, not left active.

`'cancelled'` is reserved; this phase rejects duplicate MOVE instead of
cancelling an existing march.

---

## Movement duration

Isolated, deterministic function: `calculateMovementDuration` in
`src/army/movement.ts`.

```
duration = max(minTicks, adjacentBaseTicks + destinationTerrainTicks[dest.terrain])
```

Tunable values live in `BALANCE.movement`:

- `adjacentBaseTicks`: `2`
- `minTicks`: `1`
- `destinationTerrainTicks`: plains/coastal `0`, most other terrains `1`,
  mountain `2`

Origin is accepted in the API for a stable signature; this phase does
not add origin-terrain cost or multi-hop pathfinding. **Adjacent
territories only** (`Territory.neighboring` / `isAdjacent`).

No `Date.now()`, `Math.random()`, or real-world timers.

---

## MOVE command

`MOVE` is immediate: it **starts** a march and returns. It does not
advance `worldTick` and does not wait for arrival.

Validation (existing error codes):

- army exists (`INVALID_ARMY`)
- army belongs to the acting faction (`ACTION_NOT_ALLOWED`)
- destination exists (`INVALID_TERRITORY`)
- destination ≠ current location (`ACTION_NOT_ALLOWED`)
- destination is adjacent (`NOT_ADJACENT`)
- army is not already moving (`ACTION_NOT_ALLOWED`)

Success writes `Army.movement` with `startedAtTick = GameState.worldTick`.

Implementation: `handleMove` → `beginArmyMovement`. Mutations stay inside
the Orchestrator transaction.

---

## Player vs AI (shared operation)

AI `MOVE` and strategic `RETREAT` call the same `handleMove` /
`beginArmyMovement` path. There is no AI-specific travel formula.

`BALANCE.world.commitmentDurationTicks.MOVE` and `.RETREAT` are `0` so
`RESOLVE_COMMITMENT` **starts** the march the same tick the commitment
becomes ready. Travel time is `Army.movement.durationTicks`, not the
commitment placeholder table.

While the army is in transit:

- commitment status stays `executing` (`payload.arrivalPending`)
- ContinuousWorldEngine **does not** call `AI_DECIDE` or re-resolve
- `ticksRemaining` for progress records uses army movement remaining

On arrival, the host `completeCommitment`s. If the army is destroyed or
the march is interrupted, the commitment is failed or interrupted.
Orphan `executing` MOVE/RETREAT with no marching army cannot stay active.

Idempotent: a second `RESOLVE_COMMITMENT` while in flight returns
`arrivalPending` and does not start a second march.

---

## ContinuousWorldEngine

Each world tick, **after** the optional EventEngine step and **before**
AI faction steps:

1. `progressArmyMovements(state, worldTick)` in **sorted army id** order
2. complete / interrupt linked commitments from those results
3. AI factions (skip MOVE/RETREAT that are in flight)
4. fail orphan executing MOVE/RETREAT with no marching army

Player MOVE has `commitmentId: null`; CWE still moves the army but does
not touch player commitments.

Zero-elapsed `ADVANCE_WORLD` is still a no-op (`movementResults: []`).

---

## Relationship to BattleEngine

BattleEngine is unchanged. Strategic MOVE is not battlefield retreat.

**Attack rule this phase:** an army **cannot ATTACK until it has
arrived** (`isArmyMoving` armies are excluded from the attacking set).
If the only bordering eligible force is in transit, ATTACK fails with
`ACTION_NOT_ALLOWED`.

### Limitation (closed in Phase 15)

Phase 14 ATTACK used armies standing on tiles that **border** the
target. Phase 15 keeps combat **from a legal attacker-owned staging
tile** and adds a **one-hop MOVE → ATTACK** chain. See
`docs/STRATEGIC_ATTACK_ARCHITECTURE.md`. Armies still do not travel
*into* the enemy hex before BattleEngine resolves the fight.

A moving army’s `location` remains the origin, so it can still be
**defended against** if that origin is attacked.

Defeated armies are eliminated by existing BattleEngine / `applyBattle`
rules (no-retreat). Unrelated armies are not deleted by conquest.

---

## Strategic MOVE vs battlefield retreat

| | Strategic MOVE / RETREAT | Battle |
| --- | --- | --- |
| What it is | Territory-to-territory march over world ticks | Immediate BattleEngine resolution |
| Survivors on loss | N/A | Losing side remaining troops = 0; army removed |
| Can abort a fight | No | No retreat field, no withdraw |

AI `RETREAT` still means “walk off non-owned ground onto adjacent owned
ground” via `handleMove`, never BattleEngine.

---

## Determinism

Identical `GameState` + `worldSeed` + commands + elapsed world time ⇒
equivalent movement. Multiple moving armies are processed in army-id
sort order.

---

## Intentionally deferred

- Multi-hop pathfinding
- Geographic / hex coordinates
- Recruitment, splitting, merging
- Supply lines, attrition, detailed logistics
- Movement cancellation command (duplicate MOVE is rejected)
- TRADE / OFFER_PEACE, cities, persistence, frontend, fitness
- Real-world wait timers or globally turn-based player play

Phase 15 added a one-hop MOVE → ATTACK chain from a legal staging tile
(`docs/STRATEGIC_ATTACK_ARCHITECTURE.md`). Multi-hop attack pathfinding
is still deferred.

---

## Files

| File | Role |
| --- | --- |
| `src/army/movement.ts` | Duration, begin march, tick progress |
| `src/constants/balance.ts` | `BALANCE.movement` |
| `src/orchestration/handlers.ts` | MOVE / AI MOVE / RETREAT / ATTACK filter |
| `src/world/ContinuousWorldEngine.ts` | Tick integration |
| `src/types/index.ts` | `Army.movement` / `ArmyMovement` |

CLI demo: `npx ts-node src/simulation/cli.ts --move` (after build:
`node dist/simulation/cli.js --move`). The demo only calls Orchestrator
`MOVE` + `ADVANCE_WORLD`.
