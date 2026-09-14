# Phase 17N.1 — World / Map Implementation-Readiness Plan

**Status:** planning only. Do not implement this document in 17N.1. Do not build the Map Assistant. Do not start a numbered Phase 18/19 from this file.

**Authoritative inputs:** `docs/phase-17m-world-map-spec.md` (including 17M.1 hierarchy lock), the current repository, and the external architectural audit summarized in the 17N.1 brief.

**Current repo (verified at plan time):** 643 tests passing; GameState schema **8**; production default world is `SAMPLE_MAP` + `WARLORD_SPECS` via `createGameState()`.

---

## 1. Target architecture

```
Authoritative World JSON  (rep-wars-world.v1 file; editor export)
        ↓
WorldDefinition           (typed in-memory document; immutable content)
        ↓
World Loader / Validator  (fail closed; no invented geography)
        ↓
World Runtime Initialization
        ↓
GameState                 (mutable run overlay)
        ↓
Orchestrator / AI / Battle / Economy / Cities / Invasions / Fitness / Rewards
```

Geometry lives in the WorldDefinition catalog. Combat, economy, AI, and persistence consume **IDs + mutable overlay**, not a second invented map.

### Layer responsibilities

| Layer | Owns | Must not do |
| --- | --- | --- |
| **World JSON** | Island polygon, region names/membership, territory polygons, explicit `neighborIds`, starting owners, per-world factions + personality vectors, `containedWorlds` (history/render), completion predicate | Runtime clocks, cities, armies-after-spawn, fog, invented adjacency |
| **WorldDefinition** | Same data as JSON after parse | Mutation during play |
| **Loader / Validator** | Parse, §13 checks (identity, geometry, reciprocal adjacency, connected dual graph, Level 1 owner rules), reject invalid files | “Fix” graphs, auto-split owners, generate tiles |
| **Runtime initialization** | Copy starting overlay into `GameState`; spawn starting armies from faction records; empty `cities`; empty intra-world visibility | Call `MapEngine.generateInitialWorld`; `ensureCity` for every owned tile; allocate leftover land |
| **GameState** | Owners, armies, garrisons, fortification, cities, constructions, economy clocks, invasions, fitness, rewards, AI commitments/memory/goals, `worldTick` | Polygons as a second authority; nested Level N tiles as combat tiles |
| **Orchestrator + engines** | Commands, battles, AI decisions, economy, invasions, workouts | Invent neighbors, owners, personality rosters, or geography |

Renderer (future UI) reads **WorldDefinition geometry + GameState overlay**. It does not tessellate hexes.

### What World JSON owns vs GameState

**World JSON / WorldDefinition (content, immutable for a run):** `worldId`, `level`, world/region names, island, territory IDs + polygons + `neighborIds` + `regionId` + `startingOwnerFactionId` + `terrain` + `resourceOutput`, factions (ids, names, homes, starting resources/armies, AI personalities), optional `startingDiplomacy`, `containedWorlds` + `placement`, `completion`.

**GameState (mutable run):** `worldTick` / `turn`, current `Territory.owner` (initialized from starting owner), armies, `cities`, constructions, `territoryEconomy`, fortification/garrison after play, invasions, fitness, rewards, pause, commitments, memory, evolving diplomacy, `playerFactionId`, persistence `stateVersion` (envelope).

**Do not copy into GameState every tick:** polygons, island rings, editor hints, nested-world full graphs, personality *documents* beyond the runtime `Personality` already on `WarlordSnapshot`.

**17M.1 hierarchy:** one playable graph per current file. `containedWorlds` are nested geography/history. Never concatenate child `territories[]` into the parent combat graph.

---

## 2. Exact file-by-file audit

Classification is exclusive: **KEEP** | **MODIFY** | **REPLACE** | **DELETE** | **TEMPORARY TEST FIXTURE** | **DEFER**.

KEEP means retain behavior and path through migration (adapt call sites elsewhere if types change). MODIFY means this file’s logic or types must change for the new world. REPLACE means the file’s *role* survives under a new module. DELETE means remove after the replacement path is live. TEMPORARY TEST FIXTURE means keep only to avoid a big-bang test rewrite, then stop using it as production. DEFER means later phase (Map Assistant, Supabase live, world-progression UX).

### 2.1 `src/map/**`

| Path | Class | Why |
| --- | --- | --- |
| `src/map/MapEngine.ts` | **DELETE** (after dual-path retired) | Hex `HEX_DIRS`/`hexDist`, `generateInitialWorld`, frontier expansion, `NamingSystem`, fog `revealTerritories`. Production authority today for procedural worlds; 17M forbids this as source of truth. |
| `src/map/NamingSystem.ts` | **DELETE** | Territory display names. Regions are named by authors. |
| `src/map/Themes.ts` | **DELETE** as generator input | Theme libraries drive procedural fabricator. Flavor text may be copied into docs later; not required in v1 JSON. |
| `src/map/graphInvariants.ts` | **KEEP** then **MODIFY** | `collectNeighborGraphIssues` is the right reciprocal-neighbor idea. Extend with connected-component + (in validator, not runtime) shared-edge checks. Do not delete with MapEngine. |

**Dependents of MapEngine (must change when deleted):** `src/orchestration/engineRegistry.ts` (`registerMap` / `createDefaultRegistry` constructs `new MapEngine()`), `src/orchestration/handlers.ts` (`handleScout` → `requireMap().revealTerritories`), `src/index.ts` re-exports, `src/simulation/mapDemo.ts`, `tests/run.ts` (`generateInitialWorld`, `runMapValidationTests`).

### 2.2 `src/state/**`

| Path | Class | Why |
| --- | --- | --- |
| `src/state/createGameState.ts` | **MODIFY** | Defaults `SAMPLE_MAP`/`WARLORD_SPECS`; always `seedEconomyAndCities` (cities at spawn). Add `createGameStateFromWorld` / switch default later. |
| `src/state/cloneGameState.ts` | **MODIFY** | Clones `mapWorld.graphMeta.coordToTerritory` / `territoryPos` and `PlayerVisibilityMap`. Drop those maps when types drop. |
| `src/state/gameStateInvariants.ts` | **MODIFY** | Neighbor checks via `graphInvariants` stay. Add region bijection / worldId presence once fields exist. Stop requiring mapWorld hex meta. |
| `src/state/gameStateAdapters.ts` | **MODIFY** | Territory/battle adapters pass `name`/`isCapital`. Region name + seat/city instead. |
| `src/state/index.ts` | **KEEP** | Barrel; follows create/clone/invariants. |

### 2.3 `src/types/**`

| Path | Class | Why |
| --- | --- | --- |
| `src/types/index.ts` | **MODIFY** | `Territory.name`, `isCapital`, `isKnown`, `scoutedTurnsAgo`; `ActionType` includes `SCOUT`; `VisibilityState` / `PlayerVisibilityMap` / `MapWorldState` hex meta; `MapTerritorySpec.name`; `Region` hex-era fields (`centerTerritoryId`, `themeId`, `isCapitalRegion`). |
| `src/types/GameState.ts` | **MODIFY** | `mapWorld`, `visibility`; `cities` comment “one city per owned territory”; no `worldId`/`level` content pointer. Schema bump when Territory/world identity changes. |

