# Economy & Construction — Design Surface

**Design authority for v1 rules:** [`docs/ECONOMY_V1_SPEC.md`](ECONOMY_V1_SPEC.md).

This document maps **where those rules plug into current code**. It does not override the v1 specification.

## Authoritative production path

```
WorldDefinition.territory.resourceOutput
  → GameState.territory.resourceOutput
  → lazy accrual (territoryEconomy.uncollected)
  → COLLECT_RESOURCES
  → WarlordSnapshot.resources
```

`WarlordSnapshot.resourceIncome` is a **derived rating** (sum of owned-tile **effective** output per 60-tick cycle) for AI scoring and event triggers. It is **not** a second production pipeline. See `src/gameplay/economy/resourceIncome.ts` and `effectiveResourceOutput`.

## Canonical construction path

```
START_CONSTRUCTION (or legacy BUILD alias)
  → startConstruction()
  → ConstructionProject (in_progress)
  → world time / ADVANCE_WORLD / catch-up
  → completeConstruction()
  → definition.onComplete()
```

Single configuration: `src/gameplay/construction/definitions.ts` (`getConstructionProjectDefinition`).

Legacy **`BUILD`** command and AI **`BUILD`** commitments call the same `startConstruction(..., FORTIFICATION)` path. Prefer **`START_CONSTRUCTION`** in new clients.

---

## Resource design surface

| Concern | Location |
|--------|----------|
| Resource keys (shape) | `Resources`, `RESOURCE_KEYS` in `src/gameplay/economy/config.ts` |
| Stored reserves | `GameState.factions[id].resources` |
| Uncollected yield | `GameState.territoryEconomy[id].uncollected` + lazy slice |
| Generation rate | `Territory.resourceOutput` + `ECONOMY_CONFIG.ticksPerProductionCycle` |
| Accrual math | `src/gameplay/economy/production.ts` |
| Collection | `collectTerritoryYield` / `COLLECT_RESOURCES` |
| Spend (today) | Construction definitions; `REINFORCE` via `BALANCE.economy.reinforcementCost` |
| Event modify reserves | `ConsequenceDelta.delta.resources` |
| Event modify tile output | `resourceOutputPct`, `foodProductionPct` on territory |
| Event modify income rating | faction-scoped `resourceOutputPct` → `resourceIncome` |
| AI use | `BUILD`/`REINFORCE` commitments; scoring via `resourceIncome` + `resources` |
| Persistence | Full `GameState` payload |
| Frontend | `serializePlayerGameplayView` (`resources`, `uncollected`, …) |
| Telemetry | `resource.collected` / `resource.spent` from `resourcesChanged`; Golden Yield extras |

### The five resources (purposes not decided)

| Key | Exists | Generated | Collected | Spent today | Purpose |
|-----|--------|-----------|-----------|-------------|---------|
| Gold | yes | tile output | yes | construction, reinforce | **TBD** |
| Food | yes | tile output | yes | reinforce | **TBD** |
| Iron | yes | tile output | yes | — | **TBD** |
| Wood | yes | tile output | yes | — | **TBD** |
| Stone | yes | tile output | yes | construction | **TBD** |

**Changing resource types later:** extend `Resources` + `RESOURCE_KEYS`, then audit `production.ts`, event deltas, rewards, persistence validation, public view, and analytics payloads together.

---

## Territory economy design surface

| Decision | Hook |
|----------|------|
| Base output per tile | World JSON `resourceOutput`; runtime `Territory.resourceOutput` |
| Production frequency | `ECONOMY_CONFIG.ticksPerProductionCycle` |
| Production formula | `productionAccruedBetween` |
| Tile modifiers (events) | `Territory.resourceOutput` mutations in `ConsequenceApplier` |
| Building modifiers | `effectiveResourceOutput` (`territoryInfrastructure` Farm/Mine/Lumber ×1.5 on matching keys) |
| Ownership | accrual only while `territory.owner` set; forfeit on conquest (`settleTerritoryOwnershipChange`) |
| Collection | `COLLECT_RESOURCES`; Golden Yield multiplies one collection via `pendingGoldenYieldEffects` |
| Golden Yield curve | `GAME_REWARD_CONFIG` + `applyGameReward` |

---

## Building / construction design surface

| Decision | Hook |
|----------|------|
| Project types | `ConstructionProjectType`; register in `definitions.ts` |
| Cost / duration | `ConstructionProjectDefinition` per type |
| Start prerequisites | `definition.assertCanStart` |
| Completion effects | `definition.onComplete` |
| Progress / offline | `progressConstruction`, `progressWorldEconomy`, `lastProgressTick` |
| One project per tile | enforced in `startConstruction` |
| Workout acceleration | `APPLY_CONSTRUCTION_ACCELERATION` / `pendingConstructionEffects` |

