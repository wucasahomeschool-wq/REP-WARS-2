# Frontend / API contract inventory

Generated from the current implementation. Not a proposed HTTP API.

Authoritative public boundary: `Orchestrator.execute(CommandRequest): CommandResponse` (`src/orchestration/orchestrator.ts`), plus persistence boot/sync helpers (`ensurePlayerWorld`, `syncPlayerWorld`, stores). The frontend must not read internal `GameState` merely because `Orchestrator.getState()` exists.

Counts (from `COMMAND_INDEX`):

| Bucket | Count |
| --- | ---: |
| Catalog entries | 32 |
| Implemented | 30 |
| Unsupported (`FEATURE_NOT_IMPLEMENTED`) | 2 |
| Read / query commands | 6 |
| Mutating implemented | 24 |

Sources: `src/orchestration/commandIndex.ts`, `handlers.ts`, `gameplayCommands.ts`, `publicView.ts`, `protocol.ts`, `authorization.ts`, `router.ts`, `orchestrator.ts`, tests under `tests/`.

---

## Envelope (every command)

### Request — `CommandRequest`

```
{
  commandId: string
  playerId: string
  timestamp?: number
  parameters?: Record<string, unknown>
  clientContext?: Record<string, unknown>
  requestId?: string
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `commandId` | yes | Must match `COMMAND_INDEX`. |
| `playerId` | yes in the TypeScript type | Orchestrator does **not** reject empty strings. Persistence boot (`ensurePlayerWorld` / `initializePlayerWorld`) does. |
| `timestamp` | no | Default if omitted when synthesizing `requestId`: `0`. **Not** used as workout `now`, world time, or cooldown clock. |
| `parameters` | no | Command-specific. Missing object is treated as no parameters. |
| `clientContext` | no | **Accepted and unused.** |
| `requestId` | no | If omitted: `` `${commandId}_${playerId}_${timestamp ?? 0}` ``. |

Router required-parameter check (`src/orchestration/router.ts`): a catalog required parameter that is `undefined`, `null`, or `''` (trimmed empty string) → `MISSING_PARAMETER`. Optional parameters are not type-checked by the router; handlers validate.

### Response — `CommandResponse`

```
{
  success: boolean
  commandId: string
  requestId: string
  playerId: string
  stateChanges: StateChange[]
  events: GameEvent[]
  notifications: Notification[]
  presentation: PresentationCue | null
  resourcesChanged: ResourceChange[]
  territoriesChanged: TerritoryChange[]
  armiesChanged: ArmyChange[]
  newlyAvailableActions: AvailableAction[]
  errors: OrchestrationErrorBody[]
  payload: Record<string, unknown>
}
```

`newlyAvailableActions` is always `[]` from current handlers. Do not drive UI from it.

Mutation responses do **not** include a public `gameState` snapshot. After a successful mutation, call `GET_GAME_STATE` (and `GET_VISIBLE_WORLD` if the map needs a world-only slice).

`Orchestrator.execute` does **not** persist. Persistence is a caller/application-server responsibility (`store.save`, `commitAuthoritativePlayerWorld`, `syncPlayerWorld`, `persistWorldTransition`).

Telemetry (`src/analytics`) observes committed commands and does not change `success` / `payload`. `GET_*` commands produce no telemetry events.

### Transaction / mutation semantics

Mutating commands clone → apply → invariant-check (`runStateTransaction`). If the handler or invariants throw, the in-memory orchestrator state is unchanged. If a handler returns `commandSuccess: false`, the **draft still commits** (used for some attack/commitment fail-closed paths).

---

## A. Command index

Legend:

- **R/M**: read-only vs mutating (`changesState`)
- **Authz**: `authorizeCommand` requires `parameters.factionId` (if present) to equal `GameState.playerFactionId`. Categories `SYSTEM`, `WORLD`, and `AI` skip this check.
- **Persist**: `execute` never saves. “Caller” = application layer after `execute`. `syncPlayerWorld()` is a separate persistence API that does save.

| commandId | R/M | Status | Category | Authz | playerId used | requestId | client timestamp | Persistence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET_COMMAND_INDEX` | R | implemented | SYSTEM | skip | echoed only | optional | envelope `timestamp` unused | none |
| `GET_GAME_STATE` | R | implemented | READ | factionId impersonation blocked | viewer via `playerFactionId` | optional | unused | none |
| `GET_VISIBLE_WORLD` | R | implemented | READ | same | same | optional | unused | none |
| `GET_WORLD_DEFINITION` | R | implemented | READ | same | unused in handler | optional | unused | none |
| `GET_FITNESS_CATALOG` | R | implemented | READ | same | unused | optional | unused | none |
| `GET_WORKOUT_SELECTION` | R | implemented | READ | same | passed into personalization / selection view | optional | unused | none |
| `ATTACK` | M | implemented | COMBAT | yes | identity only | optional | `seed` is RNG override, not a clock | caller |
| `MOVE` | M | implemented | ARMY | yes | identity only | optional | unused | caller |
| `BUILD` | M | implemented | TERRITORY | yes | identity only | optional | unused | caller |
| `REINFORCE` | M | implemented | ECONOMY | yes | identity only | optional | unused | caller |
| `DECLARE_WAR` | M | implemented | DIPLOMACY | yes | identity only | optional | unused | caller |
| `NEGOTIATE` | M | implemented | DIPLOMACY | yes | identity only | optional | unused | caller |
| `OFFER_PEACE` | R* | unsupported | DIPLOMACY | n/a | n/a | optional | unused | none |
| `TRADE` | R* | unsupported | DIPLOMACY | n/a | n/a | optional | unused | none |
| `SYNC_PLAYER_WORLD` | M | implemented | WORLD | skip | identity / telemetry | optional | `targetWorldTick` is world time, gated | `execute` does not save; `syncPlayerWorld()` does |
| `ADVANCE_WORLD` | M | implemented | WORLD | skip | unused | optional | `elapsedTicks` / `ticks` advances simulation with **no** `WorldTimeAuthority` | caller |
| `TRANSITION_TO_NEXT_WORLD` | M | implemented | WORLD | skip | preserved on event; client `worldId` ignored | optional | unused | `execute` does not save; `persistWorldTransition()` does |
| `RESOLVE_COMMITMENT` | M | implemented | AI | skip | unused | optional | unused | caller |
| `AI_DECIDE` | M | implemented | AI | skip | unused | optional | unused | caller |
| `START_CONSTRUCTION` | M | implemented | TERRITORY | yes | identity only | optional | unused | caller |
| `APPLY_CONSTRUCTION_ACCELERATION` | M | implemented | TERRITORY | yes | matches pending effect `playerId` | optional | unused | caller |
| `COLLECT_RESOURCES` | M | implemented | ECONOMY | yes | Golden Yield pending effect keyed by `playerId` | optional | unused | caller |
| `SET_PLAYER_PAUSE` | M | implemented | TERRITORY | yes | identity only | optional | unused | caller |
| `START_WORKOUT` | M | implemented | FITNESS | yes | session `playerId` | optional | parameter `now` is session clock | caller; history later on terminal session |
| `PAUSE_WORKOUT` | M | implemented | FITNESS | yes | session already bound | optional | `now` | caller |
| `RESUME_WORKOUT` | M | implemented | FITNESS | yes | session already bound | optional | `now` | caller |
| `RECORD_EXERCISE` | M | implemented | FITNESS | yes | session already bound | optional | `now` | caller |
| `SKIP_REST` | M | implemented | FITNESS | yes | session already bound | optional | `now` | caller |
| `SUBMIT_WORKOUT_FEEDBACK` | M | implemented | FITNESS | yes | session already bound | optional | `now` | caller |
| `FINALIZE_WORKOUT` | M | implemented | FITNESS | yes | reward pipeline `playerId` | optional | `now` accepted, unused by finalize handler | caller; history upsert if `registry.workoutHistory` set |
| `ABANDON_WORKOUT` | M | implemented | FITNESS | yes | history upsert | optional | `now` | caller |
| `RECORD_INTEGRITY_FLAG` | M | implemented | FITNESS | yes | history upsert if abandoned | optional | `now` | caller |