### 2.4 `src/simulation/**`

| Path | Class | Why |
| --- | --- | --- |
| `src/simulation/SampleMap.ts` | **TEMPORARY TEST FIXTURE** | Named hex-era tiles, `isCapital`, mixed unowned land, global `WARLORD_SPECS` presets, `isKnown: true` on build. Not the production world. Keep until `createGameStateFromWorld` + tiny JSON cover tests. |
| `src/simulation/mapDemo.ts` | **DELETE** | Entire file is procedural MapEngine + scout demos. `tests/run.ts` imports `runMapValidationTests`. |
| `src/simulation/cli.ts` | **MODIFY** | Prints `t.name` / capital stars; boots SAMPLE_MAP; SCOUT case updates `knownTerritories`. |
| `src/simulation/eventSimulation.ts` | **MODIFY** | SAMPLE_MAP boot; prints territory names. |
| `src/simulation/longRunHarness.ts` | **MODIFY** | SAMPLE_MAP / warlord specs. |
| `src/simulation/battleTests.ts` | **KEEP** (fixtures) | Battle unit tests; drop `isCapital` when CombatPower retargets. |
| `src/simulation/battleStressTests.ts` | **KEEP** | Same; `isCapital` fixtures. |

### 2.5 `src/orchestration/**`

| Path | Class | Why |
| --- | --- | --- |
| `src/orchestration/orchestrator.ts` | **KEEP** | Command boundary. Scout/map registry fall out of handlers/registry. |
| `src/orchestration/engineRegistry.ts` | **MODIFY** | Stops requiring MapEngine as a production engine. |
| `src/orchestration/commandIndex.ts` | **MODIFY** | Remove `SCOUT`; retarget `GET_VISIBLE_WORLD`; drop fog parameters. |
| `src/orchestration/handlers.ts` | **MODIFY** | `handleScout`, EXPAND+`settleTerritoryOwnershipChange`, territory `.name` summaries. |
| `src/orchestration/publicView.ts` | **MODIFY** | `visibilityOf` / `fogTerritory` / garrison hiding. Current world = full view; no territory names. |
| `src/orchestration/applyBattle.ts` | **MODIFY** | Conquest → `settleTerritoryOwnershipChange` (city inherit); `territory.name` in memory. |
| `src/orchestration/applyEvents.ts` | **MODIFY** | Event summaries use `t.name`. |
| `src/orchestration/helpers.ts` | **KEEP** | `isAdjacent` already reads `Territory.neighboring` (explicit graph). Rename field later to `neighborIds` if desired. |
| `src/orchestration/errors.ts` | **MODIFY** | `FOG_OF_WAR` unused for intra-world tiles; keep only if reused for “next world locked.” |
| `src/orchestration/router.ts` | **MODIFY** | Drop SCOUT route with catalog. |
| `src/orchestration/gameplayCommands.ts` | **KEEP** | Fitness/construction/collect wiring; city rule via construction/economy. |
| `src/orchestration/authorization.ts` | **KEEP** | Player vs AI faction gating. |
| `src/orchestration/transaction.ts` | **KEEP** | |
| `src/orchestration/trace.ts` | **KEEP** | |
| `src/orchestration/protocol.ts` | **KEEP** | DTOs; display strings change at producers. |
| `src/orchestration/gameState.ts` | **KEEP** | Thin GameState helpers if still used. |
| `src/orchestration/index.ts` | **KEEP** | Barrel. |

### 2.6 `src/engine/**` and AI scoring/goals/personality

| Path | Class | Why |
| --- | --- | --- |
| `src/engine/DecisionEngine.ts` | **KEEP** core; **MODIFY** catalog | `SCOUT` in action lists; `knownTerritories` currently unused in decide() (`void knownTerritories`). Preserve decide/commitment loop. |
| `src/engine/executableActions.ts` | **MODIFY** | Remove `'SCOUT'`. |
| `src/engine/feasibility.ts` | **KEEP** | |
| `src/engine/outcomeFeedback.ts` | **KEEP** | Mentions SCOUT as non-goal-moving; drop when SCOUT gone. |
| `src/scoring/ActionScorer.ts` | **MODIFY** | `scoreScout`; `t.name`; `isCapital` bonuses throughout. |
| `src/personality/PersonalitySystem.ts` | **MODIFY** | Add `fromTraits` (world JSON). Keep presets as editor/compat only. Remove `SCOUT: 'opportunism'` bias. |
| `src/goals/GoalSystem.ts` | **MODIFY** | `control_region` cannot align on membership today (no `regionId`). Wire real regions. |
| `src/memory/MemorySystem.ts` | **KEEP** | Details currently store territory names; store id + region name at write sites. |

### 2.7 `src/battle/**` and `src/army/**`

| Path | Class | Why |
| --- | --- | --- |
| `src/battle/BattleEngine.ts` | **KEEP** math; **MODIFY** display/capital | Uses `input.territory.name` and `isCapital` for copy and capture threshold. Adapter supplies region label + seat/city flag. |
| `src/battle/CombatPower.ts` | **MODIFY** | `territory.isCapital` defense multiplier → seat-with-city (see §11). |
| `src/army/movement.ts` | **KEEP** | Adjacent-hop via `isAdjacent` / `neighboring`. No hex. |
| `src/army/strategicAttack.ts` | **MODIFY** | `assertPlayerCanSeeTarget`; `target.name` in events. Staging still adjacency. |
| `src/army/index.ts` | **KEEP** | |

### 2.8 `src/gameplay/**`

| Path | Class | Why |
| --- | --- | --- |
| `src/gameplay/economy/seed.ts` | **MODIFY** | `ensureCity` for every owned tile at spawn. **Violates** no-cities-at-creation. Keep economy record seeding. |
| `src/gameplay/economy/ownership.ts` | **MODIFY** | `ensureCity` for conqueror. **Violates** destroy-city-on-conquest. Must `removeCity` always, never recreate for new owner. |
| `src/gameplay/economy/accrual.ts` | **KEEP** | Production from `resourceOutput`. Independent of cities if we keep yield-on-owned-land (confirm: Prototype 1 accrues without requiring a city). |
| `src/gameplay/economy/production.ts` | **KEEP** | |
| `src/gameplay/economy/collect.ts` | **KEEP** | |
| `src/gameplay/economy/config.ts` | **KEEP** | |
| `src/gameplay/economy/worldProgress.ts` | **KEEP** | |
| `src/gameplay/cities/city.ts` | **MODIFY** | `ensureCity` remains for **explicit construction**. Comments “one city per owned territory” become false. |
| `src/gameplay/construction/consume.ts` | **MODIFY** | `startConstruction` calls `ensureCity` immediately for FORTIFICATION-only projects. Align with explicit city founding (§7). |
| `src/gameplay/construction/complete.ts` | **MODIFY** | `ensureCity` on complete — OK for city project; fortification should require existing city. |
| `src/gameplay/construction/progress.ts` | **KEEP** | |
| `src/gameplay/attacks/visibility.ts` | **DELETE** | Player ATTACK fog gate. Entire current world is visible. |
| `src/gameplay/attacks/commitBankedTroops.ts` | **KEEP** | |
| `src/gameplay/invasion/**` | **KEEP** | Invasion copy uses `target.name` in `create.ts` — **MODIFY** that one string to region name. |
| `src/gameplay/config.ts` | **KEEP** | |
| `src/gameplay/index.ts` | **MODIFY** | Stop exporting scout/visibility helpers when removed. |

