/**
 * CANONICAL RUNTIME GAME STATE (AUTHORITATIVE RUNTIME GAMESTATE PASS)
 * =====================================================================
 *
 * This is the ONE authoritative runtime representation of "the current
 * world" for Rep Wars. It is the source of truth for territories, armies,
 * factions/warlords (resources, diplomacy, personality, ambition, goals,
 * memory), the player, active events/history, AI commitments, and
 * authored-world identity (`definitionWorldId` / level). Geometry stays
 * on WorldDefinition. The current world is fully visible.
 *
 * Engines (BattleEngine, WorldSimulator/EventEngine, DecisionEngine)
 * calculate/propose results from a narrow, engine-specific
 * read view of this state (see `src/state/gameStateAdapters.ts`). They do
 * not hold a second authoritative copy of the world. The Orchestrator
 * (`src/orchestration/`) applies engine results back onto `GameState`.
 * `src/simulation/cli.ts` remains a separate harness and is not the
 * runtime mutation boundary. See docs/ORCHESTRATOR_ARCHITECTURE.md and
 * docs/PLAYER_AI_INTERACTION_ARCHITECTURE.md.
 *
 * Construction / lifecycle helpers for this type live in `src/state/`, not
 * here, so this file stays a pure type/shape definition:
 *  - `src/state/createGameState.ts`      — deterministic initialization
 *  - `src/state/cloneGameState.ts`        — deep clone with no shared
 *                                           mutable nested state
 *  - `src/state/gameStateInvariants.ts`   — structural integrity checks
 *  - `src/state/gameStateAdapters.ts`     — read-only views for engine
 *                                           call boundaries + commitment
 *                                           sync
 *
 * Rules (unchanged from the phase-3 canonical-types pass, still enforced):
 *  - Every field here must correspond to a concept that genuinely already
 *    exists elsewhere in the codebase (see the canonical types imported
 *    below). Nothing is invented just to fill out the conceptual hierarchy.
 *  - Concepts with no real implementation yet (persistence) are called
 *    out as deferred in comments rather than stubbed with fake fields.
 *    Continuous simulation time is `worldTick` (Phase 13). Prototype 1
 *    cities/economy live on this type (Phase 17J).
 *  - Do NOT import this file from `src/types/index.ts`. `EventModel` (for
 *    `ActiveEvent`/`HistoryEntry`) already imports FROM `../types`, so
 *    re-exporting this from the `types` barrel would create an import
 *    cycle. Import it directly: `import { GameState } from '../types/GameState'`.
 *
 * See docs/AUTHORITATIVE_GAMESTATE_ARCHITECTURE.md for the full audit,
 * ownership map, initialization/cloning/invariant strategy, and data-flow
 * diagram. See docs/CANONICAL_STATE_ARCHITECTURE.md for the phase-3 audit
 * this type originated from.
 */
import { AICommitment, Army, ArmyId, FactionId, RegionId, Resources, Territory, TerritoryId, WarlordSnapshot } from './index';
import { ActiveEvent, HistoryEntry } from '../events/EventModel';
import { FitnessEstimate } from '../fitness/estimate/types';
import { WorkoutSession } from '../fitness/session/types';
import { PlayerProgressionState, emptyPlayerProgressionState } from '../fitness/progression/types';
import { GameRewardResult } from '../rewards/types';

/**
 * Bumped only when the shape of `GameState` changes in a way a future
 * persistence/replay layer would need to know about. Not a balance value —
 * do not read this from `BALANCE`.
 *
 * 3 = Phase 14 `Army.movement` (adjacent-hop logistics).
 * 4 = Phase 15 `Army.attackIntent` (MOVE → ATTACK staging).
 * 5 = Phase 17H player reward application (`playerRewards`, `activeInvasions`).
 * 6 = Phase 17I gameplay consumption (construction, fitness compact state,
 *     pause, attacker cooldowns).
 * 7 = Phase 17J economy / cities (territoryEconomy, cities, construction
 *     lastProgressTick).
 * 8 = Phase 17K invasion lifecycle (pending_response / defense_in_progress,
 *     defense completion timeout).
 * 9 = Phase 17N.2 / 17P authored worlds (definition identity, regions, no
 *     tile fog, no territory names/capitals, CITY construction). Persistence
 *     envelope also copies definitionWorldId / format / level / playerFactionId.
 * 10 = Level-anchor territories and level-defeat hook. Anchors are the
 *     player's starting tiles for the current world; they are not capitals.
 * 11 = Economy v1 foundations: lastFoodConsumptionTick + territoryInfrastructure
 *     (Farm/Mine/Lumber occupancy). Consumption and developments are not
 *     executed in this schema bump.
 * 12 = Level 1 tutorial controller (`level1Tutorial` beat + scripted-invasion stamps).
 * playerFitness.progression is coerced onto existing schema 12 without a bump.
 */
