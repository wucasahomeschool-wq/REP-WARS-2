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

/** A stationary invasion whose defender lost the target cannot fight the old
 * defender or select a replacement target. Settle through the existing resolver
 * before new operation starts validate the next authoritative transaction.
 */
export function processInvalidatedInvasions(state: GameState, battle: BattleEngine): HandlerResult[] {
  return [...state.activeInvasions.values()].filter(isOpenInvasion)
    .filter(i => state.territories.has(i.territoryId) && state.territories.get(i.territoryId)!.owner !== i.defenderFactionId)
    .sort(compareOpenInvasions).map(i => resolveInvasionBattle(state, battle, i.id, 'undefended'));
}