\*Unsupported commands are catalogued `changesState: false` and fail in `assertCommandImplemented` before a handler runs.

`SYNC_PLAYER_WORLD` is implemented in `orchestrator.ts` (not `MUTATING_HANDLERS`). Intentional.

Authoritative vs informational:

- **Authoritative mutations**: all implemented `changesState: true` commands.
- **Informational reads**: the six `GET_*` commands.
- **Harness / simulation, not a product client surface**: `ADVANCE_WORLD`, `AI_DECIDE`, `RESOLVE_COMMITMENT`. They are catalogued and callable.

---

## B. Query / read index

| commandId | Request parameters | Validation | Data source | Response payload root | Frontend-safe? |
| --- | --- | --- | --- | --- | --- |
| `GET_COMMAND_INDEX` | none | catalog only | `COMMAND_INDEX` | `{ summary, commands }` | Yes. Machine catalog. |
| `GET_GAME_STATE` | `factionId?: string` | impersonation if `factionId` ≠ `playerFactionId`; viewer is **always** `playerFactionId` when set (`resolveViewerFactionId`) | `serializePublicGameState` | `{ gameState }` | Mostly. See public-view notes (`worldSeed`, tutorial duplication). |
| `GET_VISIBLE_WORLD` | `factionId?: string` | same viewer rule; throws `INVALID_FACTION` if no viewer faction | `serializeVisibleWorld` | `{ visibleWorld }` | Map slice. No `playerGameplay` (no resources / workout / invasions HUD). |
| `GET_WORLD_DEFINITION` | none | `definitionWorldId` must be a non-legacy authored world that loads | `serializeWorldDefinitionForClient` (JSON clone of `WorldDefinition`) | `{ worldDefinition }` | Geometry yes. Also includes AI personality traits, starting armies, starting resources — more than a renderer needs. |
| `GET_FITNESS_CATALOG` | none | none | fitness catalog + static purpose map | `{ workouts, exercises, purposes, purposeSelections }` | Catalog content. Not tutorial-aware. |
| `GET_WORKOUT_SELECTION` | `purpose: string` required; `intendedDifficulty?: string` | `purpose` must be `WorkoutPurpose`; difficulty must be a `WorkoutDifficulty` if provided | `serializeWorkoutSelectionView` | **spread** of `WorkoutSelectionView` (not nested) | Yes. Use this, not the static catalog map, before `START_WORKOUT`. |

No other read commands exist.

`GET_GAME_STATE` catalog `possibleErrors` lists `INVALID_FACTION`; the handler never throws it. `GET_VISIBLE_WORLD` does.

---

## C. Request schemas

Envelope fields are in the Envelope section. Below: `parameters` only.

### Reads

```
GET_COMMAND_INDEX
{}

GET_GAME_STATE
{
  factionId?: string   // accepted; ignored when GameState.playerFactionId is set
}

GET_VISIBLE_WORLD
{
  factionId?: string   // same as GET_GAME_STATE; still required indirectly because a viewer faction must exist
}

GET_WORLD_DEFINITION
{}

GET_FITNESS_CATALOG
{}

GET_WORKOUT_SELECTION
{
  purpose: string              // required. WorkoutPurpose
  intendedDifficulty?: string  // WorkoutDifficulty; default = selected workout definition.intendedDifficulty
}
```

`WorkoutPurpose`: `NORMAL_TROOPS` | `EXTRA_CONSTRUCTION_WORKERS` | `GOLDEN_YIELD` | `DEFENSE`

`WorkoutDifficulty`: `VERY_EASY` | `EASY` | `MODERATE` | `HARD` | `VERY_HARD`

### Combat / army / territory / economy / diplomacy

```
ATTACK
{
  territoryId: string          // required. Target territory
  factionId?: string           // acting faction; must be playerFactionId when a player exists
  seed?: number                // optional BattleEngine seed override
  commitAmount?: number        // banked Troops to commit (player only). Positive safe integer, must be > 100 (MIN_ATTACKING_TROOPS)
  commitmentId?: string        // accepted by executeAttack; not in the catalog. AI/in-flight use
}

MOVE
{
  armyId: string
  destinationTerritoryId: string
  factionId?: string
  commitmentId?: string        // accepted by handleMove; not in the catalog
}

BUILD
{
  territoryId: string
  factionId?: string
}
// Legacy alias of START_CONSTRUCTION with projectType FORTIFICATION. No constructionId/projectType.

REINFORCE
{
  territoryId: string
  factionId?: string
}

DECLARE_WAR
{
  targetFactionId: string
  factionId?: string
}

NEGOTIATE
{
  targetFactionId: string
  factionId?: string
}

OFFER_PEACE
{
  targetFactionId: string
}

TRADE
{
  targetFactionId: string
}

START_CONSTRUCTION
{
  territoryId: string
  factionId?: string
  constructionId?: string      // optional project id; collision → INVALID_PARAMETER
  projectType?: string         // CITY | FORTIFICATION | FARM | MINE | LUMBER. Default FORTIFICATION
}

APPLY_CONSTRUCTION_ACCELERATION
{
  constructionId: string
  factionId?: string
}

COLLECT_RESOURCES
{
  territoryId: string
  factionId?: string
  useGoldenYield?: boolean           // catalogued
  consumeGoldenYield?: boolean       // accepted alias; not in catalog. true if either is true
}

SET_PLAYER_PAUSE
{
  paused: boolean              // required. Router + handler both require a real boolean (not string)
}
```

### World / AI

```
SYNC_PLAYER_WORLD
{
  targetWorldTick?: number     // non-negative integer; must be ≥ current worldTick and ≤ WorldTimeAuthority.currentWorldTick()
}

ADVANCE_WORLD
{
  factionId?: string           // catalogued; unused by simulation
  elapsedTicks?: number        // integer ≥ 0. Default 1
  ticks?: number               // alias for elapsedTicks
  catchUpCompact?: boolean     // internal; set by catch-up. Not a frontend field
}

TRANSITION_TO_NEXT_WORLD
{
  worldId?: unknown            // accepted by the envelope; ignored. Client cannot choose the next world
}

RESOLVE_COMMITMENT
{
  factionId?: string           // which faction's commitment
}

AI_DECIDE
{
  warlordId?: string           // one AI faction; default all non-player. Player faction → ACTION_NOT_ALLOWED
}
```

### Fitness

```
START_WORKOUT
{
  purpose: string              // required WorkoutPurpose
  workoutId?: string           // catalog id; default = authoritative selection for purpose
  intendedDifficulty?: string
  sessionId?: string           // client-supplied session id
  invasionId?: string          // required for DEFENSE; illegal for other purposes
  constructionId?: string      // stored on gameplayContext only; does not start construction
  collectionTerritoryId?: string  // stored on gameplayContext only; does not collect
  now?: number                 // session clock. Default: state.worldTick * 60_000
}

PAUSE_WORKOUT
{
  now?: number
}

RESUME_WORKOUT
{
  now?: number
}

RECORD_EXERCISE
{
  order: number                // required
  repetitions?: number         // required by domain when current step is repetitions
  durationSeconds?: number     // required by domain when current step is duration
  now?: number
}

SKIP_REST
{
  order: number
  now?: number
}

SUBMIT_WORKOUT_FEEDBACK
{
  value: string                // WorkoutFeedbackValue
  now?: number
}

FINALIZE_WORKOUT
{
  now?: number                 // accepted via sessionNow helper is not called; ignored
}

ABANDON_WORKOUT
{
  now?: number
}

RECORD_INTEGRITY_FLAG
{
  type?: string                // IntegrityFlagType. Only implemented value: SUSPECTED_INTEGRITY. Default that type
  now?: number
}
```