export const GAME_STATE_SCHEMA_VERSION = 12;

export type InvasionId = string;

/** Temporary construction-acceleration units. Not Troops, not buildings. */
export interface PendingConstructionEffect {
  applicationId: string;
  sessionId: string;
  workoutId: string;
  playerId: string;
  workerPower: number;
  permanence: 'TEMPORARY_ACCELERATION';
  appliedAtTick: number;
  sourcePhysicalOutput: number;
}

/**
 * One-time Golden Yield collection effect. Economy consumes this on a
 * single successful COLLECT_RESOURCES; it is not a lasting multiplier.
 */
export interface PendingGoldenYieldEffect {
  applicationId: string;
  sessionId: string;
  workoutId: string;
  playerId: string;
  multiplier: number;
  effect: 'ONE_TIME_COLLECTION';
  permanence: 'EPHEMERAL';
  consumed: false;
  appliedAtTick: number;
  sourcePhysicalOutput: number;
}

/** Persistence-ready ledger entry so the same reward event cannot grant twice. */
export interface AppliedRewardRecord {
  applicationId: string;
  sessionId: string;
  kind: 'TROOPS' | 'EXTRA_CONSTRUCTION_WORKERS' | 'GOLDEN_YIELD' | 'DEFENSE_MOBILIZATION';
  appliedAtTick: number;
  /** JSON-safe snapshot of the original successful application result. */
  result: Record<string, unknown>;
}

export interface PlayerRewardState {
  /** Integer reserve. Unlimited storage in Prototype 1. Not deployed military. */
  bankedTroops: number;
  pendingConstructionEffects: PendingConstructionEffect[];
  pendingGoldenYieldEffects: PendingGoldenYieldEffect[];
  appliedRewards: AppliedRewardRecord[];
}

export interface DefenseMobilizationAttachment {
  applicationId: string;
  sessionId: string;
  workoutId: string;
  playerId: string;
  defensePower: number;
  attachedAtTick: number;
  /** Authoritative workout-start tick for a future 30-minute response check. */
  workoutStartedAtTick: number | null;
  sourcePhysicalOutput: number;
}

/**
 * Minimal active-invasion record. Not a battle result and not a timer engine.
 * DEFENSE rewards attach here; they fail if no matching record exists.
 */
export type InvasionStatus = 'pending_response' | 'defense_in_progress';

/**
 * Open invasion record. Terminal invasions are removed from `activeInvasions`
 * after exactly one resolution (undefended, timeout, abandon, or battle).
 *
 * Deadline convention: the deadline tick is the last valid tick.
 * Expired iff `now > deadlineTick`.
 */
export interface ActiveInvasion {
  id: InvasionId;
  defenderFactionId: FactionId;
  attackerFactionId: FactionId;
  territoryId: TerritoryId;
  startedAtTick: number;
  notifiedAtTick: number;
  responseDeadlineTick: number;
  status: InvasionStatus;
  defenseMobilization: DefenseMobilizationAttachment | null;
  /** Set when a DEFENSE workout starts in time; completion may be later. */
  defenseWorkoutStartedAtTick: number | null;
  /** Inclusive last tick the in-progress defense may still complete. */
  defenseCompletionDeadlineTick: number | null;
  defenseSessionId: string | null;
  attackingArmyIds: string[];
  battleSeed: number | null;
  commitmentId: string | null;
}

export type ConstructionId = string;
export type ConstructionProjectType = 'CITY' | 'FORTIFICATION' | 'FARM' | 'MINE' | 'LUMBER';
export type ConstructionProjectStatus = 'in_progress' | 'completed';
export type CityId = string;
export type CityBuildingType = 'CITY' | 'FORTIFICATION';

export interface CityBuilding {
  type: CityBuildingType;
  level: number;
  completedAtTick: number;
}

/**
 * Authored named region index for the current world. Polygons stay on
 * WorldDefinition; this is membership + display name only.
 */