### 2.9 `src/events/**`

| Path | Class | Why |
| --- | --- | --- |
| `src/events/WorldSimulator.ts` | **KEEP**; **MODIFY** copy | Mutates `population` (runtime). Location is territory id, not hex. |
| `src/events/EventDefinitions.ts` | **KEEP** | Population deltas; location ids. |
| `src/events/EventTriggers.ts` | **KEEP** | |
| `src/events/EventModel.ts` | **KEEP** | |

### 2.10 `src/fitness/**` and `src/rewards/**`

| Path | Class | Why |
| --- | --- | --- |
| `src/fitness/**` (catalog, estimate, evaluation, session, personalization, physicalResult, history, clock, etc.) | **KEEP** | Audit: retain. No map geometry. |
| `src/rewards/**` | **KEEP** | Troops/construction/golden yield/defense. Construction acceleration still valid once cities are construction-only. |

### 2.11 `src/world/**` (time engine — not WorldDefinition)

| Path | Class | Why |
| --- | --- | --- |
| `src/world/ContinuousWorldEngine.ts` | **KEEP** | Tick/AI/events. |
| `src/world/worldTime.ts` | **KEEP** | |
| `src/world/eventTick.ts` | **KEEP** | |
| `src/world/catchup.ts` | **KEEP** | 17L offline sync. |
| `src/world/index.ts` | **KEEP** | |

New world-content modules must **not** live as a takeover of this folder. Proposed path: `src/worldDefinition/` (§4).

### 2.12 `src/persistence/**`

| Path | Class | Why |
| --- | --- | --- |
| `src/persistence/types.ts` | **MODIFY** (minimal) | `worldId` today is instance key `'local'`. Needs a **definition** id/version distinct from the run instance (see §14). |
| `src/persistence/versioning.ts` | **MODIFY** | Schema 8 → next; drop hex `coordToTerritory`/`territoryPos` migration once those fields vanish. |
| `src/persistence/snapshot.ts` / `hydrate.ts` / `serialization.ts` | **MODIFY** | Stop round-tripping `mapWorld` hex + visibility as production data. |
| `src/persistence/gameStateStore.ts` / `inMemoryGameStateStore.ts` / `commit.ts` / `sync.ts` / `timeAuthority.ts` / `errors.ts` | **KEEP** | |
| `src/persistence/supabase/**` | **DEFER** | Boundary stubs only. Do not implement live Supabase. `world_id` column can later store instance or definition id — document, don’t ship network. |
| `src/persistence/index.ts` | **KEEP** | |

### 2.13 `src/constants`, `src/utils`, `src/index.ts`

| Path | Class | Why |
| --- | --- | --- |
| `src/constants/balance.ts` | **MODIFY** | `baseScores.SCOUT`, `ACTION_NAMES.SCOUT`, capital combat constants stay until §11 retarget. Expansion claim rules remain for `allowUnowned`. |
| `src/utils/SeededRNG.ts` | **KEEP** | |
| `src/index.ts` | **MODIFY** | Stop exporting MapEngine/NamingSystem/Themes/SAMPLE_MAP as production API when retired; export WorldDefinition loader. |

### 2.14 Tests

| Path | Class | Why |
| --- | --- | --- |
| `tests/run.ts` | **MODIFY** | Mix of SAMPLE_MAP, MapEngine, SCOUT, control_region, createGameState. Rewrite/delete obsolete cases; keep harness. |
| `tests/foundationHardening.ts` | **MODIFY** | SCOUT / GET_VISIBLE_WORLD fog / SAMPLE_MAP celestial. |
| `tests/economyCities.ts` | **MODIFY** | Asserts cities seeded for every owned SAMPLE_MAP tile; ownership transfer keeps/creates city. |
| `tests/aiRuntime.ts` | **MODIFY** | WARLORD_SPECS / SAMPLE_MAP; SCOUT commitments. |
| `tests/longSimulation.ts` | **TEMPORARY** then **MODIFY** | WARLORD_SPECS ghost-faction tests. |
| `tests/armyMovement.ts` | **KEEP** | Adjacency hops; fixtures may drop names. |
| `tests/strategicAttack.ts` | **MODIFY** | Fog gate if asserted. |
| `tests/invasionLifecycle.ts` | **KEEP**; copy uses names | |
| `tests/gameplayConsumption.ts` | **KEEP** | |
| `tests/gameRewards.ts` / `tests/rewardApplication.ts` | **KEEP** | |
| `tests/persistence.ts` | **MODIFY** later | Envelope `worldId`; mapWorld/visibility snapshots. |
| `tests/fitness*.ts` | **KEEP** | |
| **New** `tests/worldDefinition.ts` (name TBD) | **DEFER implement** | Validator + loader + city/conquest/visibility tests listed in §16. |

### 2.15 Docs

| Path | Class | Why |
| --- | --- | --- |
| `docs/phase-17m-world-map-spec.md` | **KEEP** | Authority for content model. |
| `docs/phase-17n1-world-migration-plan.md` | **KEEP** | This file. |
| `docs/examples/world-level1-tiny.json` | **TEMPORARY** → canonical **test world** | See §12. |
| `docs/AUTHORITATIVE_GAMESTATE_ARCHITECTURE.md` | **MODIFY** | Documents MapEngine as producer of mapWorld/visibility. |
| `docs/CANONICAL_STATE_ARCHITECTURE.md` | **MODIFY** | Same. |
| `docs/ORCHESTRATOR_ARCHITECTURE.md` | **MODIFY** | SCOUT, GET_VISIBLE_WORLD fog. |
| `docs/PLAYER_AI_INTERACTION_ARCHITECTURE.md` | **MODIFY** | Scout parity, fog. |
| `docs/AI_COMMITMENT_EXECUTION.md` / `AI_RUNTIME_INTEGRATION.md` / `AI_COMMITMENT_AMBITION.md` / `ENGINE_EXECUTION_CONSISTENCY.md` | **MODIFY** | SCOUT executable; control_region gap. |
| `docs/AI_DECISION_CORRECTNESS.md` | **MODIFY** | control_region / regionId. |
| `docs/CONTINUOUS_WORLD_ARCHITECTURE.md` | **MODIFY** | SCOUT duration table. |
| `docs/BATTLE_ENGINE_CORRECTNESS.md` | **KEEP**; capital note | Combat math stays; capital input changes. |
| `docs/ARMY_MOVEMENT_ARCHITECTURE.md` | **KEEP** | Already explicit adjacency. |
| `docs/STRATEGIC_ATTACK_ARCHITECTURE.md` | **MODIFY** | Fog-of-war player gate. |
| `docs/EVENT_ENGINE_CORRECTNESS.md` | **KEEP** | |
| `docs/REPOSITORY_STABILIZATION.md` | **MODIFY** | NamingSystem dist artifacts / generateInitialWorld neighbor rules. |

