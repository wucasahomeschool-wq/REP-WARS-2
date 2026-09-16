# Economy v1 — Implementation Plan

**Status:** Read-only engineering blueprint. Not an implementation.  
**Design authority:** `docs/ECONOMY_V1_SPEC.md`  
**Code hooks:** `docs/ECONOMY_DESIGN_SURFACE.md`  
**Current GameState schema:** `10`

Deferred (out of this plan): Roads gameplay, Market/trade, rebellion, population, P2P trade, advanced scaling curves.

---

## 1. Current architecture map

| Area | Current file / symbol | Responsibility today | Future (v1 core) | Change? |
|------|----------------------|----------------------|------------------|---------|
| GameState schema | `src/types/GameState.ts` `GAME_STATE_SCHEMA_VERSION` | Shape + schema 10 | Schema 11 + infra + food clock | **Yes** |
| Resources type | `src/types/index.ts` `Resources` | Five keys | Unchanged | No |
| WorldDefinition | `src/worldDefinition/types.ts` `resourceOutput` | Authored identity | Unchanged (no Farm in JSON) | No |
| Instantiate | `src/worldDefinition/instantiate.ts` | Seed economy, cities empty, `resourceIncome` sync | Seed infra map + food clock | **Yes** (defaults) |
| Production math | `src/gameplay/economy/production.ts` | Telescoping from `resourceOutput` | Same math; **caller** passes effective output | **Yes** (call sites) |
| Accrual | `src/gameplay/economy/accrual.ts` | Peek/persist uncollected | Use effective output | **Yes** |
| Collect | `src/gameplay/economy/collect.ts` | Collect + GY | Unchanged behavior | No (unless peek path) |
| resourceIncome | `src/gameplay/economy/resourceIncome.ts` | Sum raw `resourceOutput` | Sum **effective** output | **Yes** (Phase 5) |
| World tick economy | `src/gameplay/economy/worldProgress.ts` | Accrual + construction | + Food consume | **Yes** (Phase 3) |
| Ownership | `src/gameplay/economy/ownership.ts` | Forfeit, cancel, remove city, reset fort | + clear developments | **Yes** (Phase 5) |
| Economy config | `src/gameplay/economy/config.ts` | Cycle 60, keys | Food demand constants | **Yes** (Phase 3) |
| Construction defs | `src/gameplay/construction/definitions.ts` | CITY/FORT gold+stone | Full cost; FARM/MINE/LUMBER | **Yes** (2, 5) |
| Start/accelerate | `src/gameplay/construction/consume.ts` | Charge gold+stone; one in-progress | Charge all cost keys | **Yes** (Phase 2) |
| Complete | `src/gameplay/construction/complete.ts` | Dispatch `onComplete` | Unchanged pattern | Touch in Phase 5 via defs |
| Progress | `src/gameplay/construction/progress.ts` | Tick remaining | Unchanged | No |
| Cities | `src/gameplay/cities/city.ts` | ensure/remove/sync fort mirror | Unchanged core; combat reads `cities` | Phase 4 reads only |
| Fortification | `Territory.fortification` + defs | Leveled, city required | Same | Cost types Phase 2 |
| Gameplay config | `src/gameplay/config.ts` | City/fort numbers | + cityIron; farm costs | **Yes** |
| Rewards | `src/rewards/config.ts` `convertConstructionWorkers` | Acceleration | Unchanged purpose | No |
| Invasion defense | `src/gameplay/invasion/resolve.ts` | `defensePower` as virtual soldiers | Multiply by city/fort factor | **Yes** (Phase 4) |
| Combat | `src/battle/CombatPower.ts` `terrainAndFortToDefenseBonus` | Terrain + fort % | + City factor from one helper | **Yes** (Phase 4) |
| BattleEngine | `src/battle/BattleEngine.ts` | Uses CombatPower | Prefer **not** duplicate; pass via TerritoryLike | Minimal |
| Stability | `WarlordSnapshot.stability` | Event deltas | + Food fail −2 | **Yes** (Phase 3) |
| Events | `ConsequenceApplier` | Mutates `resourceOutput`, Stability | Unchanged; developments multiply **after** | No (compat Phase 5) |
| AI | `ActionScorer` `BUILD`/`REINFORCE` | Timed fort, garrison | Core: consume Food automatically (Phase 3). Collect/Farm/City **later** | Phase 7 wait |
| Commands | `START_CONSTRUCTION` `BUILD` `COLLECT` `ADVANCE_WORLD` | Existing | projectType + costs; Food in advance | Yes |
| Persistence | `src/persistence/versioning.ts` | Migrate to schema 10 | Schema 11 defaults | **Yes** |
| Analytics | `src/analytics/taxonomy.ts` observer | collect/spend/construction | New types | Phase 8 |
| Public view | `src/orchestration/publicView.ts` | resources, cities, uncollected | + developments | Phase 5 |
| Level 1 | `worlds/level-1.json` | Tutorial | Unchanged content; Food gated | Gate only |
| Balance | `src/constants/balance.ts` fort 0.03, reinforce | Combat/AI costs | Fort % stays; city factor not in BALANCE unless shared | Phase 4 helper |
| Invariants | `src/state/gameStateInvariants.ts` | One in-progress/tile | + infra, food clock | **Yes** |
| Clone | `src/state/cloneGameState.ts` | Deep clone | New maps/fields | **Yes** |