export interface RuntimeRegion {
  id: RegionId;
  name: string;
  territoryIds: TerritoryId[];
}
export interface City {
  id: CityId;
  territoryId: TerritoryId;
  factionId: FactionId;
  buildings: CityBuilding[];
}

/**
 * Lazy territory production ledger. Uncollected yield is not the faction
 * reserve (`WarlordSnapshot.resources`). Missing records do not backfill
 * from world start.
 */
export interface TerritoryEconomy {
  territoryId: TerritoryId;
  lastAccrualTick: number;
  uncollected: Resources;
}

/**
 * Completed resource-development occupancy. Null ticks mean the
 * development is absent. Production reads these flags at collect/accrual
 * time; they never rewrite `Territory.resourceOutput`.
 */
export interface TerritoryInfrastructure {
  territoryId: TerritoryId;
  farmCompletedAtTick: number | null;
  mineCompletedAtTick: number | null;
  lumberCompletedAtTick: number | null;
}

export function emptyTerritoryInfrastructure(territoryId: TerritoryId): TerritoryInfrastructure {
  return {
    territoryId,
    farmCompletedAtTick: null,
    mineCompletedAtTick: null,
    lumberCompletedAtTick: null,
  };
}

export interface ConstructionProject {
  id: ConstructionId;
  factionId: FactionId;
  territoryId: TerritoryId;
  projectType: ConstructionProjectType;
  startedAtTick: number;
  /** Last worldTick at which remainingTicks was caught up. */
  lastProgressTick: number;
  durationTicks: number;
  remainingTicks: number;
  status: ConstructionProjectStatus;
  completedAtTick: number | null;
}

export interface CompactWorkoutHistoryEntry {
  sessionId: string;
  completedAt: number;
  completedAtTick: number;
  purpose: string;
}

export interface StoredRewardApplicationContext {
  playerId: string;
  factionId?: string;
  mode: 'banked' | 'live';
  invasionId?: string;
  constructionId?: string;
  collectionTerritoryId?: string;
  workoutStartedAtTick?: number | null;
  rewardApplicationId?: string;
}

export interface PendingWorkoutReward {
  sessionId: string;
  reward: GameRewardResult;
  context: StoredRewardApplicationContext;
}

export interface PlayerFitnessState {
  estimate: FitnessEstimate | null;
  lastWorkoutCompletedAtTick: number | null;
  compactHistory: CompactWorkoutHistoryEntry[];
  /** At most one in-progress session. Not a historical dump. */
  activeSession: WorkoutSession | null;
  pendingReward: PendingWorkoutReward | null;
  /** Authored band + movement-family readiness. Not a universal fitness scalar. */
  progression: PlayerProgressionState;
}

export interface PlayerEmpirePause {
  paused: boolean;
  pausedAtTick: number | null;
}

export interface AttackerCooldown {
  recoveryUntilTick: number | null;
  continuationUntilTick: number | null;
}

export type LevelDefeatStatus = 'active' | 'defeated';

/**
 * Authoritative Level 1 tutorial beats. Only used when
 * `definitionWorldId` is the production Level 1 world and a player faction exists.
 * Not a general narrative engine.
 */
export const LEVEL1_TUTORIAL_BEATS = [
  'FIRST_WORKOUT_PENDING',
  'FIRST_ATTACK_AVAILABLE',
  'SCRIPTED_ATTACK_PENDING',
  'DEFENSE_PENDING',
  'FINAL_WORKOUT_PENDING',
  'FINAL_ATTACK_AVAILABLE',
  'COMPLETE',
] as const;

export type Level1TutorialBeat = (typeof LEVEL1_TUTORIAL_BEATS)[number];

export type Level1TutorialExpectedAction =
  | 'START_WORKOUT_NORMAL_TROOPS'
  | 'ATTACK'
  | 'START_WORKOUT_DEFENSE'
  | 'NONE';

/**
 * Persisted Level 1 tutorial overlay. Null on non-tutorial worlds.
 * Flags are the source of truth; `beat` is the last computed public step.
 */
export interface Level1TutorialState {
  active: boolean;
  beat: Level1TutorialBeat;
  firstWorkoutSessionId: string | null;
  firstConquestTerritoryId: TerritoryId | null;
  scriptedInvasionId: InvasionId | null;
  scriptedInvasionTargetId: TerritoryId | null;
  defenseResolved: boolean;
  secondWorkoutSessionId: string | null;
  completed: boolean;
}