Current types: **`CITY`**, **`FORTIFICATION`**, **`FARM`**, **`MINE`**, **`LUMBER`**.

### Adding a future project type (e.g. ROAD, MARKET)

1. Add literal to `ConstructionProjectType`.
2. Add `ConstructionProjectDefinition` entry (cost, duration, assertCanStart, onComplete).
3. Expose via `START_CONSTRUCTION` `projectType` (command already passes through).
4. Add completion telemetry (see Analytics).
5. Do **not** duplicate instant commands — one timed pipeline.

---

## City design surface

| Future meaning | Hook |
|----------------|------|
| Representation | `GameState.cities` (`City` + optional `buildings[]`) |
| Founding | `CITY` project `onComplete` → `ensureCity` |
| Economic effects | **None today** — add in `onComplete` or accrual modifier |
| Defensive effects | `src/gameplay/defense/territoryDefense.ts` → CombatPower City 1.25× (gated `worldLevel >= 2`). **Not** duplicated in ActionScorer. |
| Population | `Territory.population` (events); not city-gated |
| Unlocks | **None** — gate in `assertCanStart` or new systems |
| Upgrades | **None** — new project types or city level field |
| Security | **Not modeled** |
| Conquest | `removeCity` in `settleTerritoryOwnershipChange` |

---

## Fortification design surface

| Decision | Hook |
|----------|------|
| Defensive strength | `Territory.fortification` → `CombatPower` / `BALANCE.combat.fortificationPerLevelBonus` |
| Max level | `GAMEPLAY_CONFIG.maxFortificationLevel` |
| Cost / duration | `FORTIFICATION` entry in `definitions.ts` |
| City prerequisite | `FORTIFICATION.assertCanStart` |
| Upgrade | repeat `FORTIFICATION` project (+1 on complete) |
| Destruction | reset to 0 on conquest |
| Battle | `BattleEngine` / defender init uses territory fort + garrison |
| City mirror | `syncCityFortification` (display/structure only) |

---

## Economic health / stability

**EXISTING STATE — NOT FINALIZED GAME DESIGN**

| Item | Location |
|------|----------|
| Stability | `WarlordSnapshot.stability` (0–100) |
| Modifiers | Event `stabilityDelta` in `ConsequenceApplier` |
| Gameplay effect today | Failed Food cycle −2 Stability (`consumeEmpireFood`, all factions, gated `worldLevel < 2`) |
| Population | `Territory.population`; event deltas |
| Future empire health | integrate via new faction fields + tick hooks alongside `progressWorldEconomy` or event turn |

---

## AI economy (Phase 7)

**v1 delivery: no ActionScorer / personality rewrite.** Food already runs for every faction. Collect, City founding, and developments are **hooks for later**, not this phase.

### Already running (do not reimplement)

| Behavior | Where |
|----------|--------|
| Food consume + Stability −2 on fail | `consumeEmpireFood` via `progressWorldEconomy` (all `allFactionIds`) |
| Wait out construction timers | `progressAllConstructions` on `ADVANCE_WORLD` / catch-up; AI has no workouts |
| Timed fortification | AI `BUILD` commitment → `handleBuild` → `startConstruction(..., FORTIFICATION)` |
| Garrison | AI `REINFORCE` → `handleReinforce` + `BALANCE.economy.reinforcementCost` |
| Scarcity rating matches collectible rates | `deriveFactionResourceIncome` sums `effectiveResourceOutput` |
| Construction wait / no-op turn | executable `WAIT` |

### Explicitly not in this delivery

| Capability | Status | Later hook |
|------------|--------|------------|
| Auto-collect | **No.** Player `COLLECT_RESOURCES` only. Uncollected stays on the tile. | Timer on `ADVANCE_WORLD` or `RESOLVE_COMMITMENT`; **do not** change the player collect loop |
| `START_CONSTRUCTION` CITY / FARM / MINE / LUMBER from AI | **No.** `BUILD` stays FORTIFICATION. | New `ActionType` **or** reuse BUILD with `projectType`; register in `EXECUTABLE_COMMITMENT_ACTIONS` + `handleResolveCommitment` |
| Score Farm only on food>0 (and Mine/Lumber on matching output>0) | **No.** | `ActionScorer` + `Territory.resourceOutput` (authored base, not effective) |
| Found Cities from threat | **No.** Combat already reads `cities`; scorer does not. | `scoreBuild` / new CITY action; still no fake workouts |
| Fake workout currency | **Never.** | — |
| TRADE / Roads / Markets | Deferred with Market trade | `UNSUPPORTED_COMMITMENT_ACTIONS` already holds `TRADE` |

