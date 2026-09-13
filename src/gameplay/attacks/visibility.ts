import { GameState } from '../../types/GameState';
import { OrchestrationError, ErrorCode } from '../../orchestration/errors';
import { visibilityOf } from '../../orchestration/publicView';

/** Player attacks must target a known/visible territory. AI is not fog-gated here. */
export function assertPlayerCanSeeTarget(state: GameState, factionId: string, territoryId: string): void {
  const vis = visibilityOf(state, factionId, territoryId);
  if (vis === 'unknown') {
    throw new OrchestrationError(ErrorCode.FOG_OF_WAR, 'Target is not visible or known');
  }
}
