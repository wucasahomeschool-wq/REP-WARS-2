/**
 * DETERMINISTIC GAMESTATE INITIALIZATION (AUTHORITATIVE RUNTIME GAMESTATE
 * PASS). See docs/AUTHORITATIVE_GAMESTATE_ARCHITECTURE.md, "Initialization".
 *
 * Reuses the existing `SimulationBuilder.buildFromSpecs` (SAMPLE_MAP +
 * WARLORD_SPECS by default) — the same deterministic, seeded-RNG-only path
 * `cli.ts`/`eventSimulation.ts`/`tests/run.ts` already use — rather than
 * inventing a second initialization system or new starting values. Same
 * `seed` + same `mapSpecs`/`warlordSpecs` ⇒ structurally identical
 * `GameState` (see tests/run.ts, "createGameState determinism").
 */
import { AICommitment, FactionId } from '../types';
import { GameState, GAME_STATE_SCHEMA_VERSION, emptyWorldClock, emptyRewardApplicationState } from '../types/GameState';
import { BALANCE } from '../constants/balance';
import { MapTerritorySpec, SAMPLE_MAP, SimulationBuilder, WARLORD_SPECS, WarlordSpec } from '../simulation/SampleMap';
import { seedEconomyAndCities } from '../gameplay/economy/seed';

export interface CreateGameStateOptions {
  /** RNG seed. Defaults to `BALANCE.simulate.defaultSeed`, same as the CLI. */
  seed?: number;
  /** Defaults to the hand-authored `SAMPLE_MAP`. */
  mapSpecs?: MapTerritorySpec[];
  /** Defaults to `WARLORD_SPECS`. */
  warlordSpecs?: WarlordSpec[];
  /** Which faction id (if any) is the human/local player. See `GameState.playerFactionId`. */
  playerFactionId?: FactionId | null;
}

/**
 * Builds a fresh, deterministic authoritative `GameState`.
 *
 * - `mapWorld`/`visibility` are left `null`/empty: this path never calls
 *   `MapEngine.generateInitialWorld`, so there is no procedural map/fog
 *   state to carry (see `GameState.mapWorld` doc comment). Callers that
 *   generated a `MapWorldState` themselves can attach it after the fact;
 *   this function does not fabricate one.
 * - `activeEvents`/`eventHistory` start empty: no initial events exist
 *   for the sample scenario today.
 * - `commitments` starts as one `null` entry per faction id: no `decide()`
 *   call has happened yet.
 * - `playerRewards` starts empty (0 banked Troops, no pending effects).
 * - `activeInvasions` starts empty: 17H does not create invasions.
 * - `cities`/`territoryEconomy` are seeded from SAMPLE_MAP ownership and
 *   `resourceOutput` (Phase 17J). Uncollected yield starts at 0.
 */
export function createGameState(options: CreateGameStateOptions = {}): GameState {
  const seed = options.seed ?? BALANCE.simulate.defaultSeed;
  const mapSpecs = options.mapSpecs ?? SAMPLE_MAP;
  const warlordSpecs = options.warlordSpecs ?? WARLORD_SPECS;

  const { gameState: snapshot } = SimulationBuilder.buildFromSpecs(mapSpecs, warlordSpecs, seed);

  const commitments = new Map<FactionId, AICommitment | null>();
  for (const fid of snapshot.allFactionIds) {
    commitments.set(fid, null);
  }

  const state: GameState = {
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    turn: snapshot.turn,
    ...emptyWorldClock(),
    worldSeed: seed,
    factions: snapshot.factions,
    allFactionIds: [...snapshot.allFactionIds],
    playerFactionId: options.playerFactionId ?? null,
    territories: snapshot.territories,
    mapWorld: null,
    visibility: new Map(),
    armies: snapshot.armies,
    commitments,
    activeEvents: [],
    eventHistory: [],
    ...emptyRewardApplicationState(),
  };
  seedEconomyAndCities(state);
  return state;
}