/**
 * Current-level foothold / defeat hook. Not a capital system.
 * Previous-level player worlds are not stored here.
 */
export interface LevelDefeatState {
  status: LevelDefeatStatus;
  defeatedAtTick: number | null;
  defeatedLevel: number | null;
  defeatedWorldId: string | null;
  lastLostAnchorTerritoryId: TerritoryId | null;
  /** WorldDefinition.containedWorlds worldIds at init. Demotion is future work. */
  previousWorldIds: string[];
}

export interface GameState {
  /** Schema/version marker for this shape. See `GAME_STATE_SCHEMA_VERSION`. */
  schemaVersion: number;
  /**
   * Integer EventEngine / DecisionEngine clock. Advanced by the
   * Continuous World Engine through a documented tick→turn adapter
   * (`BALANCE.world.ticksPerEventTurn`). Player commands do not wait on
   * this counter.
   */
  turn: number;
  /**
   * Canonical continuous simulation time. Monotonic integer ticks from
   * world start (`0`). Deterministic: advanced only by `ADVANCE_WORLD`
   * / `ContinuousWorldEngine`, never by `Date.now()`. Elapsed simulation
   * time from start is this value.
   */
  worldTick: number;
  /**
   * Last world tick at which Food consumption was applied (or skipped
   * while Level 1-gated). Schema 11 stores the stamp only — consume is
   * not executed yet. Initialized to `worldTick` so later enablement
   * does not back-charge missed cycles.
   */
  lastFoodConsumptionTick: number;
  /**
   * Last world tick on which each faction ran `AI_DECIDE` or resolved a
   * commitment. Used for reassessment cadence. Missing key = never.
   */
  lastAiDecisionTick: Map<FactionId, number>;
  /** Seed the world was generated with; also the root seed engines fork per-battle/per-event RNGs from. */
  worldSeed: number;

  // ---- factions (identity, resources, goals, memory, relationships, personality, ambition) ----
  /**
   * `WarlordSnapshot` (see `./index.ts`) already IS the canonical "Faction"
   * representation: it carries identity (id/name), resources +
   * resourceIncome, goals (`StrategicGoal[]`), memory (`MemoryEntry[]`),
   * relationships (`diplomacy: Map<FactionId, DiplomaticRelationship>`),
   * personality, and ambition in one place. There is no separate top-level
   * "diplomacy ledger" or "resource ledger" — that's an intentional
   * existing design, not a gap.
   */
  factions: Map<FactionId, WarlordSnapshot>;
  allFactionIds: FactionId[];

  // ---- player ----
  /**
   * The human/local player is just one entry in `factions`, identified by
   * id — there is no separate player data structure in this codebase (see
   * `InitialWorldParams.playerFactionIds` / `WorldStepInput.playerFactionId`
   * for the existing precedent of "player" meaning "which faction id").
   * `null` is valid (e.g. a fully-AI simulation/spectator run).
   */
  playerFactionId: FactionId | null;

  /**
   * Authored world identity. Geometry is NOT stored here — load
   * WorldDefinition via WorldCatalog using `definitionWorldId`.
   * Legacy SAMPLE_MAP fixtures use `legacy:sample-map`.
   */
  definitionWorldId: string | null;
  definitionFormatVersion: string | null;
  worldLevel: number | null;
  worldName: string | null;
  /**
   * Player foothold for the CURRENT world level. Assigned once from
   * starting ownership at world init. Ordinary conquest never adds IDs.
   * Empty when there is no player faction.
   */
  levelAnchorTerritoryIds: TerritoryId[];
  /**
   * Current-level survival status. Demotion to a previous playable world
   * is NOT applied here — previous-level player GameState is not persisted
   * yet. `previousWorldIds` copies WorldDefinition.containedWorlds ids as
   * the future return hook.
   */
  levelDefeat: LevelDefeatState;
  /**
   * Level 1 tutorial/scenario overlay. Null when this instance is not the
   * production Level 1 tutorial world. Authoritative for beat, gating, and
   * scripted-invasion idempotency. Not a second GameState.
   */
  level1Tutorial: Level1TutorialState | null;
  regions: Map<RegionId, RuntimeRegion>;

  // ---- world (territories, armies) ----
  territories: Map<TerritoryId, Territory>;
  // Canonical continuous time is `worldTick` above. `turn` remains the
  // EventEngine adapter clock. Wall-clock/`Date.now()` time is not part
  // of GameState. See docs/CONTINUOUS_WORLD_ARCHITECTURE.md.

