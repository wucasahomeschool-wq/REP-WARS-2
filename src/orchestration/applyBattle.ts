import { Army, ArmyId, FactionId, Territory, TerritoryId } from '../types';
import { BattleResult } from '../battle/BattleEngine';
import { GameState } from '../types/GameState';
import {
  settleTerritoryOwnershipChange,
  territoryDestructionHasLosses,
} from '../gameplay/economy/ownership';
import { pushMemory } from './helpers';
import { TerritoryChange, StateChange, ArmyChange, GameEvent } from './protocol';
import { applyPlayerTerritoryLoss, assertAnchorAttackAllowed } from '../gameplay/anchors';
import { applyWorldCompletionCheck } from '../gameplay/completion';

function clampMorale(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function applySurvivingArmies(
  armies: Army[],
  remaining: { soldiers: number; knights: number; siegeEngines: number },
  moraleChange: number,
  armyChanges: ArmyChange[],
): void {
  const totalPre = armies.reduce((s, a) => s + a.soldiers + a.knights + a.siegeEngines, 0);
  if (armies.length === 0 || totalPre <= 0) return;
  let remSoldiers = remaining.soldiers;
  let remKnights = remaining.knights;
  let remSiege = remaining.siegeEngines;
  armies.forEach((a, idx) => {
    const isLast = idx === armies.length - 1;
    const prev = { soldiers: a.soldiers, knights: a.knights, siegeEngines: a.siegeEngines, morale: a.morale };
    if (isLast) {
      a.soldiers = Math.max(0, remSoldiers);
      a.knights = Math.max(0, remKnights);
      a.siegeEngines = Math.max(0, remSiege);
    } else {
      const share = (a.soldiers + a.knights + a.siegeEngines) / totalPre;
      const s = Math.min(remSoldiers, Math.round(remaining.soldiers * share));
      const k = Math.min(remKnights, Math.round(remaining.knights * share));
      const sg = Math.min(remSiege, Math.round(remaining.siegeEngines * share));
      a.soldiers = s;
      a.knights = k;
      a.siegeEngines = sg;
      remSoldiers -= s;
      remKnights -= k;
      remSiege -= sg;
    }
    a.morale = clampMorale(a.morale + moraleChange);
    armyChanges.push({
      armyId: a.id,
      field: 'troops',
      from: prev,
      to: { soldiers: a.soldiers, knights: a.knights, siegeEngines: a.siegeEngines, morale: a.morale },
    });
  });
}

function eliminateArmies(state: GameState, armies: Army[], armyChanges: ArmyChange[]): void {
  for (const a of armies) {
    const owner = state.factions.get(a.owner);
    if (owner) {
      const idx = owner.armies.indexOf(a.id);
      if (idx >= 0) owner.armies.splice(idx, 1);
    }
    state.armies.delete(a.id);
    armyChanges.push({ armyId: a.id, eliminated: true });
  }
}

function transferTerritory(
  state: GameState,
  territory: Territory,
  newOwner: FactionId,
  changes: StateChange[],
  territoryChanges: TerritoryChange[],
  events: GameEvent[],
): void {
  const oldOwner = territory.owner;
  if (oldOwner === newOwner) return;
  if (oldOwner) {
    const loser = state.factions.get(oldOwner);
    if (loser) loser.territories = loser.territories.filter((id) => id !== territory.id);
  }
  const winner = state.factions.get(newOwner);
  if (winner && !winner.territories.includes(territory.id)) winner.territories.push(territory.id);
  territory.owner = newOwner;
  const destruction = settleTerritoryOwnershipChange(state, territory.id, newOwner, oldOwner);
  if (territoryDestructionHasLosses(destruction)) {
    events.push({
      kind: 'territory',
      id: `building_destroyed_${territory.id}_${state.worldTick}`,
      title: 'Buildings destroyed',
      summary: `Conquest razed works on ${territory.id}`,
      territoryId: territory.id,
      factionId: oldOwner,
      data: {
        buildingDestroyed: true,
        previousOwner: destruction.previousOwner,
        newOwner: destruction.newOwner,
        cityDestroyed: destruction.cityDestroyed,
        cityId: destruction.cityId,
        fortificationDestroyed: destruction.fortificationDestroyed,
        farmDestroyed: destruction.farmDestroyed,
        mineDestroyed: destruction.mineDestroyed,
        lumberDestroyed: destruction.lumberDestroyed,
        constructionCancelled: destruction.constructionCancelled,
      },
    });
  }
  changes.push({
    entity: 'territory',
    id: territory.id,
    field: 'owner',
    from: oldOwner,
    to: newOwner,
    summary: `${territory.id} ownership ${oldOwner ?? 'unclaimed'} → ${newOwner}`,
  });
  territoryChanges.push({ territoryId: territory.id, field: 'owner', from: oldOwner, to: newOwner });
  if (oldOwner && oldOwner === state.playerFactionId) {
    events.push(...applyPlayerTerritoryLoss(state, territory.id));
  }
  if (newOwner === state.playerFactionId) {
    events.push(...applyWorldCompletionCheck(state));
  }
}

/**
 * Occupy a foreign-owned territory that has no field army and no garrison.
 * BattleEngine cannot resolve a 0-defender fight; occupation is still a
 * legal ATTACK outcome and uses the same ownership settlement as capture.
 */
export function applyUnopposedOccupationToGameState(
  state: GameState,
  territory: Territory,
  attackerId: FactionId,
  attackingArmies: Army[],
  turn: number,
): {
  stateChanges: StateChange[];
  territoryChanges: TerritoryChange[];
  armyChanges: ArmyChange[];
  events: GameEvent[];
} {
  const changes: StateChange[] = [];
  const territoryChanges: TerritoryChange[] = [];
  const armyChanges: ArmyChange[] = [];
  const events: GameEvent[] = [];
  const defenderId = territory.owner;
  if (!defenderId || defenderId === attackerId) {
    return { stateChanges: changes, territoryChanges, armyChanges, events };
  }
  if (defenderId === state.playerFactionId) {
    assertAnchorAttackAllowed(state, territory.id);
  }
  const gFrom = territory.garrison;
  if (gFrom !== 0) {
    territory.garrison = 0;
    changes.push({
      entity: 'territory',
      id: territory.id,
      field: 'garrison',
      from: gFrom,
      to: 0,
      summary: `Garrison ${gFrom} → 0`,
    });
    territoryChanges.push({ territoryId: territory.id, field: 'garrison', from: gFrom, to: 0 });
  }
  transferTerritory(state, territory, attackerId, changes, territoryChanges, events);
  for (const a of attackingArmies) {
    const from = a.location;
    a.location = territory.id;
    armyChanges.push({ armyId: a.id, field: 'location', from, to: territory.id });
  }
  const attacker = state.factions.get(attackerId);
  const defender = state.factions.get(defenderId);
  if (attacker && defender) {
    pushMemory(attacker, turn, 'territory_gained', defender.id, territory.id, 12, {
      territory: territory.id,
      via: 'unopposed_occupation',
    });
    pushMemory(defender, turn, 'territory_lost', attacker.id, territory.id, 15, { territory: territory.id });
  }
  return { stateChanges: changes, territoryChanges, armyChanges, events };
}

/**
 * Apply a resolved `BattleResult` onto authoritative `GameState`.
 * Does not call `BattleEngine` — caller must resolve first.
 */
export function applyBattleResultToGameState(
  state: GameState,
  result: BattleResult,
  attackingArmies: Army[],
  defendingArmies: Army[],
  turn: number,
): {
  stateChanges: StateChange[];
  territoryChanges: TerritoryChange[];
  armyChanges: ArmyChange[];
  events: GameEvent[];
} {
  const changes: StateChange[] = [];
  const territoryChanges: TerritoryChange[] = [];
  const armyChanges: ArmyChange[] = [];
  const events: GameEvent[] = [];
  const territory = state.territories.get(result.territoryId);
  if (!territory) return { stateChanges: changes, territoryChanges, armyChanges, events };

  const attacker = state.factions.get(result.attacker.factionId);
  const defender = state.factions.get(result.defender.factionId);

  if (
    result.winner === 'attacker'
    && result.territoryOutcome === 'captured'
    && territory.owner === state.playerFactionId
    && result.attacker.factionId !== state.playerFactionId
  ) {
    assertAnchorAttackAllowed(state, territory.id);
  }

  const gFrom = territory.garrison;
  territory.garrison = Math.max(0, result.defender.remaining.garrison ?? 0);
  changes.push({
    entity: 'territory',
    id: territory.id,
    field: 'garrison',
    from: gFrom,
    to: territory.garrison,
    summary: `Garrison ${gFrom} → ${territory.garrison}`,
  });
  territoryChanges.push({ territoryId: territory.id, field: 'garrison', from: gFrom, to: territory.garrison });

  if (result.winner === 'attacker') {
    eliminateArmies(state, defendingArmies, armyChanges);
    applySurvivingArmies(attackingArmies, result.attacker.remaining, result.attacker.moraleChange, armyChanges);
    if (result.territoryOutcome === 'captured' && attacker) {
      transferTerritory(state, territory, attacker.id, changes, territoryChanges, events);
      for (const a of attackingArmies) a.location = territory.id;
      if (defender) {
        pushMemory(attacker, turn, 'territory_gained', defender.id, territory.id, 12, { territory: territory.id, via: 'conquest' });
        pushMemory(defender, turn, 'territory_lost', attacker.id, territory.id, 15, { territory: territory.id });
      }
    }
    if (attacker && defender) {
      pushMemory(attacker, turn, 'battle_won', defender.id, territory.id, 10, { outcome: result.outcomeType });
      pushMemory(defender, turn, 'battle_lost', attacker.id, territory.id, 12, { outcome: result.outcomeType });
    }
  } else if (result.winner === 'defender') {
    eliminateArmies(state, attackingArmies, armyChanges);
    applySurvivingArmies(defendingArmies, result.defender.remaining, result.defender.moraleChange, armyChanges);
    if (attacker && defender) {
      pushMemory(attacker, turn, 'battle_lost', defender.id, territory.id, 10, { outcome: result.outcomeType });
      pushMemory(defender, turn, 'battle_won', attacker.id, territory.id, 8, { outcome: result.outcomeType });
    }
  } else {
    applySurvivingArmies(attackingArmies, result.attacker.remaining, result.attacker.moraleChange, armyChanges);
    applySurvivingArmies(defendingArmies, result.defender.remaining, result.defender.moraleChange, armyChanges);
  }

  return { stateChanges: changes, territoryChanges, armyChanges, events };
}

export function collectAttackerArmyIds(armies: Army[]): ArmyId[] {
  return armies.map((a) => a.id);
}
