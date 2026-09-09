import { FactionId, Territory, TerritoryId, VisibilityState } from '../types';
import { GameState } from '../types/GameState';

export function visibilityOf(
  state: GameState,
  factionId: FactionId,
  territoryId: TerritoryId,
): VisibilityState {
  const vis = state.visibility.get(factionId);
  if (vis) {
    return vis.visibility.get(territoryId)?.state ?? 'unknown';
  }
  const t = state.territories.get(territoryId);
  const f = state.factions.get(factionId);
  if (!t || !f) return 'unknown';
  if (t.owner === factionId) return 'controlled';
  if (f.knownTerritories.includes(territoryId)) return 'scouted';
  const owned = f.territories
    .map((id) => state.territories.get(id))
    .filter((x): x is Territory => !!x);
  if (owned.some((o) => o.neighboring.includes(territoryId))) return 'discovered';
  return 'unknown';
}

export function fogTerritory(
  state: GameState,
  factionId: FactionId,
  t: Territory,
): Record<string, unknown> {
  const vis = visibilityOf(state, factionId, t.id);
  if (vis === 'unknown') {
    return { id: t.id, visibility: vis, name: null, owner: null };
  }
  if (vis === 'discovered') {
    return {
      id: t.id,
      name: t.name,
      visibility: vis,
      owner: t.owner,
      terrain: t.terrain,
      neighboring: t.neighboring,
    };
  }
  return {
    id: t.id,
    name: t.name,
    visibility: vis,
    owner: t.owner,
    terrain: t.terrain,
    neighboring: t.neighboring,
    population: t.population,
    baseValue: t.baseValue,
    resourceOutput: t.resourceOutput,
    fortification: t.fortification,
    garrison: vis === 'controlled' ? t.garrison : Math.round(t.garrison / 50) * 50,
    isCapital: t.isCapital,
  };
}

/** Read-only public slice safe for GET_GAME_STATE / GET_VISIBLE_WORLD. */
export function serializePublicGameState(state: GameState, viewerFactionId: FactionId | null): Record<string, unknown> {
  const territories: Record<string, unknown> = {};
  for (const t of state.territories.values()) {
    territories[t.id] = viewerFactionId ? fogTerritory(state, viewerFactionId, t) : {
      id: t.id,
      name: t.name,
      owner: t.owner,
      terrain: t.terrain,
    };
  }
  const factions = [...state.factions.values()].map((f) => ({
    id: f.id,
    name: f.name,
    territoryCount: f.territories.length,
    armyCount: f.armies.length,
    personality: f.personality.type,
    ambition: f.ambition,
  }));
  const armies = [...state.armies.values()].map((a) => ({
    id: a.id,
    owner: a.owner,
    location: a.location,
    soldiers: a.soldiers,
    knights: a.knights,
    siegeEngines: a.siegeEngines,
    morale: a.morale,
    moving: a.movement?.status === 'moving',
    destinationTerritoryId: a.movement?.status === 'moving' ? a.movement.destinationTerritoryId : null,
    pendingAttackTargetId: a.attackIntent?.targetTerritoryId ?? null,
    pendingAttackStagingId: a.attackIntent?.stagingTerritoryId ?? null,
  }));
  return {
    schemaVersion: state.schemaVersion,
    turn: state.turn,
    worldTick: state.worldTick,
    worldSeed: state.worldSeed,
    playerFactionId: state.playerFactionId,
    viewerFactionId,
    allFactionIds: [...state.allFactionIds],
    factions,
    territories,
    armies,
    activeEventCount: state.activeEvents.filter((e) => e.status === 'active').length,
    commitmentCount: [...state.commitments.values()].filter((c) => c !== null).length,
    hasMapWorld: state.mapWorld !== null,
    hasVisibilityMaps: state.visibility.size > 0,
  };
}

export function serializeVisibleWorld(state: GameState, viewerFactionId: FactionId): Record<string, unknown> {
  const territories: Record<string, unknown> = {};
  for (const t of state.territories.values()) {
    const vis = visibilityOf(state, viewerFactionId, t.id);
    if (vis === 'unknown') continue;
    territories[t.id] = fogTerritory(state, viewerFactionId, t);
  }
  const viewer = state.factions.get(viewerFactionId);
  return {
    turn: state.turn,
    worldTick: state.worldTick,
    viewerFactionId,
    knownFactions: viewer?.knownFactions ?? [],
    knownTerritories: viewer?.knownTerritories ?? [],
    territories,
    visibilitySource: state.visibility.has(viewerFactionId) ? 'mapEngine' : 'factionKnowledge',
  };
}