### Extension points (when a follow-up is requested)

1. **Collect:** internal AI schedule calling `collectTerritoryYield` — not a player command change.
2. **Projects:** `startConstruction` already accepts `FARM`/`MINE`/`LUMBER`/`CITY` for any faction that owns the tile and can pay.
3. **Scoring:** `ActionScorer.scoreBuild` / `ScoringHelpers.evaluateResourceNeed` (`resources` + `resourceIncome`).
4. **Execution:** `src/engine/executableActions.ts` + `handleResolveCommitment` switch in `src/orchestration/handlers.ts`.
5. **Stability care:** Food already mutates `WarlordSnapshot.stability`; a later scorer may read it. No second empire-health variable.

See `docs/ECONOMY_V1_SPEC.md` §11.

---

## Event economy extension

### Working effects (`ConsequenceApplier`)

- `resources`, `resourceOutputPct` (territory vs faction scope), `foodProductionPct`
- `stabilityDelta`, `populationDelta*`, `garrisonDeltaAbs`
- `moraleDeltaArmy` (when armies map provided)
- `relationshipDeltaOpinion`, choice `cost`

### Defined but unused (do not treat as live)

- `infrastructureDeltaPct` — no infrastructure stat
- `moraleDeltaGarrison` — no garrison morale field

Marked in `src/events/EventModel.ts` and `docs/EVENT_ENGINE_CORRECTNESS.md`.

---

## Analytics extension

| Event | Emit from | Status |
|-------|-----------|--------|
| `resource.collected` / `resource.spent` | `emitResourceChanges` / COLLECT observer | Live. Spent covers BUILD, REINFORCE, and START_CONSTRUCTION. |
| `resource.consumed` | ADVANCE_WORLD and SYNC_PLAYER_WORLD Food pass (`payload.foodConsumption`) | Live. Not collected/spent. No per-tick accrual telemetry. |
| `resource.golden_yield_used` | COLLECT observer | Live |
| `construction.started` / `accelerated` / `completed` | START_CONSTRUCTION, BUILD alias, ADVANCE scan, acceleration | Live |
| `city.founded` | CITY complete (beside `construction.completed`) | Live |
| `development.completed` | FARM / MINE / LUMBER complete | Live |
| `building.destroyed` | Conquest settlement GameEvent (`data.buildingDestroyed`) | Live when city/fort/dev/in-progress existed |
| `stability.changed` | Food fail −2 (actual Stability change only) | Live for Food. Imperial event deltas stay on `imperial.event_triggered`. |
| `market.trade` | Markets | **Deferred** |
| `rebellion.*` | Rebellion | **Deferred** |

Canonical observer: `src/analytics/observer.ts`. Taxonomy: `src/analytics/taxonomy.ts`.

Do not emit ordinary passive accrual per world tick.

---

## Frontend extension

| UI need | Source |
|---------|--------|
| Balances | `playerGameplay.resources` |
| Per-tile collectible | `playerGameplay.uncollected` |
| Production rates | `GET_VISIBLE_WORLD` → `territory.resourceOutput` |
| Cities / buildings | `playerGameplay.cities` |
| Construction | `playerGameplay.constructions` + `displayedRemainingTicks` |
| Fort / garrison | territory overlay `fortification`, `garrison` |
| Golden Yield pending | `playerGameplay.pendingGoldenYieldEffects` |
| Events | `activeEventCount`; detail TBD |

---

## Related files (cleanup baseline)

- `src/gameplay/construction/definitions.ts` — project config
- `src/gameplay/construction/consume.ts` — start / accelerate
- `src/gameplay/construction/complete.ts` — completion dispatch
- `src/gameplay/economy/*` — accrual, collect, income derivation, Food consume, effective output
- `src/gameplay/defense/territoryDefense.ts` — City combat (not AI scoring)
- `src/orchestration/gameplayCommands.ts` — player economy commands
- `src/orchestration/handlers.ts` — `BUILD` alias, `REINFORCE`, world advance, `RESOLVE_COMMITMENT`
- `src/engine/executableActions.ts` — which AI commitments can execute
- `src/scoring/ActionScorer.ts` — BUILD/REINFORCE scoring (fort/garrison only in v1)