`WorkoutFeedbackValue`: `TOO_EASY` | `EASY` | `ABOUT_RIGHT` | `HARD` | `TOO_HARD`

Session `now` default (all fitness commands that call `sessionNow`): `paramNumber('now') ?? state.worldTick * 60_000`.

---

## D. Response schemas

### Shared `CommandResponse` (frontend-visible)

Always present. `payload` is command-specific.

`OrchestrationErrorBody`: `{ code: ErrorCode, message: string, details?: Record<string, unknown> }`

`StateChange`: `{ entity, id, field?, from?, to?, summary }` where `entity` is `territory` | `army` | `faction` | `resources` | `event` | `visibility` | `diplomacy` | `commitment` | `world`

`GameEvent`: `{ kind, id, title, summary, territoryId?, factionId?, data? }`

`Notification`: `{ severity: 'info' | 'success' | 'warning' | 'error', title, body }`

`PresentationCue`: `{ type, durationMs, title, summary, beats? }` — used on battle reports (`type: 'battle_report'`).

### `GET_COMMAND_INDEX` payload

```
{
  summary: {
    count: number
    implemented: number
    unsupported: number
    byCategory: Record<string, number>
  }
  commands: CommandDefinition[]   // full catalog rows
}
```

### `GET_GAME_STATE` payload — `gameState`

Public snapshot from `serializePublicGameState`. **Not** internal `GameState`.

```
{
  schemaVersion: number                    // currently 12
  turn: number
  worldTick: number
  worldSeed: number                        // internal RNG root; see discrepancies
  playerFactionId: string | null
  viewerFactionId: string | null
  definitionWorldId: string | null
  worldLevel: number | null
  worldName: string | null
  levelAnchorTerritoryIds: string[]
  levelDefeatStatus: 'active' | 'defeated'
  allFactionIds: string[]
  factions: Array<{
    id: string
    name: string
    territoryCount?: number                // only when faction id === viewerFactionId
    personality: string                    // personality.type
    ambition: number
  }>
  territories: Record<territoryId, {
    id: string
    regionId: string
    regionName: string
    visibility: 'visible'
    owner: string | null
    terrain: string
    neighboring: string[]
    population: number
    baseValue: number
    resourceOutput: Partial<Resources> | Resources
    fortification: number
    garrison: number
    farm: boolean
    mine: boolean
    lumber: boolean
  }>
  armies: Array<{
    id: string
    owner: string
    location: string
    troops: number                         // own: exact sum; foreign: rounded to nearest 50
    morale: number | null                  // null if foreign
    moving: boolean                        // false if foreign
    destinationTerritoryId: string | null
    pendingAttackTargetId: string | null
    pendingAttackStagingId: string | null
  }>
  activeEventCount: number                 // count only
  commitmentCount: number                  // count only
  currentWorldFullyVisible: true
  worldCompletion: WorldCompletionView | null
  worldTransition: WorldTransitionView
  tutorial: Level1TutorialPublicView
  playerGameplay?: PlayerGameplayView      // only when viewerFactionId === playerFactionId
}
```

`WorldCompletionView`:

```
{
  complete: boolean
  type: string                             // control_fraction | eliminate_ai | …
  playerOwned: number
  total: number
  fraction: number
  requiredFraction: number | null
  definitionWorldId: string | null
  worldLevel: number | null
}
```

`WorldTransitionView`:

```
{
  eligible: boolean
  nextWorldId: string | null
  nextWorldLevel: number | null
  alreadyOnLatestRegistered: boolean
}
```

`Level1TutorialPublicView` — see section I.

`PlayerGameplayView`:

```
{
  resources: { gold, food, iron, wood, stone } | null
  cities: Array<{ id, territoryId, buildings: Array<{ …CityBuilding }> }>
  uncollected: Record<territoryId, { gold, food, iron, wood, stone }>
  infrastructure: Record<territoryId, { farm: boolean, mine: boolean, lumber: boolean }>
  bankedTroops: number
  pendingConstructionEffects: Array<{ workerPower: number, appliedAtTick: number }>
  pendingGoldenYieldEffects: Array<{ multiplier: number, appliedAtTick: number }>
  constructions: Array<{
    id: string
    territoryId: string
    projectType: 'CITY' | 'FORTIFICATION' | 'FARM' | 'MINE' | 'LUMBER'
    remainingTicks: number               // displayed remaining, derived
    status: string
    startedAtTick: number
    durationTicks: number
  }>
  activeInvasionsAgainstPlayer: Array<{
    invasionId: string
    status: 'pending_response' | 'defense_in_progress'
    territoryId: string
    attackerFactionId: string
    notifiedAtTick: number
    responseDeadlineTick: number
    remainingResponseTicks: number
    defenseInProgress: boolean
    defenseStarted: boolean
    defenseWorkoutStartedAtTick: number | null
    defenseCompletionDeadlineTick: number | null
    remainingDefenseTicks: number | null
    hasDefenseMobilization: boolean
  }>
  empirePaused: boolean
  activeWorkout: ActiveWorkoutView | null
  pendingWorkoutReward: { sessionId, kind, purpose } | null
  lastWorkoutCompletedAtTick: number | null
  fitnessLevel: number | null
  fitnessConfidence: number | null
  levelAnchorTerritoryIds: string[]        // duplicated with root
  levelDefeat: {
    status: 'active' | 'defeated'
    defeatedAtTick: number | null
    defeatedLevel: number | null
    defeatedWorldId: string | null
    lastLostAnchorTerritoryId: string | null
    previousWorldIds: string[]
  }
  tutorial: Level1TutorialPublicView       // duplicated with root gameState.tutorial
}
```

`ActiveWorkoutView` (`serializeActiveWorkout`):

```
{
  sessionId: string
  workoutId: string
  purpose: WorkoutPurpose
  state: 'NOT_STARTED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABANDONED'
  intendedDifficulty: WorkoutDifficulty
  currentExerciseIndex: number | null
  currentExercise: SessionPrescribedExercise | null
  prescribedExercises: Array<{
    exerciseId, order, exerciseType, isRest, bodySection,
    prescription: { kind: 'repetitions', repetitions } | { kind: 'duration', durationSeconds },
    role, skippable
  }>
  performances: Array<{ exerciseId, order, status, actual }>
  feedbackState: 'NOT_APPLICABLE' | 'FEEDBACK_REQUIRED' | 'FEEDBACK_SUBMITTED'
  feedback: WorkoutFeedbackRecord | null
  integrityFlagCount: number
  gameplayContext: {
    invasionId?: string
    constructionId?: string
    collectionTerritoryId?: string
    startedAtWorldTick?: number | null
  } | null
}
```

**Not** on `activeWorkout`: `playerId`, `pauseCount`, `pauseIntervals`, `startedAt`, `completedAt`, `activeDurationMs`, integrity flag details.

Internal `GameState` also has: commitments, activeEvents bodies, eventHistory, faction memory/goals/diplomacy maps, army soldiers/knights/siegeEngines, `playerId` on reward effects, `level1Tutorial` stamps, attacker cooldowns, `lastFoodConsumptionTick`, `playerEmpirePause.pausedAtTick` (pause payload exposes `pausedAtTick`; GET_GAME_STATE only has `empirePaused`).

Faction `stability` is **not** on the public view. Food is `playerGameplay.resources.food`.

### `GET_VISIBLE_WORLD` payload — `visibleWorld`

```
{
  turn: number
  worldTick: number
  viewerFactionId: string
  definitionWorldId: string | null
  worldLevel: number | null
  worldName: string | null
  knownFactions: string[]
  territories: /* same publicTerritory map as GET_GAME_STATE */
  armies: /* same viewer army serialization */
  currentWorldFullyVisible: true
  worldCompletion
  worldTransition
  levelAnchorTerritoryIds: string[]
  levelDefeatStatus: 'active' | 'defeated'
  tutorial: Level1TutorialPublicView
}
```

