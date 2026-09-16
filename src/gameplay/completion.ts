import { GameState } from '../types/GameState';
import { GameEvent } from '../orchestration/protocol';
import { isLegacyDefinitionWorldId, resolveWorldDefinition } from '../worldDefinition/catalog';
import { WorldDefinition } from '../worldDefinition/types';

export interface WorldCompletionView {
  complete: boolean;
  type: string;
  playerOwned: number;
  total: number;
  fraction: number;
  requiredFraction: number | null;
  definitionWorldId: string | null;
  worldLevel: number | null;
}

export function tryLoadWorldDefinitionForState(state: GameState): WorldDefinition | null {
  const worldId = state.definitionWorldId;
  if (!worldId || isLegacyDefinitionWorldId(worldId)) return null;
  try {
    const loaded = resolveWorldDefinition(worldId);
    return loaded.ok ? loaded.definition : null;
  } catch {
    return null;
  }
}

export function evaluateWorldCompletion(
  state: GameState,
  definition?: WorldDefinition | null,
): WorldCompletionView | null {
  const def = definition === undefined ? tryLoadWorldDefinitionForState(state) : definition;
  if (!def) return null;
  const playerId = state.playerFactionId;
  const total = state.territories.size;
  let playerOwned = 0;
  let aiOwned = 0;
  for (const t of state.territories.values()) {
    if (playerId && t.owner === playerId) playerOwned += 1;
    else if (t.owner) aiOwned += 1;
  }
  const fraction = total === 0 ? 0 : playerOwned / total;
  let complete = false;
  let requiredFraction: number | null = null;
  if (def.completion.type === 'control_fraction') {
    requiredFraction = def.completion.fraction;
    complete = fraction + 1e-12 >= def.completion.fraction;
  } else if (def.completion.type === 'eliminate_ai') {
    complete = aiOwned === 0 && playerOwned > 0;
  }
  return {
    complete,
    type: def.completion.type,
    playerOwned,
    total,
    fraction,
    requiredFraction,
    definitionWorldId: state.definitionWorldId,
    worldLevel: state.worldLevel,
  };
}

/**
 * Emit a one-shot completion event after a player territorial gain.
 * Does not change worldLevel. Campaign progression is TRANSITION_TO_NEXT_WORLD.
 */
export function applyWorldCompletionCheck(state: GameState): GameEvent[] {
  const evaluation = evaluateWorldCompletion(state);
  if (!evaluation?.complete || !state.playerFactionId) return [];
  return [{
    kind: 'world',
    id: `level_completed_${state.worldTick}_${state.playerFactionId}`,
    title: 'Level complete',
    summary: `World level ${state.worldLevel ?? '?'} completion condition is met`,
    factionId: state.playerFactionId,
    data: {
      worldProgression: 'level_completed',
      complete: evaluation.complete,
      type: evaluation.type,
      playerOwned: evaluation.playerOwned,
      total: evaluation.total,
      fraction: evaluation.fraction,
      requiredFraction: evaluation.requiredFraction,
      definitionWorldId: evaluation.definitionWorldId,
      worldLevel: evaluation.worldLevel,
    },
  }];
}
