import {applyOpinionEvent} from '../cognition/opinion';
import {refreshGoals} from '../cognition/goals';
import { ActiveEvent, WorldStepOutput } from '../events/EventModel';
import { GameState } from '../types/GameState';
import { GameEvent, StateChange } from './protocol';
import { markResponseWorldChanged } from '../engine/responseRecords';
import { isDeepStrictEqual } from 'node:util';

/** Merge a `WorldSimulator` step output onto authoritative `GameState`. */
export function mergeEventStepOntoGameState(state: GameState, output: WorldStepOutput): StateChange[] {
  const changes: StateChange[] = [];
  let goalFactsChanged=false;
  let responseFactsChanged=false;
  // Authored transition identity owns the delta. Stance differences between
  // disposable snapshots and current state are never evidence of a new event.
  for(const effect of output.opinionEffects??[])applyOpinionEvent(state,effect.id,effect.observer,effect.target,'world_event',effect.delta);
  for (const [id, t] of output.mutatedTerritories) {
    const prev = state.territories.get(id);
    if(!prev||prev.owner!==t.owner||prev.garrison!==t.garrison||prev.fortification!==t.fortification||
      JSON.stringify([...prev.neighboring].sort())!==JSON.stringify([...t.neighboring].sort()))responseFactsChanged=true;
    state.territories.set(id, t);
    if (prev && prev.owner !== t.owner) {
      goalFactsChanged=true;
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
    const prev = state.factions.get(id);
    if(prev&&(['gold','food','wood','iron','stone'] as const).some(r=>prev.resources[r]!==f.resources[r]))goalFactsChanged=true;
    // Keep the event output disposable. Retaining that object must not expose
    // mutable references to canonical Goal or directed Opinion state.
    const diplomacy=new Map([...(prev?.diplomacy??f.diplomacy)].map(([target,r])=>[target,
      {...r,treaties:r.treaties.map(t=>({...t,terms:{...t.terms}}))}] as const));
    const next={...f,goals:structuredClone(prev?.goals??f.goals),diplomacy};
    if (runtimeArmies) next.armies = [...runtimeArmies];
    next.territories = [...state.territories.values()]
      .filter((t) => t.owner === id)
      .map((t) => t.id);
    // Event consequences do not author Goals or diplomacy lifecycle records.
    state.factions.set(id, next);
    if (prev && prev.stability !== f.stability) {
      changes.push({
        entity: 'faction',
        id,
        field: 'stability',
        from: prev.stability,
        to: f.stability,
        summary: `${f.name} updated by world events (stability ${f.stability})`,
      });
    }
  }
  if (output.mutatedArmies) {
    for (const [id, a] of output.mutatedArmies) {
      const old=state.armies.get(id);
      if(!old||old.owner!==a.owner||old.location!==a.location)goalFactsChanged=true;
      if(!old||old.owner!==a.owner||old.location!==a.location||old.soldiers!==a.soldiers||old.knights!==a.knights||
        old.siegeEngines!==a.siegeEngines||old.morale!==a.morale||old.supply!==a.supply||
        !isDeepStrictEqual(old.movement??null,a.movement??null)||!isDeepStrictEqual(old.attackIntent??null,a.attackIntent??null))responseFactsChanged=true;
      state.armies.set(id, a);
    }
  }
  state.activeEvents = output.newActiveEvents;
  state.eventHistory = output.newEventHistory;
  if(goalFactsChanged)refreshGoals(state);
  // Event output is disposable; only a changed canonical physical fact wakes
  // the existing observer. Empty steps and ordinary resource accrual stay quiet.
  if(responseFactsChanged)markResponseWorldChanged(state);
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