Missing vs `GET_GAME_STATE`: `schemaVersion`, `worldSeed`, `playerFactionId`, `allFactionIds`, `factions[]`, `playerGameplay`, `activeEventCount`, `commitmentCount`.

No polygons.

### `GET_WORLD_DEFINITION` payload — `worldDefinition`

Full `WorldDefinition` JSON clone:

```
{
  formatVersion: 'rep-wars-world.v1'
  worldId: string
  level: number
  name: string
  playerFactionId: string
  island: { rings: Array<Array<{ x: number, y: number }>> }
  completion: { type: 'control_fraction', fraction: number } | { type: 'eliminate_ai' } | { type: 'manual' }
  containedWorlds: Array<{ worldId, regionId, placement: { origin: {x,y}, rotationDegrees, scale } }>
  factions: Array<{
    id, role: 'player' | 'ai', name, homeTerritoryId,
    startingResources: Resources,
    startingArmy: { soldiers, knights, siegeEngines, locationTerritoryId },
    personality: { id, label, ambition, traits: { aggression, defensiveness, … } } | null
  }>
  startingDiplomacy: Array<{ a, b, state, opinion }>
  regions: Array<{ id, name, worldId, territoryIds }>
  territories: Array<{
    id, regionId, startingOwnerFactionId, neighborIds, terrain,
    resourceOutput: Partial<Resources>,
    polygon: { rings: … }
  }>
  allowUnevenAiSplit?: boolean
}
```

Geometry is world-local 2D (`+x` right, `+y` up). It is strategic geometry, not a pre-projected oblique/isometric mesh.

### `GET_FITNESS_CATALOG` payload

```
{
  workouts: WorkoutDefinition[]
  exercises: ExerciseDefinition[]
  purposes: WorkoutPurpose[]
  purposeSelections: Array<{ purpose: WorkoutPurpose, selectedWorkoutId: string }>
}
```

Static map: every purpose currently selects `wk_moderate_full_body`.

### `GET_WORKOUT_SELECTION` payload (spread)

```
{
  purpose: WorkoutPurpose
  selectedWorkoutId: string
  workout: WorkoutDefinition
  prescribedWorkout: {
    workoutId: string
    intendedDifficulty: WorkoutDifficulty
    personalized: boolean
    exercises: WorkoutDefinition['exercises']
  }
  source: 'tutorial' | 'purpose'
  tutorialBeat: Level1TutorialBeat | null
  expectedAction: Level1TutorialExpectedAction
  allowed: boolean
  recommendedInvasionId: string | null
  constraints: {
    requiresInvasionId: boolean
    workoutIdMustMatchSelection: boolean
  }
}
```

### Mutation payloads (success)

| commandId | payload fields |
| --- | --- |
| `ATTACK` | `attackOutcome`: `battle_resolved` \| `movement_started_for_attack` \| `invasion_created` \| `awaiting_defense` \| `failed` \| `skipped`. Plus outcome-specific: `battleResult`, `battleSeed`, `unopposed?`, `interactionKind`, `arrivalPending`, `armyId`, `targetTerritoryId`, `stagingTerritoryId`, `invasionId`, `responseDeadlineTick`, `notifiedAtTick`, `skipped`, `committedTroops`, `remainingBankedTroops`, `committedArmyId` |
| `MOVE` | `armyId`, `from`, `to`, `durationTicks`, `startedAtTick`, `arrivalTick`, `arrivalPending: true`, `movementStatus: 'moving'` |
| `BUILD` / `START_CONSTRUCTION` | `constructionId`, `projectType`, `remainingTicks`, `status` |
| `APPLY_CONSTRUCTION_ACCELERATION` | `constructionId`, `remainingTicks`, `status`, `completed: boolean` |
| `REINFORCE` | `territoryId`, `garrison` |
| `COLLECT_RESOURCES` | `territoryId`, `baseTotal`, `base` (deprecated), `baseResources`, `multiplier`, `collectedTotal`, `collected` (deprecated), `transferredResources`, `effectConsumed`, `transferred` (deprecated alias) |
| `DECLARE_WAR` / `NEGOTIATE` | `targetFactionId` |
| `SET_PLAYER_PAUSE` | `paused`, `pausedAtTick` |
| `SYNC_PLAYER_WORLD` | `previousWorldTick`, `worldTick`, `ticksAdvanced`, `chunks`, `targetWorldTick`, `worldAdvance` (`WorldAdvanceResult`), `foodConsumption` |
| `ADVANCE_WORLD` | `turn`, `worldTick`, `ticksAdvanced?`, `worldAdvance`, `foodConsumption?`, optional `tutorial` / `scriptedInvasionId` / `scriptedInvasionTargetId` |
| `TRANSITION_TO_NEXT_WORLD` | Either `{ alreadyCompleted: true, definitionWorldId, worldLevel }` or `{ alreadyCompleted: false, fromWorldId, fromWorldLevel, toWorldId, toWorldLevel, definitionWorldId, worldLevel }` |
| `AI_DECIDE` | `{ commitments: Array<{ factionId, commitment }> }` or `{ commitments: [], tutorialAiSuppressed: true }` |
| `RESOLVE_COMMITMENT` | varies: `commitmentOutcome`, `reassessmentRequired`, `action`, `targetId`, plus nested attack/move payloads; or `{ skipped: true }` / `{ waited: true }` |
| `START_WORKOUT` | `sessionId`, `purpose`, `state`, `invasionId`, `workoutId`, `selectedWorkoutId` |
| `RECORD_EXERCISE` | `sessionId`, `state`, `currentExerciseIndex` |
| `SKIP_REST` | `sessionId`, `state` |
| `PAUSE_WORKOUT` / `RESUME_WORKOUT` | `sessionId`, `state`, `pauseCount` |
| `SUBMIT_WORKOUT_FEEDBACK` | `sessionId`, `feedbackState` |
| `FINALIZE_WORKOUT` | `sessionId`, `purpose`, `alreadyProcessed`, `physicalOutput`, `bankedTroops`, `applicationId?`, `kind?`, `amountOrEffect?`, `invasionOutcome?`, `winner?`, `territoryOutcome?`, `territoryId?` — or failure payload `{ sessionId, pendingReward, error }` with `success: false` |
| `ABANDON_WORKOUT` | `sessionId`, `state`, `abandonmentReason`, `invasionOutcome?` |
| `RECORD_INTEGRITY_FLAG` | `sessionId`, `state`, `integrityFlagCount`, `abandonmentReason`, `invasionOutcome?` |

`ATTACK` `interactionKind`: `player_vs_ai` | `ai_vs_player` | `ai_vs_ai`

`MIN_ATTACKING_TROOPS` = `100`. Player banked-troop attacks must **exceed** 100.

---

## E. Error catalog

`ErrorCode` (`src/orchestration/errors.ts`). Persistence uses a **separate** `persistence.*` taxonomy (`src/persistence/errors.ts`).

### Implemented `ErrorCode` values that are actually thrown

