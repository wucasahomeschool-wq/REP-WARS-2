import { GameState } from '../types/GameState';

export const GAME_STATE_PERSISTENCE_FORMAT = 'game-state-persistence.v1' as const;
export const DEFAULT_WORLD_ID = 'local';

/**
 * Persistence architecture (Phase 17L)
 *
 * Option B: one local world instance per player. Prototype 1 has a single
 * `playerFactionId` on GameState and no shared multiplayer world. AI-vs-AI
 * still runs inside that player's world during catch-up. Future multi-world
 * instances can key additional rows by worldId without changing engines.
 *
 * Canonical persisted (authoritative):
 *   schemaVersion, turn, worldTick, lastAiDecisionTick, worldSeed,
 *   factions (resources, diplomacy, memory, goals, armies refs),
 *   playerFactionId, definitionWorldId/worldLevel, territories (ownership,
 *   garrison, fortification), armies, commitments, activeEvents, eventHistory,
 *   playerRewards (banked Troops, pending effects, appliedRewards ledger),
 *   activeInvasions, constructions (remainingTicks + lastProgressTick),
 *   cities, territoryEconomy (lastAccrualTick + uncollected),
 *   playerFitness (estimate, compactHistory, activeSession, pendingReward,
 *   lastWorkoutCompletedAtTick), playerEmpirePause, attackerCooldowns.
 *
 * Derived / reconstructed, not independently stored:
 *   remaining construction display time (from lastProgressTick + worldTick),
 *   currently collectible resources (uncollected + production since lastAccrual),
 *   remaining invasion/protection ticks (deadlines vs playerFacingTick),
 *   public views of the current world. BattleEngine/Fitness calculations.
 *
 * Workout history is a separate store. compactHistory remains a small
 * GameState index; durable evidence lives in WorkoutHistoryStore.
 *
 * Concurrency version lives on the persistence envelope, not GameState,
 * so gameplay engines never read/write it.
 */
export interface PersistedWorldRecord {
  formatVersion: typeof GAME_STATE_PERSISTENCE_FORMAT;
  playerId: string;
  worldId: string;
  schemaVersion: number;
  worldTick: number;
  stateVersion: number;
  payload: unknown;
}

export type LoadWorldResult =
  | { ok: true; record: PersistedWorldRecord; state: GameState }
  | { ok: false; code: string; message: string; details?: Record<string, unknown> };

export type SaveWorldResult =
  | { ok: true; record: PersistedWorldRecord; persisted: true }
  | { ok: false; code: string; message: string; persisted: false; details?: Record<string, unknown> };

export interface GameStateStore {
  load(playerId: string): LoadWorldResult;
  /**
   * Persist a full authoritative snapshot.
   * `expectedVersion` is the envelope version last loaded (`0` if none).
   * On conflict the stored row is unchanged and `persisted` is false.
   */
  save(playerId: string, state: GameState, expectedVersion: number): SaveWorldResult;
  /** Same atomic replace as `save`. */
  replace(playerId: string, state: GameState, expectedVersion: number): SaveWorldResult;
  /**
   * Transaction boundary: load → mutate in memory → invariant-checked save.
   * If save fails, the in-memory draft is discarded from the store's point
   * of view (`persisted: false`). Callers must not treat the draft as committed.
   */
  transaction(
    playerId: string,
    mutate: (state: GameState) => void,
    expectedVersion?: number,
  ): SaveWorldResult & { state?: GameState };
}

export interface PersistenceSaveStats {
  saveCount: number;
}
