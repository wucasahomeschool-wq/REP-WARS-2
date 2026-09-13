/**
 * Player/faction authorization boundary.
 *
 * Player-originated commands may act only as `GameState.playerFactionId`.
 * A client-supplied `factionId` is untrusted: existence is not ownership.
 *
 * AI_DECIDE / RESOLVE_COMMITMENT are the AI pathway and are not gated here
 * (they still cannot run DecisionEngine for the player faction — that check
 * lives in `handleAiDecide`). ADVANCE_WORLD / GET_COMMAND_INDEX are system
 * commands. Nested handler calls from those paths reuse `resolveActingFactionId`
 * and are not re-checked as player impersonation.
 *
 * When `playerFactionId` is null (fully-AI / harness), there is no player
 * to impersonate; `factionId` remains a simulation parameter.
 */
import { GameState } from '../types/GameState';
import { OrchestrationError, ErrorCode } from './errors';
import { paramString } from './helpers';
import { CommandDefinition, CommandRequest } from './protocol';

const UNAUTHORIZED_MESSAGE = 'Action not allowed';

export function authorizeCommand(
  state: GameState,
  req: CommandRequest,
  def: CommandDefinition,
): void {
  if (def.category === 'SYSTEM' || def.category === 'WORLD' || def.category === 'AI') {
    return;
  }
  const playerFaction = state.playerFactionId;
  if (playerFaction === null) {
    return;
  }
  const requested = paramString(req, 'factionId');
  if (requested && requested !== playerFaction) {
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, UNAUTHORIZED_MESSAGE);
  }
}

/** Viewer for fog-filtered reads. Call after `authorizeCommand`. */
export function resolveViewerFactionId(state: GameState, req: CommandRequest): string | null {
  if (state.playerFactionId) {
    return state.playerFactionId;
  }
  const explicit = paramString(req, 'factionId');
  if (explicit && state.factions.has(explicit)) {
    return explicit;
  }
  return null;
}