| code | Typical condition | State mutated? |
| --- | --- | --- |
| `INVALID_COMMAND` | Unknown `commandId`, or missing handler | no |
| `FEATURE_NOT_IMPLEMENTED` | `OFFER_PEACE`, `TRADE` | no |
| `MISSING_PARAMETER` | Catalog required param missing; DEFENSE missing `invasionId`; `paused` not boolean; RECORD/SKIP missing `order` | no |
| `INVALID_PARAMETER` | Bad purpose/difficulty/workoutId/feedback/integrity type/`targetWorldTick`/`elapsedTicks`/`commitAmount`/`projectType`/`constructionId` collision; `invasionId` on non-DEFENSE | no |
| `INVALID_TARGET` | Illegal attack target, self-war, missing invasion, missing Golden Yield, missing construction project / pending effect | no (throw) |
| `INVALID_TERRITORY` | Unknown territory id | no |
| `INVALID_ARMY` | Unknown army / no army for retreat | no |
| `INVALID_FACTION` | Unknown faction; `GET_VISIBLE_WORLD` without viewer | no |
| `INSUFFICIENT_RESOURCES` | Cannot afford REINFORCE / START_CONSTRUCTION | no |
| `INSUFFICIENT_TROOPS` | `commitAmount` ≤ 100, exceeds banked Troops, or no legal staging tile (same code for two meanings) | no |
| `ACTION_NOT_ALLOWED` | Impersonation (`factionId` ≠ `playerFactionId`); tutorial gates; owned-tile collect; construction rules; busy workout; defense deadline; AI_DECIDE on player; no commitment; etc. | no (throw). Some attack fail-closed paths commit with `success: false` |
| `NOT_ADJACENT` | MOVE destination not adjacent / no adjacent army | no |
| `ENGINE_UNAVAILABLE` | Missing BattleEngine / DecisionEngine / EventEngine / `timeAuthority` | no |
| `ENGINE_ERROR` | Unexpected throw, or handler `commandSuccess: false` without errors | depends: unexpected throw rolls back; `commandSuccess: false` commits |
| `INVALID_GAME_STATE` | Missing WorldDefinition; missing catalog workout; post-command invariant failure | throw → orchestrator state unchanged |
| `WORKOUT_SESSION_INVALID` | No session / domain session error (wrong order, pause while paused, etc.). Domain codes are collapsed into this one code | no |
| `TIME_UNAUTHORIZED` | Catch-up rewind or `targetWorldTick` beyond `WorldTimeAuthority` | no |

### Enum members with **no throw sites**

| code | Status |
| --- | --- |
| `EVENT_NOT_FOUND` | Defined only. No `RESOLVE_EVENT` command. |
| `INVALID_CHOICE` | Defined only. |

### Persistence codes (not `CommandResponse.errors` unless mapped)

`persistence.not_found`, `already_exists`, `conflict`, `corrupt`, `unsupported_schema`, `invalid_state`, `time_unauthorized` (mapped to `TIME_UNAUTHORIZED` on `SYNC_PLAYER_WORLD` via orchestrator), `time_unavailable` (mapped to `INVALID_PARAMETER` on that path), `not_configured` (Supabase stubs), `save_failed`.

### Inconsistent codes (same class of failure, different code)

| Situation | Code used |
| --- | --- |
| Missing DEFENSE `invasionId` | `MISSING_PARAMETER` |
| Invasion not active / already defending / past deadline | `ACTION_NOT_ALLOWED` or `INVALID_TARGET` |
| Construction project missing | `INVALID_TARGET` |
| Construction id collision | `INVALID_PARAMETER` |
| No pending Golden Yield | `INVALID_TARGET` |
| No legal staging for attack | `INSUFFICIENT_TROOPS` (not `INVALID_TARGET`) |
| Workout domain failures | always `WORKOUT_SESSION_INVALID` |
| Faction impersonation | `ACTION_NOT_ALLOWED` with message `Action not allowed` (no distinct `unauthorized`) |
| Duplicate FINALIZE | `success: false` via `ACTION_NOT_ALLOWED` / pipeline (not `already_exists`) |

There is no `unauthorized`, `not_found`, `already_exists`, `conflict`, `invalid_phase`, or `invalid_workout_state` command error. Closest: `ACTION_NOT_ALLOWED`, `INVALID_TERRITORY`/`INVALID_ARMY`/`INVALID_FACTION`, `WORKOUT_SESSION_INVALID`, persistence `conflict` / `already_exists`.

---

## F. Identity contract

See also `docs/PLAYER_IDENTITY.md`.

| Id | Responsibility |
| --- | --- |
| `playerId` | Durable game identity. On `CommandRequest` and `PersistedWorldRecord`. **Not** on `GameState`. Workout sessions, pending construction/Golden Yield effects, defense mobilization, and history rows are keyed by it. |
| `playerFactionId` | In-world faction the human plays (`GameState` + authored `WorldDefinition.playerFactionId`, e.g. `f_player`). |
| `worldId` (persistence envelope) | Instance key. Prototype always `'local'` (`DEFAULT_WORLD_ID`). One world row per `playerId`. |
| `definitionWorldId` | Authored `WorldDefinition.worldId` (Level 1 / Level 2 / …). Geography via `WorldCatalog`. |
| `InitializePlayerWorldOptions.worldId` | **Authored** world to instantiate (defaults to production Level 1). Not the persistence envelope `worldId`. |

Who identifies the player: the caller of `execute` / `ensurePlayerWorld`. There is no auth provider, token, or anonymous flag.

Where `playerId` enters: `CommandRequest.playerId`; persistence APIs take `playerId` explicitly.

Where persisted: envelope `PersistedWorldRecord.playerId`; `WorkoutHistoryEntry.playerId`. Not inside the GameState snapshot as a root field.

Which commands require it: TypeScript requires it on every command. Handlers that **functionally** use it: workout start/finalize/history, Golden Yield collect, construction acceleration consume, telemetry.

`GameState` does **not** contain `playerId`. Internal nested records (session, effects) do.

New player: `ensurePlayerWorld` creates Level 1 once (`created: true`). `initializePlayerWorld` with a store throws `persistence.already_exists` on a second create.

Reconnect: `ensurePlayerWorld` loads (`created: false`). `syncPlayerWorld` catch-up; `createIfMissing` defaults **false**.

Auth layer assumptions:

1. Keep the same `playerId` across anonymous → account.
2. Do not mint a second id from the auth user id.
3. Do not merge two worlds.
4. Do not call `initializePlayerWorld` again for a new id.
5. Commands still send that `playerId`; `playerFactionId` stays the in-world faction.

`TRANSITION_TO_NEXT_WORLD` keeps `playerId` and player-scoped fitness history; it replaces world-scoped GameState.

---

## G. Persistence contract

### Game state — `GameStateStore`

Interface: `load` / `save` / `replace` / `transaction` (`src/persistence/types.ts`).

| | In-memory (`InMemoryGameStateStore`) | Supabase (`SupabaseGameStateStore`) |
| --- | --- | --- |
| Status | Real | Stub: every method throws / returns `persistence.not_configured` |
| Atomicity | Single-row replace; `transaction` is load-mutate-save | n/a |
| Idempotency | Optimistic concurrency via `expectedVersion` (`stateVersion`). Mismatch → `persistence.conflict`, row unchanged | n/a |
| First save | `expectedVersion = 0` | n/a |

Callers are expected to save explicitly after `Orchestrator.execute`.

Boot:

- `initializePlayerWorld`: create-only. Optional store persist at version 0.
- `ensurePlayerWorld`: load or create-once.

Commit helper: `commitAuthoritativePlayerWorld` saves GameState then history upserts; on history failure reverts both (in-memory only).

Transition helper: `persistWorldTransition` builds next state without mutating the passed `state`; saves or leaves store unchanged.

### Workout history — `WorkoutHistoryStore`

Interface: `upsert`, `get(playerId, sessionId)`, `recentCompleted`, `completedSince`, `sameExercisePrior`, `evidenceForFitness`, `clonePlayer`, `replacePlayer`.

| | In-memory | Supabase |
| --- | --- | --- |
| Status | Real (`InMemoryWorkoutHistoryStore`) | Stub `persistence.not_configured` |
| Scoping | Nested map keyed by `playerId` then `sessionId` | n/a |
| Atomic with world | Only via `commitAuthoritativePlayerWorld` | n/a |

Orchestrator finalize/abandon upserts history **if** `registry.workoutHistory` is set. That is still not a GameState save.

### Other stores

Telemetry recorder is append-only observation, not GameState. Supabase DDL/mappers exist; no live network adapter.