### 2.16 Proposed new modules (not in repo yet — do not implement now)

| Path | Class | Why |
| --- | --- | --- |
| `src/worldDefinition/types.ts` | **REPLACE** MapEngine’s authority | `WorldDefinition`, polygons, factions. |
| `src/worldDefinition/validate.ts` | new | §13 rules. |
| `src/worldDefinition/load.ts` | new | Parse JSON → definition. |
| `src/worldDefinition/instantiate.ts` | new | Definition → GameState overlay. |
| `src/worldDefinition/catalog.ts` | new | In-memory WorldRepository by `worldId`. |
| Map Assistant `.py` | **DEFER** | Editor, not generator. One standalone file when a later phase asks. |

---

## 3. Old map assumptions inventory

| Assumption | File / symbol | What it assumes | Replace with |
| --- | --- | --- | --- |
| Hex `q,r` | `MapEngine.ts` `HexPos`, `HEX_DIRS`, `hexDist`, `key(q,r)` | World is axial hex grid | Authored polygons; explicit `neighborIds` |
| `coordToTerritory` / `territoryPos` | `types/index.ts` `MapWorldState.graphMeta`; `cloneGameState.ts`; `persistence/versioning.ts` | Runtime hex index | Do not persist. Geometry in WorldDefinition |
| Procedural generation | `MapEngine.generateInitialWorld`, `expandFromFrontier`, `fabricateTerritory` | Runtime invents tiles/IDs/names | Authored JSON only |
| Generated territory IDs | MapEngine `t_*` fabricator | IDs from seed | Stable file IDs |
| Territory names | `Territory.name`, `MapTerritorySpec.name`, `NamingSystem.generateTerritoryName` | Player-facing tile titles | Region `name`; territories ID-only |
| Themes as generators | `Themes.ts`, `InitialWorldParams` | Theme weights create land | Omit from v1 world JSON |
| Scouting | `ActionType 'SCOUT'`, `handleScout`, `scoreScout`, `revealTerritories` | Hidden tiles inside current world | Delete command and AI action |
| `knownTerritories` as fog | `WarlordSnapshot.knownTerritories`, `SampleMap` bootstrap, `publicView.visibilityOf` | Knowledge subset of map | All current-world IDs known; later diplomatic memory only |
| `isKnown` / `scoutedTurnsAgo` | `Territory` | Per-tile fog aging | Remove fields |
| `PlayerVisibilityMap` | `GameState.visibility`, MapEngine create/recompute | Per-faction tile fog | Remove; exterior “next world” is presentation, not this map |
| Attack visibility | `gameplay/attacks/visibility.ts` `assertPlayerCanSeeTarget` | Player cannot attack unknown tiles | Remove gate |
| Public-view fog | `fogTerritory`, `GET_VISIBLE_WORLD` | Hide garrison/name on unknown/discovered | Full current island; no territory names |
| Rectangular/hex playable world | MapEngine `renderWorldText` minQ–maxQ ASCII | Playable rectangle of hexes | Island polygon; canvas AABB display-only |
| Runtime starting owners | (not random today on SAMPLE_MAP, but MapEngine assigns capitals) | Generator picks player capitals | JSON `startingOwnerFactionId` |
| Capitals | `Territory.isCapital`, SAMPLE_MAP flags, CombatPower, ActionScorer | Fixed tile destiny | §11 seat + city |
| Cities from ownership | `seedEconomyAndCities`, `settleTerritoryOwnershipChange` | Owned ⇒ city | Seed economy only; conquest destroys city |
| Global personality roster | `WARLORD_SPECS`, `PersonalitySystem.createPreset` | Four empires / enum identity | Per-world trait vectors |
| SAMPLE_MAP as default world | `createGameState` | Production geography | Tiny JSON then real authored files |
| Unowned land + EXPAND | SAMPLE_MAP `owner: null`, `executeExpand` | Claim empty tiles | Level 1 JSON assigns every tile; EXPAND idle unless `allowUnowned` |
| `control_region` without regions | `GoalSystem.checkAlignment` | Prefix heuristic removed; BUILD-only | `Territory.regionId` + region catalog |
| Persistence hex meta | `versioning.ts` coerce `coordToTerritory` | Saved procedural worlds | Pointer to definition + overlay |

---

## 4. New world runtime model (do not implement now)

Keep the surface small. No “MapEngine 2”. No procedural service.

| Module / type | Responsibility | Inputs | Outputs | Authoritative fields | Depends on | Consumed by |
| --- | --- | --- | --- | --- | --- | --- |
| `Polygon` / `Vec2` | World-local 2D rings | JSON rings | Validated polygon | `rings[]` | none | Validator, future renderer |
| `WorldDefinition` | One level’s content document | Loader | Immutable def | 17M schema | Polygon, regions, territories, factions | Instantiator, catalog, validator |
| `RegionDefinition` | Named membership | JSON region | Region record | `id`, `name`, `worldId`, `territoryIds` | Territory ids | AI goals, public view, renderer labels |
| `TerritoryDefinition` | Authored tile | JSON territory | Territory record | `id`, `regionId`, polygon, `neighborIds`, starting owner, terrain, `resourceOutput` | Region id | Instantiator (copies overlay fields into GameState) |
| `WorldFactionDefinition` | Player or AI slot | JSON faction | Faction spawn spec | role, name, `homeTerritoryId`, starting resources/army, personality | Territory ids | Instantiator, DecisionEngine (via WarlordSnapshot) |
| `WorldPersonalityDefinition` | Trait vector + ambition | JSON personality | `Personality` + ambition | traits ∈ [0,1], ambition | none | `PersonalitySystem.fromTraits` |
| Contained-world entry (on `WorldDefinition`) | Hierarchy pointer | `containedWorlds[]` | Render/history refs | `worldId`, `regionId`, `placement` | Other files | Renderer, future progression — **not** combat |
| `WorldValidator` | Fail closed | `WorldDefinition` | `{ ok }` or issues | — | graphInvariants + geometry | Loader, future editor |
| `WorldLoader` | Parse JSON | string/file | `WorldDefinition` | — | Validator | Init, tests |
| `WorldRepository` / catalog | Resolve `worldId` → definition | ids | definitions | — | Loader | Init, renderer, persistence hydrate (load JSON separately) |
| `instantiateWorld` (fn) | Build GameState overlay | definition + seed + playerId | `GameState` | — | createGameState primitives, **not** seedCities | Orchestrator boot |

**Not needed:** WorldHierarchyEngine, FogEngine, ProceduralMapService, TerritoryNameService, ScoutEngine.

**PersonalityType:** remain as optional compatibility label (`presetHint` / nearest preset). Identity is the vector.

---

## 5. World JSON → game runtime mapping

