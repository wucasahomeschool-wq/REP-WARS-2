import { GameState } from '../../types/GameState';
import { BattleEngine } from '../../battle/BattleEngine';
import { HandlerResult } from '../../orchestration/protocol';
import { playerFacingTick } from './eligibility';
import { compareOpenInvasions, defenseCompletionDeadlineTick, isDeadlineElapsed, isOpenInvasion } from './deadlines';
import { resolveInvasionBattle } from './resolve';

/**
 * Resolve invasions whose inclusive deadlines have elapsed.
 * One pass over currently open invasions — no per-tick loop.
 */
export function processInvasionTimeouts(
  state: GameState,
  battle: BattleEngine,
): HandlerResult[] {
  const now = playerFacingTick(state);
  const due = [...state.activeInvasions.values()]
    .filter(isOpenInvasion)
    .filter((invasion) => {
      if (invasion.status === 'pending_response') {
        return isDeadlineElapsed(now, invasion.responseDeadlineTick);
      }
      const completionDeadline = invasion.defenseCompletionDeadlineTick
        ?? (invasion.defenseWorkoutStartedAtTick !== null
          ? defenseCompletionDeadlineTick(invasion.defenseWorkoutStartedAtTick)
          : now - 1);
      return isDeadlineElapsed(now, completionDeadline);
    })
    .sort(compareOpenInvasions);

  const results: HandlerResult[] = [];
  for (const invasion of due) {
    const live = state.activeInvasions.get(invasion.id);
    if (!live || !isOpenInvasion(live)) continue;
    const reason = live.status === 'pending_response' ? 'undefended' : 'defense_timeout';
    results.push(resolveInvasionBattle(state, battle, live.id, reason));
  }
  return results;
}

/** 17I name: unanswered response window. 17K also expires in-progress defenses. */
export function progressExpiredInvasions(
  state: GameState,
  battle: BattleEngine,
): HandlerResult[] {
  return processInvasionTimeouts(state, battle);
}