**Untouched by v1 core (intentional):** WorldDefinition schema, fitness evaluation, BattleEngine casualty formulas (except defense input), TRADE, Roads/Market commands, rebellion, Level 1 JSON, `GAME_REWARD_CONFIG` (Level 1).

---

## 2. Implementation phases

Adjusted slightly for dependencies:

| Phase | Name | Why this order |
|-------|------|----------------|
| **1** | State / schema foundations | Types, schema 11, empty defaults, migrate, clone, invariants. **No gameplay.** |
| **2** | Construction costs | `ConstructionCost` → all resource keys; City **Iron**; charge/report all keys. CITY/FORT only. |
| **3** | Food + Stability | Consume in `progressWorldEconomy`; Level 1 **gated**. |
| **4** | City/Fort combat + workout conversion | Single helper; CombatPower + invasion. Gate if Level 1 combat tests require it. |
| **5** | Farm / Mine / Lumber | Types, defs, effective output, conquest, public view. |
| **6** | Workout acceleration | **Verify only** — existing `APPLY_CONSTRUCTION_ACCELERATION` must work for new types; add tests, no new purpose. |
| **7** | AI economy | **Minimal:** do not rewrite scorer. Food already applies. Optional: later collect/CITY. **Default: skip behavior, document hooks.** |
| **8** | Analytics | New event types at mutation points. |
| **9** | Persistence hardening | Round-trip schema 11; catch-up Food + construction. |
| **10** | Level 1 regression | Tutorial green; Food still off. |

Phase 6 is tests-first because acceleration already exists. Phase 7 does **not** implement AI collect/Farm in the first economy delivery unless Phase 5 is stable and a follow-up is requested. Phase 8 can start as soon as mutation points exist (3–5) but should land after those mutations are stable.

---

## 3–4. Data model (Phase 1 fields)

Bump **`GAME_STATE_SCHEMA_VERSION` 10 → 11**.

### `GameState.lastFoodConsumptionTick`

| | |
|--|--|
| Type | `number` (int ≥ 0) |
| Required | yes after migrate |
| Default | `state.worldTick` at init/migrate (so enabling consume later does **not** back-charge) |
| Init | `instantiate` / `createLegacySampleMapGameState` = `worldTick` (0) |
| Mutation | Food consume pass |
| Persist | yes, authoritative |
| Derived? | no |

### `GameState.territoryInfrastructure`