| World JSON | Runtime representation | GameState field? | Derived-only | Consumers |
| --- | --- | --- | --- | --- |
| `formatVersion` | constant check | no (or persist pointer on envelope) | — | Loader |
| `worldId` | catalog key | **yes, pointer** `definitionWorldId` (name TBD) | — | Persistence, renderer |
| `level` | number | **yes** if progression UX needs it without opening JSON | — | Progression (future) |
| `name` | world title | optional cache | — | UI |
| `island` | Polygon | **no** | — | Renderer |
| `regions[].name` | catalog | optional `GameState.regions` **immutable snapshot** of id/name/territoryIds (no polygons) | region outline union | AI, UI, events copy |
| `territories[].id` | TerritoryId | `territories` key | — | All |
| `polygon` | catalog only | **no** | — | Renderer, validator |
| `neighborIds` | copied to `Territory.neighboring` (or rename) | **yes** (stable for the run; not invented) | validator symmetry | MOVE, ATTACK, EXPAND |
| `regionId` | on Territory | **yes** | — | GoalSystem, UI |
| `startingOwnerFactionId` | initial `owner` | `owner` mutates after | — | Init only for assignment |
| `terrain` | Territory.terrain | yes | — | Movement duration, combat |
| `resourceOutput` | Territory.resourceOutput | yes (stable unless events change it) | `resourceIncome` | Economy |
| `factions[]` | WarlordSnapshot + armies | `factions`, `armies` | income | AI, economy |
| `personality` | `Personality` + ambition | on snapshot (mutable traits? **no** — treat as fixed unless a later system says otherwise) | `Personality.type` label | DecisionEngine |
| `homeTerritoryId` | faction seat | on faction record (new field) or derived from start | `isCapital` must not be stored on tiles | Combat, AI scoring |
| `startingArmy` | Army at location | `armies` | — | Movement/combat |
| `startingDiplomacy` | diplomacy maps | yes, then mutates | — | AI |
| `containedWorlds` | catalog | optional ids on GameState for UI | child graphs **not** in `territories` | Renderer |
| `completion` | catalog | player progress **elsewhere** (profile / GameState flag later) | — | Future progression |
| `editor` | ignore | no | displayBounds | Editor only |

**Never copy unnecessarily into mutable GameState:** island/territory polygons, editor notes, nested world’s territories, personality `label`/`presetHint`, `formatVersion` beyond a pointer.

---

## 6. GameState changes

Do not add fields for convenience.

### Add (runtime)

| Field | Why runtime | Why not WorldDefinition-only |
| --- | --- | --- |
| `definitionWorldId` (and `definitionFormatVersion`) | Which content file this run is bound to | Persistence/hydrate must open the matching JSON without guessing |
| `level` | Convenience for “current world” UX and invariants | Could be loaded from JSON each time; storing avoids catalog miss matching the overlay |
| `Territory.regionId` | AI/goals/public view during the run | Membership is authored but must be on the tile overlay so GoalSystem does not open the catalog every score |
| `Territory.neighboring` (keep) | Movement/combat | Same: overlay must not consult JSON on every hop |
| `Faction.homeTerritoryId` (or equivalent on snapshot) | Seat for combat/AI after start | Authored at start; remains the seat unless a later “move seat” command exists (**no such command now**) |
| `regions` lightweight map (id, name, territoryIds) | `control_region` + UI | Polygons stay in catalog; this is a frozen membership index |

### Keep as overlay (already exist)

`owner`, `fortification`, `garrison`, `resourceOutput`, `terrain`, `population` (events), `baseValue` (scoring), armies, cities, constructions, economy, invasions, fitness, rewards, commitments, `playerFactionId`, clocks.

`population` / `baseValue`: not in 17M required schema. **Recommendation:** optional authored JSON fields, copied into GameState because **WorldSimulator mutates population**. If omitted, loader defaults to `0` (do not invent SAMPLE_MAP-scale pops). See §20 open item.

### Remove from GameState / Territory

| Remove | Why |
| --- | --- |
| `Territory.name` | Unnamed tiles |
| `Territory.isKnown`, `scoutedTurnsAgo` | No tile fog |
| `Territory.isCapital` | Not authored destiny; derive seat+city |
| `GameState.mapWorld` | Hex procedural meta |
| `GameState.visibility` | Tile fog maps |
| `PlayerVisibilityMap` / `VisibilityState` as gameplay | Same |

`knownTerritories`: stop using as fog. Either remove or populate with **all** current-world ids at init and ignore for visibility.

### Do not add

Polygons on `Territory` inside GameState; nested Level N tiles; scout range; `isCapitalRegion`; theme seeds; `coordToTerritory`.

---

## 7. City / conquest migration

**Target rule**

```
territory created:          no city
territory conquered:        old owner's city destroyed
conqueror receives:         no city
city creation:              explicit construction only
```

### Paths that violate it

| Path | Current behavior | Replacement |
| --- | --- | --- |
| `seedEconomyAndCities` (`gameplay/economy/seed.ts`) | `ensureCity` for every `territory.owner` | Seed `territoryEconomy` only. `cities` empty. Fortification stays 0 from world JSON (SAMPLE_MAP currently has forts — authored JSON must export 0). |
| `settleTerritoryOwnershipChange` (`ownership.ts`) | `ensureCity` for new owner; copies fortification into city buildings | Always `removeCity`. Reset fortification to 0 (conquered works are razed; matches destroy-city). Do **not** `ensureCity`. Unowned already `removeCity`. |
| `applyBattle.ts` `transferTerritory` | Calls `settleTerritoryOwnershipChange` | Inherits the ownership.ts fix. |
| `handlers.ts` `executeExpand` | Same settle on claim | If EXPAND remains for unowned: claimed land still **no city**. |
| `startConstruction` (`construction/consume.ts`) | `ensureCity` immediately on FORTIFICATION start | **Explicit founding:** either (a) `projectType: 'CITY'` creates city on **complete**, or (b) first construction on a city-less tile is founding. Fortification projects require an existing city. See open decision §20. |
| `completeConstruction` | `ensureCity` then bump fort | City project → create city. Fortification → require city, then `syncCityFortification`. |
| `syncCityFortification` | `ensureCity` if missing | Must **not** create a city just to store a fort building. No-op or error if no city. |
| SAMPLE_MAP `fortification`/`garrison` > 0 at spawn | Pre-built forts/garrisons | Authored JSON: 0/0. Armies are faction stacks. |

**Keep:** `ensureCity` as the primitive for **construction completion** only.

**Tests to rewrite:** `tests/economyCities.ts` (“seeds cities…”, ownership transfer cases around lines 509–561).

---

## 8. Visibility / scouting removal plan

**Target:** current world 100% visible. Future worlds inaccessible until progression. No territory-level information fog.

### Delete / stop calling

| Item | Location |
| --- | --- |
| Command `SCOUT` | `commandIndex.ts`, `handlers.ts` `handleScout` / `canScoutWithoutMapWorld`, router, `COMMAND_HANDLERS.SCOUT` |
| `ActionType` `'SCOUT'` | `types/index.ts`, DecisionEngine lists, `executableActions.ts`, ActionScorer `scoreScout`, PersonalitySystem bias, GoalSystem BUILD/SCOUT grouping, `BALANCE` scores/names |
| MapEngine fog | `revealTerritories`, `recomputeVisibilityFor`, `createVisibilityMapFor`, `PlayerVisibilityMap` |
| Player attack fog | `src/gameplay/attacks/visibility.ts`; callers in `strategicAttack.ts` |
| Public fog | `visibilityOf`, `fogTerritory` unknown/discovered branches, army hiding on discovered tiles |
| Territory fields | `isKnown`, `scoutedTurnsAgo` |
| `GameState.visibility` | clone/invariants/persistence |
| Error `FOG_OF_WAR` for current-world tiles | Keep code only if reused for locked next world |
| CLI / mapDemo scout | `cli.ts` SCOUT case; `mapDemo.ts` tests 7+ |

