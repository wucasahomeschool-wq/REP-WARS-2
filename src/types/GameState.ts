/**
 * CANONICAL RUNTIME GAME STATE (AUTHORITATIVE RUNTIME GAMESTATE PASS)
 * =====================================================================
 *
 * This is the ONE authoritative runtime representation of "the current
 * world" for Rep Wars. It is the source of truth for territories, armies,
 * factions/warlords (resources, diplomacy, personality, ambition, goals,
 * memory), the player, active events/history, AI commitments, and map/
 * world/visibility state where those concepts already exist.
 *
 * Engines (BattleEngine, WorldSimulator/EventEngine, DecisionEngine,
 * MapEngine) calculate/propose results from a narrow, engine-specific
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
 *  - Concepts with no real implementation yet (cities, persistence) are
 *    called out as deferred in comments rather than stubbed with fake fields.
 *    Continuous simulation time is `worldTick` (Phase 13).
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
import { AICommitment, Army, ArmyId, FactionId, MapWorldState, PlayerVisibilityMap, Territory, TerritoryId, WarlordSnapshot } from './index';
import { ActiveEvent, HistoryEntry } from '../events/EventModel';

/**
 * Bumped only when the shape of `GameState` changes in a way a future
 * persistence/replay layer would need to know about. Not a balance value —
 * do not read this from `BALANCE`.
 *
 * 3 = Phase 14 `Army.movement` (adjacent-hop logistics).
 * 4 = Phase 15 `Army.attackIntent` (MOVE → ATTACK staging).
 */
export const GAME_STATE_SCHEMA_VERSION = 4;

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

  // ---- world (territories, map metadata, armies, visibility/fog) ----
  territories: Map<TerritoryId, Territory>;
  /**
   * Procedural map/graph metadata (regions, themes, frontier bookkeeping)
   * when the world came from `MapEngine.generateInitialWorld`. `null` for
   * hand-authored worlds (e.g. `SAMPLE_MAP` via `SimulationBuilder`, the
   * default `createGameState()` path) that never call `MapEngine`. Both
   * are legitimate; do not fabricate a `MapWorldState` for a hand-authored
   * world just to make this field non-null.
   */
  mapWorld: MapWorldState | null;
  /**
   * Per-faction fog-of-war / visibility. Only populated when the world
   * was built via `MapEngine.generateInitialWorld` (which is the only
   * producer of `PlayerVisibilityMap` today — see
   * `MapEngine.createVisibilityMapFor`/`recomputeVisibilityFor`). Empty
   * `Map` (not fabricated entries) for worlds built without it.
   */
  visibility: Map<FactionId, PlayerVisibilityMap>;
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

  // ---- deferred: not implemented in this repository yet ----
  // Cities: no city system exists (territories are the smallest owned
  // unit). Do not add a `cities` field until a real city system exists.
  //
  // Persistence/version negotiation beyond `schemaVersion` itself
  // (migrations, save-file compatibility): not built — this pass only
  // adds the marker future persistence code would need.
}

/** Initial continuous-clock fields. `worldTick` 0 means no simulation time has elapsed. */
export function emptyWorldClock(): {
  worldTick: number;
  lastAiDecisionTick: Map<FactionId, number>;
} {
  return { worldTick: 0, lastAiDecisionTick: new Map() };
}