| | |
|--|--|
| Type | `Map<TerritoryId, TerritoryInfrastructure>` |
| Required | yes (may be empty entries or missing tile = all false) |
| Default | empty map; missing tile = no developments |
| Init | seed empty for all territories (like `territoryEconomy`) **or** lazy-create |
| Mutation | Farm/Mine/Lumber complete; conquest clear |
| Persist | yes, authoritative |

```ts
interface TerritoryInfrastructure {
  territoryId: TerritoryId;
  farmCompletedAtTick: number | null;    // null = no Farm
  mineCompletedAtTick: number | null;
  lumberCompletedAtTick: number | null;
}
```

**Do not** add Road/Market fields now.

### `ConstructionProjectType`

Phase 1 may keep `'CITY' | 'FORTIFICATION'` only.  
Phase 5 adds `'FARM' | 'MINE' | 'LUMBER'`.  
Do **not** add ROAD/MARKET.

### `ConstructionCost` (Phase 2)

Replace `{ gold, stone }` with **`Partial<Resources>`** (or full `Resources` with zeros). Gold always required by spec for v1 buildings. Charge every present key in `startConstruction`.

### Existing (unchanged ownership)

| Field | Owner | Notes |
|--------|--------|------|
| `faction.resources` | WarlordSnapshot | Authoritative bank |
| `territoryEconomy` | GameState | Uncollected + lastAccrualTick |
| `Territory.resourceOutput` | Territory | Authored + **events only**; **not** Farm bake-in |
| `resourceIncome` | WarlordSnapshot | Derived from **effective** output after Phase 5 |
| `cities` | GameState | Binary city |
| `Territory.fortification` | Territory | Levels |
| `constructions` | GameState | One `in_progress` per territory (already invariant) |
| `stability` | WarlordSnapshot | Events + Food fail |

### `GAMEPLAY_CONFIG` (Phase 2 / 5) — INITIAL / TUNABLE

Add `cityIronCost: 40`. Add Farm/Mine/Lumber gold/wood/stone/duration. Keep existing City Gold/Stone/duration and Fort numbers.

---

## 5. Construction architecture

**Keep:** `START_CONSTRUCTION` → `startConstruction` → `ConstructionProject` → `progressConstruction` → `completeConstruction` → `definition.onComplete()`.  
**Keep:** `BUILD` = alias FORTIFICATION.  
**Keep:** one in-progress per territory (`consume.ts` + invariants).  
**Keep:** `consumeConstructionEffect` on explicit `constructionId`.

**Evolve `definitions.ts`:** each type declares `cost: Partial<Resources>`, `durationTicks`, `assertCanStart`, `onComplete`.

**Phase 2 `startConstruction`:** loop `RESOURCE_KEYS`, require `faction.resources[k] >= cost[k]`, subtract all, `recordAllResourceChanges`.

**Farm/Mine/Lumber `assertCanStart`:** owned tile; not already completed that development; not a second of that type. **Do not** require City. **Do not** require matching output > 0 (0 stays 0 after complete; wasting Gold is allowed).

**`onComplete`:** set `farmCompletedAtTick` etc.; `syncFactionResourceIncome` for owner.

**Conquest:** `ownership.ts` already cancels in-progress and removes city/fort. Add: reset that tile’s infrastructure to nulls.

**Workout:** no new purpose. Acceleration already targets `constructionId`.

**`migrateConstruction`:** today unknown `projectType` becomes `FORTIFICATION`. Phase 5 must **whitelist** FARM/MINE/LUMBER instead of coercing them to Fort.

---

## 6. Food system plan

**Live in:** `src/gameplay/economy/foodConsumption.ts` (new), called from `progressWorldEconomy` **after** accrual (order: persist accrual → **food** → constructions, or food after constructions; recommend **after accrual, before or after construction** — Food does not depend on construction. Use: accrual, food, construction).

**Clock:** `lastFoodConsumptionTick`.

**Telescoping (one pass, not per minute):**