### Retarget (do not delete the command)

`GET_VISIBLE_WORLD`: return full current island overlay (owners, armies, garrisons, construction) **without** territory names. Optional payload: “exterior locked” for next level — presentation, not per-tile fog.

`GET_GAME_STATE`: same; drop `optional factionId` fog impersonation tests that exist to protect other factions’ fog (`foundationHardening.ts`).

### AI

- Remove SCOUT from `decide()` action set so warlords cannot commit to it.
- `knownTerritories`: initialize to all tile ids **or** remove checks; do not score “unknown interior tiles.”
- Personality: drop SCOUT bias; opportunism remains for other actions.

### Docs

Update every SCOUT/fog row in §2.15 docs. Do not leave “MapEngine when mapWorld exists” as live architecture.

### Tests to delete (not green-wash)

`tests/run.ts`: player SCOUT, AI SCOUT shared handleScout, handler uniqueness of `handleScout`.  
`tests/foundationHardening.ts`: SCOUT FOG_OF_WAR cases, GET_VISIBLE_WORLD other-faction fog.  
`src/simulation/mapDemo.ts` scout tests (file deleted).

### Tests to rewrite

GET_VISIBLE_WORLD does not mutate; returns **all** current territories with owners/garrisons. ATTACK never returns FOG_OF_WAR for on-island tiles.

---

## 9. AI personality migration

```
World JSON factions[].personality
    → WorldPersonalityDefinition
    → PersonalitySystem.fromTraits(traits, { type?: presetHint | nearest })
    → WarlordSnapshot.personality + ambition
    → DecisionEngine / ActionScorer (unchanged numeric path)
```

**Existing model is enough.** `Personality` is already a `[0,1]` vector plus `type`. `getActionBias` / risk / revenge / trust use numbers. `PersonalityType` is **not** required for scoring.

| File / function | Change |
| --- | --- |
| `PersonalitySystem.createPreset` | Keep for editor/tests |
| **New** `PersonalitySystem.fromTraits` | Clamp traits; set `type` from hint or nearest L1 preset **label only** |
| `PersonalitySystem.randomizePreset` | Do **not** use on production world load (would invent variance). Tests only |
| `SampleMap` `WarlordSpec.personality: PersonalityType` | Fixture-only |
| `instantiateWorld` | Copy JSON ambition + traits; **no** `randomizePreset` |
| `ActionScorer` / `DecisionEngine` | No redesign; remove SCOUT |
| `GoalSystem.generateInitialGoals(spec.personality, …)` | Today keys off `PersonalityType`. Pass traits or a derived type label from nearest preset so goal generation still works without a global roster |

Do not replace DecisionEngine.

---

## 10. Region-aware AI

Today: `StrategicGoal.targetRegion` exists; `checkAlignment` `control_region` only credits BUILD; ATTACK/EXPAND must **not** use id-prefix guessing (`tests/run.ts` locks that). `Territory` has **no** `regionId`.

**Recommended data path:** copy `regionId` onto runtime `Territory` and keep a frozen `GameState.regions` membership index created at instantiate. AI `ActionContext` already has `allTerritories`. GoalSystem reads `allTerritories.get(id).regionId === goal.targetRegion`.

**Do not** make DecisionEngine import WorldRepository on every score (extra I/O, dual source). **Do not** duplicate polygons into AI.

`generateInitialGoals`: emit `control_region` with a **real** `targetRegion` id (e.g. region containing `homeTerritoryId`, or a neighboring enemy region). Stop `targetRegion: null`.

Public/event copy: region name from `state.regions.get(t.regionId).name`, never `t.name`.

---

## 11. Capital system decision

**Do not preserve SAMPLE_MAP `isCapital` as authored destiny.**

**Recommendation: B, narrow — runtime seat, not a tile flag.**

| Rule | Detail |
| --- | --- |
| Authored | `homeTerritoryId` on each faction (17M). No `isCapital` in JSON. |
| Runtime seat | `homeTerritoryId` is the empire’s seat for this world unless a later command moves it (**defer move-capital**). |
| City coupling | Seat combat bonus applies only if **that territory has a city**. A bare home tile is not a fortress capital. |
| Conquest of seat | City destroyed; tile is not automatically the conqueror’s seat. Loser’s `homeTerritoryId` may point at land they no longer own — **retarget seat to another owned tile with a city, else null** (implementation detail at city/conquest phase). |
| Combat | `CombatPower` / `BattleEngine` replace `territory.isCapital` with `isSeatWithCity(state, territory)`. Keep `BALANCE.combat.capitalBonus` numbers until a balance pass. |
| AI scoring | Replace `myTerr.isCapital` with seat-with-city or “is homeTerritoryId.” |
| NamingSystem capital suffixes | Deleted with NamingSystem. |

**Reject A (remove entirely)** only if we also delete capitalBonus from combat/AI in the same pass — that is a larger balance change than 17N.1 needs. B preserves the *gameplay* of “defend the seat” without a frozen map flag.

**Reject silent preservation** of `Territory.isCapital` written at SAMPLE_MAP authoring time.

**Affected:** `CombatPower.ts`, `BattleEngine.ts`, `ActionScorer.ts`, `SampleMap.ts`, `MapEngine` capital placement, `publicView.ts`, CLI stars, `NamingSystem`, `tests/run.ts` / battle fixtures, `BALANCE.combat.capitalBonus`.

---

## 12. SAMPLE_MAP / test world plan

| Artifact | Role |
| --- | --- |
| `SAMPLE_MAP` + `WARLORD_SPECS` | **TEMPORARY TEST FIXTURE** until default init is JSON. Do not add features to it. |
| `docs/examples/world-level1-tiny.json` | **Canonical integration-test world** for loader/validator/init: 6 unnamed tiles, 2 named regions, 1 player + 2 AI, explicit owners, `containedWorlds: []`. |
| `SimulationBuilder.buildFromSpecs` | Keep as fixture builder for tests that still pass `MapTerritorySpec[]`. Stop calling it from production `createGameState` once JSON init is default. |
| MapEngine `generateInitialWorld` tests in `tests/run.ts` / `mapDemo.ts` | **Delete** with MapEngine; do not port hex uniqueness tests. |
| New tests | Load tiny JSON through validator + instantiator only — **never** through `generateInitialWorld`. |

Hand-authored **polygon** worlds will not match SAMPLE_MAP ids (`north_valley`, `iron_spire`, …). Tests that hardcode those ids stay on the fixture path until rewritten.

---

## 13. World loading / initialization (future flow)