  // ---- armies ----
  armies: Map<ArmyId, Army>;

  // ---- AI commitments ----
  /**
   * Canonical home for each faction's current strategic commitment
   * (Phase 8 — AI COMMITMENT & AMBITION PASS). One entry per faction id in
   * `allFactionIds`; `null` means "no active commitment" (e.g. before the
   * first `decide()` call for that faction, or right after a terminal
   * commitment completes/fails/is interrupted and before reassessment).
   *
   * OWNERSHIP: the AI Engine (`DecisionEngine`/`WarlordState`, in
   * `src/engine/DecisionEngine.ts`) is responsible for *calculating* and
   * *transitioning* commitment state (create/hold/complete/fail/
   * interrupt) — see `docs/AI_COMMITMENT_AMBITION.md`. `GameState` only
   * *stores* the result.
   *
   * TRANSITIONAL NOTE: `WarlordState.activeCommitment` (an AI-engine-owned,
   * non-canonical runtime field predating this pass) remains the AI
   * Engine's own working copy while it reasons — that has not been
   * rewritten in this pass. `src/state/gameStateAdapters.ts` provides
   * `buildWarlordStates()` (GameState -> WarlordState, seeding
   * `activeCommitment` from here) and `syncCommitmentsFromWarlordStates()`
   * (WarlordState -> GameState, writing the result back here) as the
   * explicit, call-it-yourself sync boundary between the two until the
   * Orchestrator exists and becomes the only thing that calls the AI
   * Engine and writes the result back. This is a deliberate, documented
   * two-copies-in-transition, not a hidden second authority — see
   * docs/AUTHORITATIVE_GAMESTATE_ARCHITECTURE.md, "AI commitment
   * integration".
   */
  commitments: Map<FactionId, AICommitment | null>;

  // ---- active events / world history ----
  activeEvents: ActiveEvent[];
  eventHistory: HistoryEntry[];

  /**
   * Local-player reward application state (Phase 17H). Bound to
   * `playerFactionId`, not a parallel GameState. Banked Troops live here
   * and are intentionally NOT army/garrison/`totalMilitaryPower` units.
   * Construction and Golden Yield are pending effects for future Cities /
   * Economy engines — they are not buildings, resources, or permanent
   * multipliers. Defense is never stored as generic banked power; it
   * attaches to `activeInvasions` only.
   */
  playerRewards: PlayerRewardState;
  /**
   * Minimal invasion boundary for DEFENSE reward application. Empty until
   * a future Invasion engine (or a test) inserts an `ActiveInvasion`.
   * 17H does not create, resolve, or time-out invasions.
   */
  activeInvasions: Map<InvasionId, ActiveInvasion>;

  /**
   * Timed construction projects. Starting one spends resources and does
   * not require a workout. Remaining time decreases with worldTick and
   * with Extra Construction Workers. Prototype 1: one in-progress project
   * per territory.
   */
  constructions: Map<ConstructionId, ConstructionProject>;
  /**
   * Cities exist only after explicit CITY construction. Conquest destroys
   * the previous city; the new owner receives bare land.
   */
  cities: Map<CityId, City>;
  /**
   * Per-territory uncollected yield and last accrual tick. Faction
   * `resources` remain the only stored reserve.
   */
  territoryEconomy: Map<TerritoryId, TerritoryEconomy>;
  /**
   * Completed Farm/Mine/Lumber occupancy. Missing tile = no developments.
   * Schema 11 stores flags only; production modifiers are not applied yet.
   */
  territoryInfrastructure: Map<TerritoryId, TerritoryInfrastructure>;
  /**
   * Compact local-player fitness estimate and at most one active session.
   * Not a competing GameState and not an unbounded session dump.
   */
  playerFitness: PlayerFitnessState;
  /** Per-player empire pause. Other factions continue simulating. */
  playerEmpirePause: PlayerEmpirePause;
  /** Per-attacker recovery (≥48h) and failed-defense continuation delay. */
  attackerCooldowns: Map<FactionId, AttackerCooldown>;

  // ---- deferred: not implemented in this repository yet ----
  // Persistence/version negotiation: Phase 17L (`src/persistence/`) stores
  // a JSON-safe envelope plus a separate workout-history store. GameState
  // remains the single in-memory authority; `stateVersion` lives on the
  // persistence envelope, not this type.
}

