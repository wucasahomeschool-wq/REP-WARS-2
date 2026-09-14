import { ActiveEvent, WorldStepOutput } from '../events/EventModel';
import { GameState } from '../types/GameState';
import { GameEvent, StateChange } from './protocol';

/** Merge a `WorldSimulator` step output onto authoritative `GameState`. */
export function mergeEventStepOntoGameState(state: GameState, output: WorldStepOutput): StateChange[] {
  const changes: StateChange[] = [];
  for (const [id, t] of output.mutatedTerritories) {
    const prev = state.territories.get(id);
    state.territories.set(id, t);
    if (prev && prev.owner !== t.owner) {
      changes.push({
        entity: 'territory',
        id,
        field: 'owner',
        from: prev.owner,
        to: t.owner,
        summary: `${t.id} owner changed by event`,
      });
    }
  }
  for (const [id, f] of output.mutatedFactions) {
    const runtimeArmies = state.factions.get(id)?.armies;
    if (runtimeArmies) f.armies = [...runtimeArmies];
    f.territories = [...state.territories.values()]
      .filter((t) => t.owner === id)
      .map((t) => t.id);
    state.factions.set(id, f);
    changes.push({
      entity: 'faction',
      id,
      summary: `${f.name} updated by world events (stability ${f.stability})`,
    });
  }
  if (output.mutatedArmies) {
    for (const [id, a] of output.mutatedArmies) {
      state.armies.set(id, a);
    }
  }
  state.activeEvents = output.newActiveEvents;
  state.eventHistory = output.newEventHistory;
  return changes;
}

export function eventsToGameEvents(out: WorldStepOutput): GameEvent[] {
  const events: GameEvent[] = [];
  for (const te of out.triggeredEvents) {
    events.push({
      kind: 'imperial',
      id: te.definition.typeId,
      title: te.definition.typeId,
      summary: te.reasons.join('; ') || te.definition.typeId,
      territoryId: te.territoryId,
      factionId: te.factionId,
    });
  }
  for (const line of out.summary) {
    events.push({
      kind: 'world',
      id: `sum_${events.length}`,
      title: 'World',
      summary: line,
    });
  }
  return events;
}

export function activeEventsForFaction(state: GameState, factionId: string): ActiveEvent[] {
  return state.activeEvents.filter(
    (e) => e.status === 'active' && (
      e.factionId === factionId
      || (e.territoryId && state.territories.get(e.territoryId)?.owner === factionId)
    ),
  );
}