### Time

`WorldTimeAuthority.currentWorldTick()` is the legal “now” for catch-up. Tests use `FixedWorldTimeAuthority`. Clients cannot legally request a tick beyond it on `SYNC_PLAYER_WORLD` / `syncPlayerWorld`.

---

## H. Workout lifecycle

### Normal path

1. `GET_WORKOUT_SELECTION` `{ purpose }` → `allowed`, `selectedWorkoutId`, `prescribedWorkout`, `constraints`.
2. `START_WORKOUT` `{ purpose }` (omit `workoutId` unless you send the selected id).
3. Loop current exercise from `GET_GAME_STATE.playerGameplay.activeWorkout` (or start payload + subsequent record payloads):
   - REST + `skippable` → `SKIP_REST` `{ order }` or `RECORD_EXERCISE` with duration.
   - `prescription.kind === 'repetitions'` → `RECORD_EXERCISE` `{ order, repetitions }`.
   - `prescription.kind === 'duration'` → `RECORD_EXERCISE` `{ order, durationSeconds }`.
4. Optional `PAUSE_WORKOUT` / `RESUME_WORKOUT` while `state === 'ACTIVE'` / `'PAUSED'`.
5. When session `state === 'COMPLETED'` and `feedbackState === 'FEEDBACK_REQUIRED'` → `SUBMIT_WORKOUT_FEEDBACK` `{ value }`.
6. `FINALIZE_WORKOUT` → rewards (`bankedTroops` / pending effects / defense resolution).

### Other commands

- `ABANDON_WORKOUT`: terminal. DEFENSE resolves the linked invasion as failed defense.
- `RECORD_INTEGRITY_FLAG`: first flag records; **second** abandons (same defense resolution).
- `SKIP_REST`: current REST only.

### Frontend must know before start

From `GET_WORKOUT_SELECTION`: `allowed`, `selectedWorkoutId`, `prescribedWorkout.exercises`, `constraints.requiresInvasionId`, `recommendedInvasionId`, tutorial `expectedAction` / `workoutIdMustMatchSelection`.

Also from `GET_GAME_STATE`: no busy `activeWorkout` in `ACTIVE`/`PAUSED`/`NOT_STARTED`; `bankedTroops` / invasions as needed.

Current exercise: `activeWorkout.currentExercise` + `currentExerciseIndex`. Progression is server-authoritative.

Rest: skippable REST may be skipped. Non-skippable REST must be recorded as duration.

Pause: `PAUSE_WORKOUT` payload includes `pauseCount`; GET_GAME_STATE `activeWorkout` does **not** include `pauseCount` (only `state: 'PAUSED'`).

Finalization: session must be eligible (`COMPLETED` + feedback submitted **or** `NOT_APPLICABLE`). DEFENSE extra: matching open invasion, start before response deadline, complete before defense completion deadline.

Rewards: do not accept client-fabricated rewards. Read `FINALIZE_WORKOUT` payload + `GET_GAME_STATE` `bankedTroops` / pending effects.

### Level 1 first workout (`NOT_APPLICABLE`)

`shouldWaiveWorkoutFeedback`: Level 1 tutorial gating, beat `FIRST_WORKOUT_PENDING`, purpose `NORMAL_TROOPS`, matching first session.

When the last exercise completes, `feedbackState` becomes `NOT_APPLICABLE`. Frontend **must not** require `SUBMIT_WORKOUT_FEEDBACK`. Later Level 1 workouts (`FINAL_WORKOUT_PENDING` and any other) still use `FEEDBACK_REQUIRED`.

`START_WORKOUT` `constructionId` / `collectionTerritoryId` are stamps for later reward application. They do not start construction or collect.

One active session at a time (`ACTION_NOT_ALLOWED` if busy).

---

## I. Tutorial contract

Public view (`serializeLevel1TutorialView`) on **both** `gameState.tutorial` and `playerGameplay.tutorial`, and on `visibleWorld.tutorial`.

```
{
  active: boolean
  beat: Level1TutorialBeat | null
  expectedAction: 'START_WORKOUT_NORMAL_TROOPS' | 'ATTACK' | 'START_WORKOUT_DEFENSE' | 'NONE'
  expectedPurpose: WorkoutPurpose | null
  expectedWorkoutId: string | null
  nextActionAllowed: boolean
  scriptedInvasionOccurred: boolean
  scriptedInvasionId: string | null
  scriptedInvasionTargetId: string | null
  firstAttackTerritoryIds: string[]     // only when beat === FIRST_ATTACK_AVAILABLE
  finalAttackTerritoryIds: string[]     // only when beat === FINAL_ATTACK_AVAILABLE
  defenseInvasionId: string | null
  completed: boolean
}
```

Beats (authority): `FIRST_WORKOUT_PENDING` → `FIRST_ATTACK_AVAILABLE` → `SCRIPTED_ATTACK_PENDING` → `DEFENSE_PENDING` → `FINAL_WORKOUT_PENDING` → `FINAL_ATTACK_AVAILABLE` → `COMPLETE`.

| Beat | expectedAction | Notes |
| --- | --- | --- |
| FIRST_WORKOUT_PENDING | START_WORKOUT_NORMAL_TROOPS | First-workout feedback waived on complete |
| FIRST_ATTACK_AVAILABLE | ATTACK | Legal targets in `firstAttackTerritoryIds`; banked-troop ATTACK |
| SCRIPTED_ATTACK_PENDING | NONE | Scripted raid; AI otherwise suppressed |
| DEFENSE_PENDING | START_WORKOUT_DEFENSE | `defenseInvasionId` / selection `recommendedInvasionId` |
| FINAL_WORKOUT_PENDING | START_WORKOUT_NORMAL_TROOPS | Feedback required |
| FINAL_ATTACK_AVAILABLE | ATTACK | `finalAttackTerritoryIds` |
| COMPLETE | NONE | Overlay done |

**Simulation authority:** `src/gameplay/tutorial/level1.ts` (gating, legal attack tiles, scripted invasion, AI suppression, beat transitions). Persistence overlay: `GameState.level1Tutorial`.

**Frontend presentation:** render `beat` / `expectedAction` / allowed target lists / `nextActionAllowed`. Do not reimplement beat transitions.

On non-Level-1 worlds the view is inactive (`active: false`, empty target lists).

---

## J. World / economy / combat contracts

### Combat / army actions

| Action | Prerequisites | Client input | Immediate? | Workout? | Follow-up |
| --- | --- | --- | --- | --- | --- |
| `ATTACK` | Foreign-owned target; tutorial legal tiles; player typically `commitAmount` > 100 from `bankedTroops`; staging army or one-hop | `territoryId`, optional `commitAmount`, optional `seed` | Immediate battle if staged; else march (`arrivalPending`) | No (offense uses banked Troops from a prior workout) | After march, world ticks resolve; AI vs player may become `invasion_created` |
| `MOVE` | Owned army, adjacent dest | `armyId`, `destinationTerritoryId` | Command immediate; arrival over ticks | No | Wait for arrival via sync/advance |
| `REINFORCE` | Owned territory; 250 gold + 150 food (`BALANCE.economy.reinforcementCost`); +100 garrison | `territoryId` | Immediate | No | none |
| `DECLARE_WAR` | Other faction | `targetFactionId` | Immediate relationship `at_war` | No | none |
| `NEGOTIATE` | Other faction | `targetFactionId` | Immediate small opinion bump | No | none |
| `OFFER_PEACE` / `TRADE` | — | — | Unsupported | — | — |

AI vs player `ATTACK` with immediate armies creates an invasion (`attackOutcome: 'invasion_created'`) instead of an instant battle. Player defends with a DEFENSE workout.

### Construction / economy

Source of truth: GameState + `GAMEPLAY_CONFIG` / construction definitions. **Costs are not on GET_GAME_STATE.**