```
cycle = ECONOMY_CONFIG.ticksPerProductionCycle  // 60
from = lastFoodConsumptionTick
to = state.worldTick
cycles = floor(to / cycle) - floor(from / cycle)
if cycles <= 0: return
if foodConsumptionDisabled(state): lastFoodConsumptionTick = to; return
for each cycle (or lump):  // lump is OK
  for each faction in allFactionIds:
    demand = faction.territories.length * FOOD_PER_TERRITORY  // 1
    paid = min(banked food, demand)
    food -= paid
    if paid < demand: food = 0; stability = max(0, stability - 2)
lastFoodConsumptionTick = to
```

**Lumping:** applying `cycles` at once with **current** territory counts is the approved catch-up approximation (same class as construction stamp catch-up). Chunked `ADVANCE_WORLD` (max 64 ticks) already refreshes ownership between chunks during long sync.

**Level 1 gate — LOCKED:** `state.worldLevel < 2` **or** `worldLevel === 1` → skip debit, **still advance the clock** so a later ungated world does not charge tutorial time.

**Ownership:** demand uses **current** `faction.territories.length` at consume time. No historical ledger.

**AI:** same function, all factions. No special case.

**Analytics:** one `resource.consumed` per faction per consume **pass** (or per cycle if cycles=1); `stability.changed` only when −2 applied. Not per world tick.

**Persistence:** field on GameState payload; migrate missing → `worldTick`.

---

## 7. City / Fortification combat plan

**One module:** `src/gameplay/defense/territoryDefense.ts` (new).

```ts
combatDefenseMultiplier(state, territoryId): number
  // cityless: 1.0
  // city: 1.25 * (1 + fort * 0.03)  OR city 1.25 and fort stays inside CombatPower
defenseWorkoutMultiplier(state, territoryId): number
  // cityless 1.0; city 1.5 + 0.1*fort, cap 2.0
```

**Prefer:** keep existing `terrainAndFortToDefenseBonus` for **terrain + fort %**. Apply **City 1.25** once in `computeDefenderPower` via `hasCity` on `TerritoryLike` **filled by the helper** so BattleEngine does not import GameState.

Callers that build `BattleInput`:

- `src/orchestration/applyBattle.ts` / attack path
- `src/gameplay/invasion/resolve.ts`

**Workout:** in `resolve.ts`, multiply stored `defensePower` by `defenseWorkoutMultiplier` **when assembling virtual defender**, not inside fitness conversion (keeps `GAME_REWARD_CONFIG` Level-1-stable).

**Do not** duplicate city checks in ActionScorer in Phase 4.

**Level 1 risk:** scripted 0-casualty capture may fail if defender gets 1.25×. **Mitigation:** if Level 1 tests fail, apply combat/workout multipliers only when `worldLevel >= 2`, matching spec §13. Prefer that gate over changing BattleEngine outcomes on the tutorial.

---

## 8. Resource development plan

**Representation:** `territoryInfrastructure` flags/ticks, **not** mutating `resourceOutput`.

**Production hook:** `effectiveResourceOutput(state, territory): Resources` in `src/gameplay/economy/effectiveOutput.ts`.

- Start from `territory.resourceOutput` (events already applied).
- If farm: `food = floor(food * 1.5)` or keep float until production floors — **use same floor as production.ts** (rating = floor(raw)).
- Mine: stone and iron ×1.5; lumber: wood ×1.5.
- Gold unchanged by developments.

**Accrual** `peekCollectibleResources` / `persistTerritoryAccrual` must use **effective** output.  
**Golden Yield** scales collected yield — unchanged.  
**Events** continue to mutate **base** `resourceOutput`. Compounding: event % on base, then development × — **do not** bake Farm into base.

**Duplicate prevention:** `assertCanStart` if `farmCompletedAtTick != null`.

**UI:** `serializePlayerGameplayView` / `publicTerritory` expose farm/mine/lumber booleans.