```
playerId
  → resolve definitionWorldId (campaign / default Level 1 file)
  → WorldLoader.parse + WorldValidator.validate   (fail closed)
  → WorldRepository.remember(definition)
  → instantiate:
        empty GameState clocks (schema next, worldTick 0)
        territories overlay (owner = startingOwner, fort 0, garrison 0,
                             neighboring, regionId, terrain, resourceOutput,
                             no name, no isCapital, no isKnown)
        regions index
        factions from world factions (player personality null;
             AI fromTraits; homeTerritoryId; starting resources)
        starting armies from faction.startingArmy (location must be owned)
        diplomacy from startingDiplomacy or neutral
        commitments null
        cities empty
        territoryEconomy empty records (no ensureCity)
        visibility absent
        playerFactionId = definition.playerFactionId
        definitionWorldId / level pointers
  → checkGameStateInvariants
  → Orchestrator holds state
```

Runtime **must not:** generate neighbors, even-split AI land, name tiles, spawn cities, attach MapEngine fog, inline `containedWorlds` territories.

Player faction is the JSON `role: "player"` slot, not a second structure.

---

## 14. Persistence impact (minimal)

17L already persists a full GameState envelope (`game-state-persistence.v1`) with instance `worldId: 'local'`.

| Need | Change |
| --- | --- |
| Authored world identity | Store `definitionWorldId` + `definitionFormatVersion` (+ `level`) on GameState **or** envelope. Do not overload `'local'` to mean Ember Atoll. |
| Load JSON separately | Hydrate overlay from payload; load polygons from WorldRepository by definition id. If JSON missing → fail closed (same spirit as corrupt state). |
| Do not persist polygons every tick | 17M already: pointer + overlay. |
| Schema 8 snapshots | Next schema (9+) when Territory drops `name`/`isKnown`/`isCapital` and `mapWorld`/`visibility` go. `versioning.ts` migrates **or** refuses old hex worlds (prefer refuse procedural snapshots rather than fake polygons). |
| Player/world/faction | Keep Option B: one run per player. `playerFactionId` stays. |
| Supabase | No implementation. Stubs already have `world_id`; later map to instance vs definition explicitly. |

Do not redesign catch-up, workout history, or `stateVersion`.

---

## 15. Command / Orchestrator impact

| Command | Fate |
| --- | --- |
| GET_COMMAND_INDEX | KEEP |
| GET_GAME_STATE | MODIFY validation/view: no fog slice; no territory names |
| GET_VISIBLE_WORLD | MODIFY: full current world; optional next-world lock presentation |
| ATTACK | KEEP; **remove** `assertPlayerCanSeeTarget`. Adjacency/staging unchanged (`neighboring`) |
| MOVE | KEEP; still `isAdjacent` |
| BUILD | KEEP; owned tile; city/fort rules per §7 |
| REINFORCE | KEEP |
| SCOUT | **OBSOLETE — delete** |
| EXPAND | KEEP code; **unused** on Level 1 fully owned JSON; validate unowned + adjacency. Do not invent empty land |
| DECLARE_WAR / NEGOTIATE | KEEP |
| OFFER_PEACE / TRADE | unchanged unsupported |
| SYNC_PLAYER_WORLD / ADVANCE_WORLD | KEEP; no map gen |
| RESOLVE_COMMITMENT / AI_DECIDE | MODIFY: no SCOUT execution branch |
| START_CONSTRUCTION / APPLY_CONSTRUCTION_ACCELERATION | MODIFY: city founding vs fortification |
| COLLECT_RESOURCES | KEEP (owned land yield; city not required unless a later economy pass says so) |
| SET_PLAYER_PAUSE | KEEP |
| START_WORKOUT / RECORD_EXERCISE / SKIP_REST / SUBMIT_WORKOUT_FEEDBACK / ABANDON / FINALIZE | KEEP |
| Invasion/defense commands | KEEP; copy uses region name |

New world-level validation (when JSON init is live): unknown `territoryId` still `INVALID_TERRITORY`; never “generate a tile.” Commands must not accept nested-world child IDs while parent is current.

---

## 16. Test migration plan

Do **not** blindly retarget SAMPLE_MAP tests to stay green.

### Retain (behavior still valid)

Fitness/rewards/persistence catch-up/invasion lifecycle/army movement math/battle resolution math (with capital input retarget)/orchestrator pause/authorization/economy accrual equations.

### Rewrite

| Area | Why |
| --- | --- |
| `economyCities` spawn cities / conquest inherit city | New city rules |
| `createGameState` “reuses SAMPLE_MAP” | Will reuse World JSON |
| GET_VISIBLE_WORLD fog | Full visibility |
| Goal `control_region` | Real membership |
| AI SCOUT commitment | Delete; replace with “AI never selects SCOUT” |
| Public view garrison hiding | No fog |
| Persistence mapWorld/visibility | Pointers, no hex |
| Battle strings / invasion body | Region names |
| Personality tests using only presets | fromTraits world vectors |

### Delete (obsolete behavior)

MapDemo / `generateInitialWorld` uniqueness, NamingSystem uniqueness, SCOUT FOG_OF_WAR legal-destination, `handleScout` MapEngine branch, tests that require `Territory.name`, tests that require `mapWorld !== null` for production, “SAMPLE_MAP neighbor graph untouched by EXPAND” as a **production** invariant (fixture-only until SAMPLE_MAP dies).

### New tests (specify now, implement later)

1. Valid tiny JSON loads (`world-level1-tiny.json`).
2. Invalid polygons rejected (open ring, self-intersection, zero area).
3. Invalid adjacency rejected (non-reciprocal, missing id, no shared edge).
4. Invalid region membership rejected (orphan, double membership, empty region).
5. Duplicate IDs rejected.
6. Missing references rejected (`homeTerritoryId`, `regionId`, neighbors).
7. Disconnected dual graph rejected.
8. Starting owners: every tile assigned (Level 1 default).
9. Exactly one player starting territory; `homeTerritoryId` matches.
10. AI counts differ by at most 1 (tiny JSON 3 vs 2 is valid).
11. `cities.size === 0` after instantiate.
12. Conquest: city removed; conqueror has no city on that id.
13. Construction founds city only via explicit project.
14. Full current-world visibility in GET_VISIBLE_WORLD.
15. SCOUT command absent / FEATURE or invalid command.
16. No territory fog fields on overlay.
17. World-specific personalities: two AI vectors differ; DecisionEngine runs without `WARLORD_SPECS`.
18. `control_region` aligns ATTACK/EXPAND when target `regionId` matches.
19. Hierarchy: parent file with `containedWorlds` does **not** put child ids in `state.territories`.
20. Neighbor lists never include foreign-file ids.

---

## 17. Dependency / migration order

Chosen to keep SAMPLE_MAP tests green until a dedicated rewrite, and to put **additive** JSON work first.

