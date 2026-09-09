import { WorldSimulator } from '../events/WorldSimulator';
import { mergeEventStepOntoGameState, eventsToGameEvents } from '../orchestration/applyEvents';
import { GameEvent, StateChange } from '../orchestration/protocol';
import { toWorldStepInput } from '../state/gameStateAdapters';
import { GameState } from '../types/GameState';

/**
 * Thin EventEngine adapter: one `WorldSimulator` turn. Callers (the
 * Continuous World Engine) decide *when* this runs based on world ticks.
 *
 * TEMPORARY tick→turn conversion lives in `BALANCE.world.ticksPerEventTurn`
 * and `ContinuousWorldEngine` — this function still speaks EventEngine
 * turns only. It does not rewrite event logic.
 */
export interface EventTickResult {
  turn: number;
  triggered: number;
  summary: string[];
  historyLength: number;
  stateChanges: StateChange[];
  events: GameEvent[];
}

export function runEventEngineTurn(state: GameState, simulator: WorldSimulator): EventTickResult {
  state.turn += 1;
  const input = toWorldStepInput(state);
  input.turn = state.turn;
  const output = simulator.simulate(input);
  const stateChanges = mergeEventStepOntoGameState(state, output);
  return {
    turn: state.turn,
    triggered: output.triggeredEvents.length,
    summary: [...output.summary],
    historyLength: state.eventHistory.length,
    stateChanges,
    events: eventsToGameEvents(output),
  };
}