**Extensibility:** new development = new field + definition + multiplier in `effectiveResourceOutput`. No levels.

---

## 9. Resource production plan

**Unchanged pipeline.** Only the **rating** fed into `productionAccruedBetween` becomes effective output.

**resourceIncome:** Phase 5 `deriveFactionResourceIncome` sums effective output so AI scarcity matches collectible rates.

**Do not** auto-collect.

---

## 10. AI plan

| Capability | This economy delivery | Later |
|------------|----------------------|--------|
| Food consume + Stability | **Yes** (all factions, Phase 3) | — |
| Wait for construction timers | Already | — |
| Auto collect | No | Timer on ADVANCE or RESOLVE |
| START_CONSTRUCTION CITY/FARM | No | ActionType or reuse BUILD |
| Score Farm on food>0 tiles | No | ActionScorer |
| Fake workouts | **Never** | — |

Phase 7 **default: no AI scorer rewrite.** Exit = documented hooks + Food already running.

---

## 11. Orchestrator / commands

| Command | Now | Future | Phase | L1 |
|---------|-----|--------|-------|-----|
| `START_CONSTRUCTION` | CITY/FORT gold+stone | + iron; later FARM/MINE/LUMBER | 2, 5 | City still affordable (80 iron start, 40 cost) |
| `BUILD` | FORT alias | Same | — | Unchanged role |
| `COLLECT_RESOURCES` | Collect + GY | Unchanged; yield may include development | 5 | Keep |
| `REINFORCE` | Gold+Food | Unchanged | — | Keep |
| `ATTACK` | Battle | City multiplier if ungated | 4 | **Gate recommended** |
| `ADVANCE_WORLD` | economy progress | + Food | 3 | Food skipped |
| `SYNC_PLAYER_WORLD` | catch-up ADVANCE | Same | 3, 9 | Food skipped |
| `APPLY_CONSTRUCTION_ACCELERATION` | workers | Works for new types | 6 tests | Keep |
| `START_WORKOUT` / `FINALIZE_WORKOUT` | purposes | No new purpose | — | Keep |
| GET_GAME_STATE | public view | + infrastructure | 5 | Additive fields OK |

No Road/Market/Trade/Rebellion commands.

---

## 12. Persistence

- `GAME_STATE_SCHEMA_VERSION = 11`
- `migrateGameStatePayload`: if missing `lastFoodConsumptionTick` set to `worldTick`; if missing `territoryInfrastructure` empty Map; coerce Map
- `migrateConstruction`: do not wipe FARM types (Phase 5)
- Hydrate still requires current schema after migrate
- Offline: `progressWorldEconomy` already on catch-up; Food uses stamp math
- **No** Road/Market/rebellion persistence

Tests: `tests/persistence.ts` schema 10 → 11; clone isolation; catch-up Food when gated vs ungated.

---

## 13. Analytics

Extend `TELEMETRY_EVENT_TYPES` + `importanceFor` (do not duplicate names):

| Event | Emit from | Importance (proposal) |
|--------|-----------|------------------------|
| `resource.consumed` | Food pass | INFORMATIONAL |
| `stability.changed` | Food fail (events may already be coarse) | IMPORTANT |
| `city.founded` | CITY `onComplete` observer (or construction.completed + projectType) | IMPORTANT |
| `development.completed` | FARM/MINE/LUMBER complete | IMPORTANT |
| `building.destroyed` | `settleTerritoryOwnershipChange` | IMPORTANT |

Existing: collected, spent, GY, construction.*. Observer already maps `resourcesChanged`. Food consume must push `resourcesChanged` **or** emit directly from observer on ADVANCE_WORLD (prefer handler result / worldAdvance extras). ADVANCE_WORLD currently does not fill `resourcesChanged` for accrual — Food should attach to ADVANCE payload or observer scan (like construction.completed on tick). **Prefer:** Food function returns deltas; `handleAdvanceWorld` copies into `resourcesChanged` + events.