| projectType | Gold | Other | Duration ticks | Extra rules |
| --- | --- | --- | --- | --- |
| FORTIFICATION | 40 | stone 20 | 20 | Requires city; max fort level 5 |
| CITY | 80 | stone 40, iron 40 | 30 | One city per territory |
| FARM | 30 | wood 20 | 20 | Occupancy stamp |
| MINE | 40 | wood 25 | 20 | Occupancy stamp |
| LUMBER | 30 | stone 20 | 20 | Occupancy stamp |

| Action | Source of truth | Notes |
| --- | --- | --- |
| Display resources | `playerGameplay.resources` | `gold/food/iron/wood/stone` |
| Uncollected yield | `playerGameplay.uncollected[territoryId]` | Derived from accrual + production since `lastAccrualTick` |
| Farm/Mine/Lumber | territory `farm/mine/lumber` booleans and `playerGameplay.infrastructure` | Occupancy, not buildings list |
| Cities | `playerGameplay.cities` | Created by CITY construction complete |
| Fort level | territory `fortification` | Raised by FORTIFICATION complete |
| Collect | `COLLECT_RESOURCES` | Immediate. Optional Golden Yield multiplier consumed on success |
| Golden Yield pending | `pendingGoldenYieldEffects[].multiplier` | Produced by GOLDEN_YIELD workout finalize |
| Start construction | `START_CONSTRUCTION` (prefer over `BUILD`) | Immediate spend; remaining time ticks down on world advance |
| Extra workers | `APPLY_CONSTRUCTION_ACCELERATION` | Consumes one pending effect; `START_WORKOUT` `constructionId` is only a stamp |
| Food | `resources.food`; consumption on ADVANCE/SYNC | Gated off while `worldLevel < 2`. Stability is internal, not public |
| Empire pause | `SET_PLAYER_PAUSE` / `empirePaused` | Freezes player-facing invasion/construction clocks; AI still simulates |

`BUILD` = `START_CONSTRUCTION` FORTIFICATION.

### Map / world representation

| Need | Where |
| --- | --- |
| Runtime owners, garrison, forts, farm/mine/lumber, adjacency ids | `GET_GAME_STATE` / `GET_VISIBLE_WORLD` territories |
| Polygons, island outline, region names, starting owners | `GET_WORLD_DEFINITION` |
| Armies | public army rows (fog-of-numbers on foreign troops) |
| Visual art / oblique projection | **Not** in WorldDefinition. Renderer projects `WorldVec2` (+x right, +y up) |

Compatible with a planned angled 2D / oblique illustrated map: treat polygons as strategic geometry; do not assume they are the final sprite layout. `containedWorlds.placement` is authored placement metadata, not a camera.

---

## K. Sync / catch-up contract

Two entry points:

1. **`Orchestrator.execute({ commandId: 'SYNC_PLAYER_WORLD' })`** — mutates in-memory state, does **not** save.
2. **`syncPlayerWorld({ playerId, store, authority, requestedTick?, history? })`** — load → catch-up → retry pending workout reward → invariant check → **save once**.

### Input

- `targetWorldTick` / `requestedTick` optional.
- If omitted: authority’s `currentWorldTick()`.
- Rejected if not an integer, if `< state.worldTick` (rewind), if `> authority` (`TIME_UNAUTHORIZED` / `persistence.time_unauthorized`).
- Missing `timeAuthority` on the orchestrator path: `ENGINE_UNAVAILABLE`.

`ADVANCE_WORLD` is **not** gated by `WorldTimeAuthority`. `elapsedTicks` (default 1) steps the simulator directly.

### Catch-up behavior

`catchUpWorld` chunks `ADVANCE_WORLD` with `catchUpCompact: true`:

**Hidden / dropped in compact inspectable `worldAdvance`:**

- Per-tick `worldTick` `stateChanges` (one summary change at the end)
- `commitmentProgress` records
- Empty event-turn rows (`triggered === 0`)
- Event ids starting with `sum_`
- Info-severity “World events” notifications
- In-flight movement results with `status === 'moving'`
- Handler `stateChanges` other than territory or army `location`
- AI commitment entity noise filtered similarly

**Still returned:**

- Semantic `events`
- `commitmentResolutions`
- Non-moving movement results (arrived / interrupted)
- `foodConsumption` aggregate
- Counts: `previousWorldTick`, `worldTick`, `ticksAdvanced`, `chunks`, `targetWorldTick`

`commitmentResolutions` can still grow on long catch-up. Frontend should **not** reconstruct the world from `worldAdvance`. After sync: `GET_GAME_STATE` / `GET_VISIBLE_WORLD` are the replacement view.

`syncPlayerWorld` result (`SyncPlayerWorldSuccess`): `{ ok: true, persisted: true, state, record, catchUp, pendingRetry? }`. The application server should expose the public snapshot, not raw `state`.

AI: compact catch-up still runs DecisionEngine; inspectable `aiDecisions` are reduced vs live `ADVANCE_WORLD`. Do not show raw `commitments` arrays from `AI_DECIDE` to the product UI.

---

## L. Client / server authority matrix

| Field | Class | Notes |
| --- | --- | --- |
| `territoryId`, `armyId`, `destinationTerritoryId`, `constructionId`, `invasionId`, `targetFactionId`, `purpose`, `order`, `projectType`, `paused` | **A** Safe declarative | Server validates |
| `repetitions`, `durationSeconds`, feedback `value` | **B** Player-entered gameplay | Server ranges/enums; value comes from the player |
| `commitAmount` | **B** | Player chooses how many banked Troops to send; server enforces > 100 and ≤ banked |
| `workoutId` | **A/B** | Optional; tutorial may require the selected id |
| `intendedDifficulty` | **B** | Optional override of catalog difficulty |
| `sessionId` | **A** (weak) | Client may supply; not authenticated; collision risk |
| `useGoldenYield` / `consumeGoldenYield` | **A** | Boolean intent to consume a **server** pending effect |
| `worldTick`, troops, owners, rewards, `bankedTroops`, remaining construction, invasion deadlines | **C** Server-authoritative | Never accept as client truth |
| Next world id | **C** | `TRANSITION_TO_NEXT_WORLD` ignores client `worldId` |
| Viewer faction | **C** | `resolveViewerFactionId` uses `playerFactionId` when set |
| `seed` on ATTACK | **C leak** | Client may override BattleEngine RNG |
| Envelope `timestamp` | **D** unused | Only requestId synthesis |
| `clientContext` | unused | |
| `now` on workout commands | **D** | **Workout timestamp issue** (below) |
| `targetWorldTick` | **D** gated | Legal only ≤ `WorldTimeAuthority` |
| `elapsedTicks` on `ADVANCE_WORLD` | **D** ungated | Harness time skip |
| `factionId` | **A** if equal to player; else rejected (except WORLD/AI/SYSTEM) | |

### Workout timestamp issue (do not “fix” in this phase)

Fitness handlers use `sessionNow = parameters.now ?? worldTick * 60_000`.

- Envelope `CommandRequest.timestamp` is **not** the session clock.
- If the client omits `now`, the clock is derived from **world ticks × 60s**, not wall clock. That is not real elapsed workout time.
- If the client supplies `now`, that value drives pause intervals, `activeDurationMs` (fitness evidence speed), feedback `submittedAt`, integrity `recordedAt`.
- There is no server-side monotonic wall clock for workouts and no anti-cheat bound against jumping `now`.
- World simulation time for invasions/construction remains `worldTick` / `playerFacingTick` (empire pause aware) and is separate from the session clock.

Classify `now` as **currently client-supplied timing data** that affects fitness evidence and pause accounting, **not** world rewards/invasions/construction remaining ticks.

---

## M. Discrepancies / blockers

### BLOCKER BEFORE FRONTEND