| Phase | What | Breakage |
| --- | --- | --- |
| **A — World domain** | `src/worldDefinition/*` types, validator, tests on tiny JSON. No GameState wiring. | None |
| **B — Dual init** | `instantiateWorld` + `createGameStateFromWorld`. Default `createGameState` still SAMPLE_MAP. | None if unused by default |
| **C — City/conquest** | Fix `seed.ts` / `ownership.ts` / construction founding. Rewrite `economyCities`. Apply to **both** init paths (SAMPLE_MAP will lose spawn cities — tests must change here). | Economy/city tests |
| **D — Capital retarget** | Seat + city in CombatPower/Battle adapters; stop writing `isCapital` in new init. SAMPLE_MAP fixture can still set the flag until types drop it. | Battle/AI score tests that assume SAMPLE_MAP capitals |
| **E — GameState identity + regionId** | `definitionWorldId`, `regionId`, regions index on JSON path; SAMPLE_MAP tests get synthetic regions or stay nameless. | Moderate |
| **F — Visibility/SCOUT removal** | Delete command, fog, attack gate, publicView branches. | Scout/foundation/orchestrator tests |
| **G — Personality + region AI** | fromTraits on JSON path; GoalSystem membership. | AI decision tests |
| **H — Production default** | `createGameState()` loads Level 1 JSON (tiny or first real world). SAMPLE_MAP becomes fixture import only. | Any test assuming default iron_kingdom / north_valley |
| **I — Persistence** | Schema bump; pointer; stop hex visibility; refuse old procedural snapshots | `tests/persistence.ts` |
| **J — Delete obsolete** | MapEngine, NamingSystem, Themes generator, mapDemo, production SAMPLE_MAP, SCOUT remnants, `attacks/visibility.ts` | Compile until exports cleaned |
| **K — Integration tests** | §16 new list against tiny JSON + a Level 2 **schematic** file when authored | Additive |

**Do not** delete MapEngine in A–G: too many tests import it. **Do not** inline hierarchy at any phase.

**Map Assistant:** after J or parallel after A (editor can validate with the same rules). Not this phase.

---

## 18. Delete list (eventual)

**Files**

- `src/map/MapEngine.ts`
- `src/map/NamingSystem.ts`
- `src/map/Themes.ts` (as generator; replace only if flavor data is wanted later)
- `src/simulation/mapDemo.ts`
- `src/gameplay/attacks/visibility.ts`

**Symbols / groups** (after types migrate)

- `HexPos`, `HEX_DIRS`, `hexDist`, `fabricateTerritory`, `generateInitialWorld`, `expandFromFrontier`, `revealTerritories`, `renderWorldText`
- `Territory.name`, `isKnown`, `scoutedTurnsAgo`, `isCapital`
- `VisibilityState`, `PlayerVisibilityMap`, `MapWorldState.graphMeta.coordToTerritory` / `territoryPos`
- `ActionType 'SCOUT'`, `handleScout`, `scoreScout`, `EXECUTABLE` SCOUT, `BALANCE` SCOUT scores
- `GameState.mapWorld`, `GameState.visibility`
- Production `SAMPLE_MAP`, `WARLORD_SPECS` (keep under `tests/fixtures/` if still needed)
- `engineRegistry.registerMap` / `requireMap`
- `FOG_OF_WAR` for on-island tiles
- Public `fogTerritory` unknown/discovered
- Index re-exports of MapEngine/NamingSystem/Themes

**Docs to rewrite, not necessarily delete:** architecture docs in §2.15 that describe MapEngine as live authority.

**Keep:** `graphInvariants.ts` (extended), BattleEngine, DecisionEngine, CWE, fitness, rewards, persistence stores, army movement.

---

## 19. Risks

| Risk | Why it hurts | Mitigation |
| --- | --- | --- |
| Duplicate sources of truth | GameState polygons + World JSON; or SAMPLE_MAP + JSON both “production” | Geometry only in catalog; one default init |
| Persistence schema | Schema 8 hex/visibility/name snapshots vs new overlay | Bump schema; refuse unmigratable procedural saves |
| AI behavior shift | Losing SCOUT + capital flags + SAMPLE_MAP geography | Dual path; compare DecisionEngine on fixture vs JSON separately; don’t randomize personalities on load |
| City transfer bugs | `ensureCity` on settle is easy to miss (EXPAND, events, applyBattle) | Single `settleTerritoryOwnershipChange`; tests for all callers |
| Lingering visibility | `knownTerritories` / publicView / strategicAttack | Delete `attacks/visibility.ts`; grep FOG/SCOUT/`isKnown` |
| Tests preserving obsolete behavior | “seeds cities”, SCOUT FOG, generateInitialWorld | Delete/rewrite those tests; do not weaken assertions |
| Hierarchy confusion | Inlining child tiles or cross-level adjacency | Validator + instantiate never merge graphs (17M.1) |
| Runtime inventing authored data | `randomizePreset`, even-split owners, hex neighbors, NamingSystem | Loader copies JSON only; no MapEngine on production path |
| Construction vs city | Fortification `ensureCity` recreates cities after conquest | Explicit CITY project or require city for fort |
| `worldId: 'local'` clash | Instance vs content | Separate definition id |
| BattleEngine scope creep | Rewriting combat math | Only adapter fields (name→region, isCapital→seat+city) |

---

## 20. Final recommendation

**Build next, in order:**

1. **WorldDefinition types + validator + tests** on `docs/examples/world-level1-tiny.json` (isolated).
2. **`createGameStateFromWorld` dual path** (SAMPLE_MAP remains default).
3. **City/conquest correction** (`seed` / `ownership` / construction founding) so JSON worlds never spawn cities and conquest never inherits them.
4. **Remove SCOUT and intra-world fog** (commands, AI, public view, attack gate).
5. **Switch production init to authored JSON**; persist `definitionWorldId`; then **delete MapEngine / NamingSystem / mapDemo / production SAMPLE_MAP**.

**Ultimately remove:** hex procedural MapEngine, territory names, scouting, tile fog, cities-at-spawn, conqueror-inherits-city, global WARLORD_SPECS as production identity, `Territory.isCapital` as authored truth.

**Retain:** Orchestrator, GameState-as-run-overlay, BattleEngine math, DecisionEngine loop, economy accrual, invasions, fitness, rewards, 17L persistence stores, explicit adjacency movement.

**Capital:** runtime seat (`homeTerritoryId`) with a city; not a SAMPLE_MAP flag.

**Hierarchy:** never inline Level N tiles into Level N+1 (already locked in 17M.1).

### Decisions that still need product input

1. **City founding action.** Prototype 1 `START_CONSTRUCTION` only builds FORTIFICATION and currently `ensureCity`s immediately. Cleanest match to the spec is a **CITY** project type that creates the city on completion, with fortification requiring a city. Alternative: first construction on bare land founds the city. **Needs a call** if you want a distinct “found city” command vs fortification-as-founding.
2. **`population` / `baseValue` in world JSON.** Events and AI scoring use them; 17M required schema does not. Recommend **optional authored fields**, default 0, mutable at runtime (events). Confirm or drop population events instead.
3. **EXPAND.** Keep as unused on fully owned Level 1, or delete when SAMPLE_MAP unowned tiles go. Recommend **keep until `allowUnowned` is explicitly dropped.**

Everything else in 17M / 17M.1 is treated as closed (unnamed territories, named regions, polygons, full visibility, no scout, coarser parent graphs, explicit owners, per-world personalities, JSON as authority).

---

*Phase 17N.1 ends here. Do not implement the migration from this document until a later implementation phase is explicitly started. Do not begin the Map Assistant.*