Avoid per-tick emit.

---

## 14. Level 1 safety

| Tutorial beat | Risk | Safeguard |
|---------------|------|-----------|
| First workout / Troops | Reward config | **Do not touch** `GAME_REWARD_CONFIG` |
| First attack | City 1.25× | Gate combat modifiers at `worldLevel < 2` until tests updated |
| Scripted invasion / defense | Workout multiplier | Same gate |
| Conquest / completion | Ownership + city destroy | Keep ownership path; infra empty |
| Food | Drain Stability | **Skip consume** on worldLevel 1; advance clock |
| City start | Iron cost 40 vs start 80 | Affordable; update tests that assume gold+stone only |
| New buildings | Required for win | **Not required** |

Regression: `tests/level1Production.ts`, `tests/orchestratorIntegration.ts` vertical slice, `tests/economyFoundation.ts`.

---

## 15. Test plan by phase

**Phase 1:** migrate schema 10→11; clone has new fields; invariants accept empty infra; **710+ existing tests still pass**; no Food/combat change.

**Phase 2:** CITY charges Gold+Stone+Iron; FORT Gold+Stone; `resourcesChanged` all keys; insufficient iron fails CITY; Level 1 still founds city if tests do; `economyCities` / `foundationHardening` / `run.ts` BUILD/CITY updated.

**Phase 3:** unit consume paid/fail/−2/clamp 0; lump N cycles; Level 1 worldLevel 1 **no debit**; AI faction debit on fixture worldLevel 2; catch-up 60/120 ticks.

**Phase 4:** helper unit tests; CombatPower with hasCity; invasion multiplies defensePower; Level 1 attack tests still pass **with gate**.

**Phase 5:** Farm ×1.5 food; Mine zeros stay 0; one Farm max; conquest clears; collect uses effective; GY still multiplies collection; resourceIncome includes effective.

**Phase 6:** accelerate FARM project; complete via workers.

**Phase 8–10:** taxonomy accepts new types; persistence round-trip infra + food clock; Level 1 full tutorial.

---

## 16. Risks

| Risk | Mitigation | Test |
|------|------------|------|
| Development baked into `resourceOutput` | Read-time `effectiveResourceOutput` only | Event % then Farm; conquest restores base rates |
| Food double-consume | Single stamp; skip if cycles≤0 | Catch-up twice no extra drain |
| Food back-charge after gate off | Clock advances while gated | Migrate lastFood=worldTick |
| Ownership mid-catch-up | Chunked ADVANCE + current count | Documented approximation |
| City combat duplicated | One `territoryDefense.ts` | Unit tests only that module’s numbers in combat/invasion |
| Acceleration wrong project | Existing constructionId | Phase 6 |
| City Iron breaks L1 | 40 < 80 start; update cost tests | level1 + economyCities |
| resourceIncome stale | Sync on complete + conquest (already on ownership) | After Farm, income food up |
| Event × Farm compound | Base mutated, then ×1.5 | drought then farm |
| migrateConstruction maps FARM→FORT | Fix whitelist Phase 5 | Persistence |
| Telemetry duplicate collect | Food uses `resource.consumed` not collected | Taxonomy |
| AI uses raw income | Fix derive Phase 5 | resourceIncome test |

---

## 17. Coding sequence (small prompts)

1. **Schema 11 + empty infra + food clock + clone/invariants/migrate** — no rules executed.  
2. **ConstructionCost + City Iron + charge all keys** — CITY/FORT only.  
3. **Food consume + Level 1 gate** in `progressWorldEconomy`.  
4. **territoryDefense helper + gated combat/workout** .  
5. **FARM/MINE/LUMBER defs + effective output + conquest**.  
6. **Acceleration tests** for new types.  
7. **Skip AI rewrite** (or tiny follow-up).  
8. **Analytics events**.  
9. **Persistence round-trip + catch-up**.  
10. **Level 1 regression sweep**.