/** Initial continuous-clock fields. `worldTick` 0 means no simulation time has elapsed. */
export function emptyWorldClock(): {
  worldTick: number;
  lastFoodConsumptionTick: number;
  lastAiDecisionTick: Map<FactionId, number>;
} {
  return { worldTick: 0, lastFoodConsumptionTick: 0, lastAiDecisionTick: new Map() };
}

export function emptyPlayerRewardState(): PlayerRewardState {
  return {
    bankedTroops: 0,
    pendingConstructionEffects: [],
    pendingGoldenYieldEffects: [],
    appliedRewards: [],
  };
}

export function emptyPlayerFitnessState(): PlayerFitnessState {
  return {
    estimate: null,
    lastWorkoutCompletedAtTick: null,
    compactHistory: [],
    activeSession: null,
    pendingReward: null,
    progression: emptyPlayerProgressionState(),
  };
}

export function emptyPlayerEmpirePause(): PlayerEmpirePause {
  return { paused: false, pausedAtTick: null };
}

export function emptyLevelDefeatState(previousWorldIds: string[] = []): LevelDefeatState {
  return {
    status: 'active',
    defeatedAtTick: null,
    defeatedLevel: null,
    defeatedWorldId: null,
    lastLostAnchorTerritoryId: null,
    previousWorldIds: [...previousWorldIds],
  };
}

export function isLevel1TutorialBeat(value: unknown): value is Level1TutorialBeat {
  return typeof value === 'string' && (LEVEL1_TUTORIAL_BEATS as readonly string[]).includes(value);
}

export function emptyLevel1TutorialState(): Level1TutorialState {
  return {
    active: true,
    beat: 'FIRST_WORKOUT_PENDING',
    firstWorkoutSessionId: null,
    firstConquestTerritoryId: null,
    scriptedInvasionId: null,
    scriptedInvasionTargetId: null,
    defenseResolved: false,
    secondWorkoutSessionId: null,
    completed: false,
  };
}

export function emptyRewardApplicationState(): {
  playerRewards: PlayerRewardState;
  activeInvasions: Map<InvasionId, ActiveInvasion>;
  constructions: Map<ConstructionId, ConstructionProject>;
  cities: Map<CityId, City>;
  territoryEconomy: Map<TerritoryId, TerritoryEconomy>;
  territoryInfrastructure: Map<TerritoryId, TerritoryInfrastructure>;
  playerFitness: PlayerFitnessState;
  playerEmpirePause: PlayerEmpirePause;
  attackerCooldowns: Map<FactionId, AttackerCooldown>;
  levelAnchorTerritoryIds: TerritoryId[];
  levelDefeat: LevelDefeatState;
  level1Tutorial: Level1TutorialState | null;
} {
  return {
    playerRewards: emptyPlayerRewardState(),
    activeInvasions: new Map(),
    constructions: new Map(),
    cities: new Map(),
    territoryEconomy: new Map(),
    territoryInfrastructure: new Map(),
    playerFitness: emptyPlayerFitnessState(),
    playerEmpirePause: emptyPlayerEmpirePause(),
    attackerCooldowns: new Map(),
    levelAnchorTerritoryIds: [],
    levelDefeat: emptyLevelDefeatState(),
    level1Tutorial: null,
  };
}

/** Test/future-engine helper. Does not resolve battles or start workouts. */
export function createActiveInvasion(input: {
  id: InvasionId;
  defenderFactionId: FactionId;
  attackerFactionId: FactionId;
  territoryId: TerritoryId;
  startedAtTick: number;
  notifiedAtTick: number;
  responseDeadlineTick: number;
  attackingArmyIds?: string[];
  battleSeed?: number | null;
  commitmentId?: string | null;
  status?: InvasionStatus;
}): ActiveInvasion {
  return {
    id: input.id,
    defenderFactionId: input.defenderFactionId,
    attackerFactionId: input.attackerFactionId,
    territoryId: input.territoryId,
    startedAtTick: input.startedAtTick,
    notifiedAtTick: input.notifiedAtTick,
    responseDeadlineTick: input.responseDeadlineTick,
    status: input.status ?? 'pending_response',
    defenseMobilization: null,
    defenseWorkoutStartedAtTick: null,
    defenseCompletionDeadlineTick: null,
    defenseSessionId: null,
    attackingArmyIds: [...(input.attackingArmyIds ?? [])],
    battleSeed: input.battleSeed ?? null,
    commitmentId: input.commitmentId ?? null,
  };
}
