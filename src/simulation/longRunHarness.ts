/**
 * AI RUNTIME INTEGRATION PASS — deterministic long-run AI behavior test
 * harness (Phase 16, section 11/12).
 *
 * This is a TEST HARNESS, not a second authoritative simulation engine:
 * it drives the real `Orchestrator` → `ADVANCE_WORLD` → `ContinuousWorldEngine`
 * chain (the exact same path `src/simulation/cli.ts --world` uses), just
 * in a loop, and collects statistics from the already-returned
 * `WorldAdvanceResult` payloads plus before/after `GameState` snapshots.
 * It does not call `DecisionEngine`/`BattleEngine`/`ActionScorer`
 * directly and does not re-implement any of their logic.
 */
import { Orchestrator } from '../orchestration/orchestrator';
import { createGameState, CreateGameStateOptions } from '../state/createGameState';
import { GameState } from '../types/GameState';
import { WorldAdvanceResult } from '../world/ContinuousWorldEngine';
import { isFactionEliminated } from '../engine/DecisionEngine';
import { ActionType, FactionId } from '../types';
import { BALANCE } from '../constants/balance';

export interface LongSimulationOptions {
  seed?: number;
  ticks: number;
  playerFactionId?: string | null;
  mapSpecs?: CreateGameStateOptions['mapSpecs'];
  warlordSpecs?: CreateGameStateOptions['warlordSpecs'];
}

export interface LongSimulationStats {
  seed: number;
  ticksRequested: number;
  ticksAdvanced: number;
  finalState: GameState;
  /** Per-faction count of each AI_DECIDE action type chosen over the run. */
  actionCounts: Map<FactionId, Partial<Record<ActionType, number>>>;
  /** Successful ATTACK commitment resolutions (immediate or delayed). */
  battlesResolved: number;
  /** Failed/interrupted ATTACK commitment resolutions. */
  attacksFailed: number;
  territoriesChangedOwner: number;
  /** Factions that transitioned from present to eliminated during this run. */
  newlyEliminated: FactionId[];
  /** Factions already eliminated at tick 0 (e.g. SAMPLE_MAP's celestial_theocracy). */
  eliminatedAtStart: FactionId[];
  /** AI_DECIDE calls made for a faction already eliminated (should always be 0). */
  decisionsForEliminatedFactions: number;
  /** Non-fatal engine errors surfaced by ADVANCE_WORLD across the whole run. */
  engineErrors: number;
  /** ADVANCE_WORLD command-level failures (should always be 0 for valid ticks). */
  advanceFailures: number;
}

/**
 * Runs `ticks` world ticks (chunked to respect
 * `BALANCE.world.maxElapsedTicksPerAdvance`) starting from a fresh
 * deterministic `GameState`, and returns aggregate statistics. Two calls
 * with identical options always produce identical `finalState` and stats
 * — see `tests/longSimulation.ts`, "deterministic N-tick simulation".
 */
export function runLongSimulation(opts: LongSimulationOptions): LongSimulationStats {
  const seed = opts.seed ?? 42;
  const state = createGameState({
    seed,
    playerFactionId: opts.playerFactionId ?? null,
    mapSpecs: opts.mapSpecs,
    warlordSpecs: opts.warlordSpecs,
  });
  const orch = new Orchestrator(state);

  const eliminatedAtStart = orch.getState().allFactionIds.filter((fid) => {
    const snap = orch.getState().factions.get(fid);
    return snap ? isFactionEliminated(snap) : false;
  });
  const initialOwners = new Map<string, string | null>();
  for (const [id, t] of orch.getState().territories) initialOwners.set(id, t.owner);

  const actionCounts = new Map<FactionId, Partial<Record<ActionType, number>>>();
  let battlesResolved = 0;
  let attacksFailed = 0;
  let engineErrors = 0;
  let advanceFailures = 0;
  let decisionsForEliminatedFactions = 0;
  let ticksAdvanced = 0;
  const knownEliminated = new Set<FactionId>(eliminatedAtStart);
  const newlyEliminated: FactionId[] = [];

  const chunk = Math.min(32, BALANCE.world.maxElapsedTicksPerAdvance);
  let remaining = opts.ticks;
  while (remaining > 0) {
    const step = Math.min(chunk, remaining);
    const res = orch.execute({
      commandId: 'ADVANCE_WORLD',
      playerId: 'harness',
      requestId: `harness_${orch.getState().worldTick}_${step}`,
      parameters: { elapsedTicks: step },
    });
    if (!res.success) {
      advanceFailures++;
      remaining -= step;
      continue;
    }
    const advance = res.payload.worldAdvance as WorldAdvanceResult;
    ticksAdvanced += advance.ticksAdvanced;
    engineErrors += advance.errors.length;

    for (const d of advance.aiDecisions) {
      if (knownEliminated.has(d.factionId)) decisionsForEliminatedFactions++;
      const perFaction = actionCounts.get(d.factionId) ?? {};
      const key = d.action as ActionType;
      perFaction[key] = (perFaction[key] ?? 0) + 1;
      actionCounts.set(d.factionId, perFaction);
    }
    for (const cr of advance.commitmentResolutions) {
      if (cr.action !== 'ATTACK') continue;
      if (cr.success) battlesResolved++;
      else attacksFailed++;
    }

    for (const fid of orch.getState().allFactionIds) {
      if (knownEliminated.has(fid)) continue;
      const snap = orch.getState().factions.get(fid);
      if (snap && isFactionEliminated(snap)) {
        knownEliminated.add(fid);
        newlyEliminated.push(fid);
      }
    }
    remaining -= step;
  }

  let territoriesChangedOwner = 0;
  for (const [id, t] of orch.getState().territories) {
    if (initialOwners.get(id) !== t.owner) territoriesChangedOwner++;
  }

  return {
    seed,
    ticksRequested: opts.ticks,
    ticksAdvanced,
    finalState: orch.getState(),
    actionCounts,
    battlesResolved,
    attacksFailed,
    territoriesChangedOwner,
    newlyEliminated,
    eliminatedAtStart,
    decisionsForEliminatedFactions,
    engineErrors,
    advanceFailures,
  };
}