1. **Application server must persist.** `Orchestrator.execute` never writes the store. An HTTP layer that only calls `execute` will lose the empire on process restart.
2. **Do not expose the full catalog as player HTTP.** `ADVANCE_WORLD` skips `WorldTimeAuthority`. `AI_DECIDE` / `RESOLVE_COMMITMENT` skip player faction authz. A naive “every COMMAND_INDEX route” API lets a client fast-forward the world and drive AI.
3. **Reconnect path is `syncPlayerWorld` (save) or `SYNC_PLAYER_WORLD` + explicit save**, plus `GET_GAME_STATE`. Compact `worldAdvance` is not a full world replacement.
4. **Identity is caller-supplied `playerId` with no authentication.** The HTTP layer must bind the authenticated account to one `playerId` before commands run. Empty `playerId` is currently accepted by the orchestrator.

### SHOULD FIX BEFORE FRONTEND

1. **Workout `now` is client-authoritative** (section L). Integrity/evidence can be spoofed; omitted `now` is not wall time.
2. **`ATTACK` `seed` override** lets the client influence battle RNG.
3. **`GET_GAME_STATE` exposes `worldSeed`**, which is the battle/event RNG root.
4. **No public cost catalog** (construction / reinforce). Replit would otherwise hardcode `GAMEPLAY_CONFIG` / `BALANCE`.
5. **`activeWorkout` omits `pauseCount` / session clock fields** that `PAUSE_WORKOUT` returns. Pause UI can use `state === 'PAUSED'` but cannot show pause count after a later GET.
6. **`GET_WORLD_DEFINITION` clones AI personality traits and starting armies** — more internal than a map client needs.
7. **`COLLECT_RESOURCES` accepts undocumented `consumeGoldenYield`.**
8. **`ATTACK` / `MOVE` accept undocumented `commitmentId`.**
9. **Catalog error lists are incomplete** (e.g. `GET_GAME_STATE` lists `INVALID_FACTION` but does not throw it; workout commands omit `MISSING_PARAMETER` / `ACTION_NOT_ALLOWED` variants).
10. **`newlyAvailableActions` is always empty** — UI must use tutorial `expectedAction` + local enablement from public state.
11. **`START_WORKOUT` `sessionId` is client-chosen** with no uniqueness guarantee vs history.

### KNOWN / INTENTIONAL

1. `OFFER_PEACE`, `TRADE` catalogued unsupported.
2. `SYNC_PLAYER_WORLD` wired in `orchestrator.ts`, not `MUTATING_HANDLERS`.
3. `BUILD` is a legacy alias of fortification construction.
4. Foreign army `troops` rounded to nearest 50.
5. Current world fully visible (no territory fog).
6. Polygons only on `GET_WORLD_DEFINITION`, not GameState.
7. Tutorial duplicated on `gameState.tutorial` and `playerGameplay.tutorial`.
8. `GET_VISIBLE_WORLD` has no HUD/`playerGameplay`.
9. Telemetry does not fire on `GET_*`.
10. Compact catch-up hides per-tick inspectable noise after the catch-up optimization.
11. Level 1 first workout feedback `NOT_APPLICABLE`.
12. Food consumption disabled while `worldLevel < 2`.
13. `EVENT_NOT_FOUND` / `INVALID_CHOICE` reserved, unused.
14. `clientContext` and envelope `timestamp` unused for gameplay.
15. `ADVANCE_WORLD` `factionId` unused.
16. `TRANSITION_TO_NEXT_WORLD` ignores client `worldId` (fail-closed next registered production world).
17. Viewer `factionId` ignored when `playerFactionId` is set.

### DEFERRED

1. HTTP server, REST/GraphQL/WebSockets, Replit UI.
2. Live Supabase GameState / history / telemetry adapters (`not_configured`).
3. Authentication providers.
4. Public schema redesign (narrower world definition, pause fields, cost catalog).
5. New gameplay commands (`RESOLVE_EVENT`, trade, peace).
6. Binding `WorldTimeAuthority` to a real server clock in production.
7. Anti-cheat for workout `now` / battle `seed`.

No catalog command lacks an implementation except the two `unsupported` rows. No implemented command is missing from the catalog. `SYNC_PLAYER_WORLD` is the only implemented mutator not in `MUTATING_HANDLERS` (special-cased; tested).

---

## Test contract examples

Fixtures from `tests/orchestratorIntegration.ts` unless noted. `playerId: 'player_1'`. Level 1 home `t_02`, enemy `t_01`. Workout `wk_moderate_full_body`.

### GET_COMMAND_INDEX

`parameters: {}` → `success: true`, `payload.commands` ids equal `COMMAND_INDEX` order, `payload.summary.count === 32`.

### GET_GAME_STATE

After `initializePlayerWorld({ playerId: 'player_1', seed: 5 })`: `definitionWorldId` production Level 1, `worldLevel: 1`, `playerFactionId: 'f_player'`, `playerGameplay` present for that viewer.

`tests/worldTransition.ts`: before transition, `worldCompletion.complete === true`, `worldTransition.eligible === true`, `worldTransition.nextWorldId` = production Level 2.

### GET_VISIBLE_WORLD

Same boot: `success: true`, `payload.visibleWorld.territories` / `armies` / `tutorial`. No `playerGameplay`.

### START_WORKOUT → RECORD_EXERCISE → FINALIZE

```
START_WORKOUT { purpose: 'NORMAL_TROOPS', sessionId: 'wses_slice', now: 1000 }
→ payload.workoutId === 'wk_moderate_full_body', success

RECORD_EXERCISE { order, repetitions | durationSeconds, now: clock }
SKIP_REST { order, now: clock }   // skippable REST

SUBMIT_WORKOUT_FEEDBACK { value: 'ABOUT_RIGHT', now: 40000 }  // non-waived path
FINALIZE_WORKOUT { now: 41000 }
→ alreadyProcessed: false, applicationId: string, physicalOutput: number
→ bankedTroops increased

FINALIZE_WORKOUT again → success: false, banked Troops unchanged
```

Level 1 **first** workout: skip `SUBMIT_WORKOUT_FEEDBACK` when `feedbackState === 'NOT_APPLICABLE'` (`tests/level1Tutorial.ts`).

### PAUSE_WORKOUT / RESUME_WORKOUT

`tests/workoutPauseResume.ts`: `START_WORKOUT` with `now`, `PAUSE_WORKOUT { now }`, `RESUME_WORKOUT { now }`. Payload `{ sessionId, state, pauseCount }`. Rejects pause-while-paused / resume-while-active with `WORKOUT_SESSION_INVALID`.

### ATTACK

```
ATTACK { territoryId: 't_01', commitAmount: MIN_ATTACKING_TROOPS + 40, seed: 11 }
→ committedTroops, attackOutcome: 'battle_resolved',
  battleResult.winner === 'attacker', territoryOutcome === 'captured'
```

Overspend `commitAmount` → `success: false`.

### BUILD / START_CONSTRUCTION / COLLECT_RESOURCES

Construction payload `{ constructionId, projectType, remainingTicks, status }`. Collect payload includes `transferredResources`, `multiplier`, `effectConsumed`. Tests: `tests/economyCities.ts`, `tests/economyDevelopments.ts`, `tests/gameplayConsumption.ts`.

### SYNC_PLAYER_WORLD

Requires `registry.timeAuthority`. Payload tick fields + compact `worldAdvance`. Persistence tests use `syncPlayerWorld()` which also saves (`tests/persistence.ts`).

### TRANSITION_TO_NEXT_WORLD

`tests/worldTransition.ts` sends `{ worldId: 'w_ember_atoll' }` (ignored). Success payload `alreadyCompleted: false`, `toWorldId` production Level 2. `playerId` unchanged. Tutorial overlay null on Level 2. Client still needs `GET_GAME_STATE` for the new map.

Command-index consistency tests: `tests/orchestratorIntegration.ts` — `command catalog matches routed handlers` and `GET_COMMAND_INDEX payload matches COMMAND_INDEX`.