Each prompt: implement, `npm test`, report, **stop**.

---

## 18. NEXT CODING PROMPT (Phase 1 only)

Copy-paste for the next session:

---

**Phase 1 — Economy v1 state/schema foundations only**

Implement **only** the data-model foundations for `docs/ECONOMY_V1_SPEC.md` / `docs/ECONOMY_V1_IMPLEMENTATION_PLAN.md` Phase 1.

**Do:**

1. Bump `GAME_STATE_SCHEMA_VERSION` from 10 to **11**.
2. Add `GameState.lastFoodConsumptionTick: number` (integer ≥ 0). Initialize to `worldTick` on new games (`instantiate.ts`, legacy `createGameState`).
3. Add `TerritoryInfrastructure` `{ territoryId, farmCompletedAtTick: number | null, mineCompletedAtTick: number | null, lumberCompletedAtTick: number | null }` and `GameState.territoryInfrastructure: Map<TerritoryId, TerritoryInfrastructure>`.
4. Seed empty infrastructure (or equivalent lazy-empty) alongside `seedTerritoryEconomy`. Do **not** create Farms.
5. Update `cloneGameState`, `gameStateInvariants` (valid ticks, map key = territoryId, null-or-nonneg completed ticks), `persistence/versioning.ts` migrate: missing clock → `worldTick`; missing map → empty Map; set schema 11.
6. Tests: new schema migration 10→11; clone isolation of the new map; invariants on empty state; **full `npm test` green**. Existing gameplay (collect, construction CITY/FORT, Level 1, Food not consumed) must be **behavior-identical**.

**Do not:**

- Implement Food consumption or Stability drain
- Change construction costs or add Iron to City
- Add FARM/MINE/LUMBER as startable `projectType`
- Change combat, invasions, workouts, rewards, Level 1 JSON, AI, analytics taxonomy
- Add Road/Market/rebellion/population fields
- Implement `effectiveResourceOutput`

**Exit criteria:** schema 11 round-trips; empty infra; food clock present but unused; all existing tests pass; short completion report (files, tests, anything skipped).

**Stop** when Phase 1 is done. Do not start Phase 2.

---

## Final report (this planning pass)

**Files inspected:** `ECONOMY_V1_SPEC.md`, `GameState.ts`, `construction/definitions.ts`, `consume.ts`, `worldProgress.ts`, `resourceIncome.ts`, `versioning.ts`, `gameStateInvariants.ts`, `CombatPower.ts`, `invasion/resolve.ts`, `analytics/taxonomy.ts`, `gameplay/config.ts`, `commandIndex.ts`, `level1Production.ts` (worldLevel).

**Proposed files to modify (full v1 core, not this pass):**  
`GameState.ts`, `cloneGameState.ts`, `gameStateInvariants.ts`, `versioning.ts`, `instantiate.ts`, `createGameState.ts`, `gameplay/index.ts`, `config.ts`, `construction/definitions.ts`, `consume.ts`, `economy/accrual.ts`, `resourceIncome.ts`, `ownership.ts`, `worldProgress.ts`, **new** `foodConsumption.ts`, `effectiveOutput.ts`, `defense/territoryDefense.ts`, `CombatPower.ts`, `invasion/resolve.ts`, `handlers.ts` / `gameplayCommands.ts`, `publicView.ts`, `commandIndex.ts`, `observer.ts`, `taxonomy.ts`, tests listed in §15.

**Tests run:** none.  
**Code changes:** none.

**Architecture contradictions:** none that block Phase 1. Known follow-through: `migrateConstruction` must not coerce FARM→FORT (Phase 5); City Iron vs tests that assume gold+stone (Phase 2); City 1.25× vs Level 1 scripted battles (Phase 4 — **gate on worldLevel**).

**Recommended Phase 1:** schema 11 + `lastFoodConsumptionTick` + `territoryInfrastructure` + clone/invariants/migrate only — no economy rules executed yet.
