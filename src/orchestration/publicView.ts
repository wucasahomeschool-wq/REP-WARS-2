import { Army, FactionId, Territory, TerritoryId, VisibilityState } from '../types';
import { GameState } from '../types/GameState';
import { peekCollectibleResources } from '../gameplay/economy/accrual';
import { displayedRemainingTicks } from '../gameplay/construction/progress';
import { isOpenInvasion, remainingDeadlineTicks } from '../gameplay/invasion/deadlines';
import { playerFacingTick } from '../gameplay/invasion/eligibility';

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

/**
 * Own armies are always visible. Foreign armies are visible only on tiles
 * the viewer has scouted or controls — `discovered` knows the tile exists
 * but does not reveal occupying forces (matching garrison hiding on
 * discovered tiles in `fogTerritory`).
 */
export function isArmyVisibleTo(state: GameState, viewerFactionId: FactionId, army: Army): boolean {
  if (army.owner === viewerFactionId) return true;
  const vis = visibilityOf(state, viewerFactionId, army.location);
  return vis === 'scouted' || vis === 'controlled';
}

function serializeArmyForViewer(army: Army, viewerFactionId: FactionId): Record<string, unknown> {
  const own = army.owner === viewerFactionId;
  const round = (n: number) => (own ? n : Math.round(n / 50) * 50);
  return {
    id: army.id,
    owner: army.owner,
    location: army.location,
    soldiers: round(army.soldiers),
    knights: round(army.knights),
    siegeEngines: own ? army.siegeEngines : Math.round(army.siegeEngines / 5) * 5,
    morale: own ? army.morale : null,
    moving: own ? army.movement?.status === 'moving' : false,
    destinationTerritoryId: own && army.movement?.status === 'moving'
      ? army.movement.destinationTerritoryId
      : null,
    pendingAttackTargetId: own ? army.attackIntent?.targetTerritoryId ?? null : null,
    pendingAttackStagingId: own ? army.attackIntent?.stagingTerritoryId ?? null : null,
  };
}

export function visibleArmiesFor(
  state: GameState,
  viewerFactionId: FactionId,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const army of state.armies.values()) {
    if (!isArmyVisibleTo(state, viewerFactionId, army)) continue;
    out.push(serializeArmyForViewer(army, viewerFactionId));
  }
  return out;
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
  const factions = [...state.factions.values()].map((f) => {
    const self = viewerFactionId !== null && f.id === viewerFactionId;
    return {
      id: f.id,
      name: f.name,
      territoryCount: self ? f.territories.length : undefined,
      personality: f.personality.type,
      ambition: f.ambition,
    };
  });
  const armies = viewerFactionId ? visibleArmiesFor(state, viewerFactionId) : [];
  const playerView = viewerFactionId && viewerFactionId === state.playerFactionId
    ? serializePlayerGameplayView(state)
    : undefined;
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
    ...(playerView ? { playerGameplay: playerView } : {}),
  };
}

function serializePlayerGameplayView(state: GameState): Record<string, unknown> {
  const now = playerFacingTick(state);
  const invasions = [...state.activeInvasions.values()]
    .filter((invasion) => invasion.defenderFactionId === state.playerFactionId && isOpenInvasion(invasion))
    .map((invasion) => ({
      invasionId: invasion.id,
      status: invasion.status,
      territoryId: invasion.territoryId,
      attackerFactionId: invasion.attackerFactionId,
      notifiedAtTick: invasion.notifiedAtTick,
      responseDeadlineTick: invasion.responseDeadlineTick,
      remainingResponseTicks: remainingDeadlineTicks(now, invasion.responseDeadlineTick),
      defenseInProgress: invasion.status === 'defense_in_progress',
      defenseStarted: invasion.defenseWorkoutStartedAtTick !== null,
      defenseWorkoutStartedAtTick: invasion.defenseWorkoutStartedAtTick,
      defenseCompletionDeadlineTick: invasion.defenseCompletionDeadlineTick,
      remainingDefenseTicks: invasion.defenseCompletionDeadlineTick === null
        ? null
        : remainingDeadlineTicks(now, invasion.defenseCompletionDeadlineTick),
      hasDefenseMobilization: invasion.defenseMobilization !== null,
    }));
  const faction = state.playerFactionId ? state.factions.get(state.playerFactionId) : undefined;
  const ownedTerritoryIds = faction?.territories ?? [];
  const uncollected: Record<string, unknown> = {};
  for (const territoryId of ownedTerritoryIds) {
    uncollected[territoryId] = peekCollectibleResources(state, territoryId);
  }
  const cities = [...state.cities.values()]
    .filter((city) => city.factionId === state.playerFactionId)
    .map((city) => ({
      id: city.id,
      territoryId: city.territoryId,
      buildings: city.buildings.map((building) => ({ ...building })),
    }));
  return {
    resources: faction ? { ...faction.resources } : null,
    cities,
    uncollected,
    bankedTroops: state.playerRewards.bankedTroops,
    pendingConstructionEffects: state.playerRewards.pendingConstructionEffects.map((effect) => ({
      workerPower: effect.workerPower,
      appliedAtTick: effect.appliedAtTick,
    })),
    pendingGoldenYieldEffects: state.playerRewards.pendingGoldenYieldEffects.map((effect) => ({
      multiplier: effect.multiplier,
      appliedAtTick: effect.appliedAtTick,
    })),
    constructions: [...state.constructions.values()]
      .filter((project) => project.factionId === state.playerFactionId)
      .map((project) => ({
        id: project.id,
        territoryId: project.territoryId,
        remainingTicks: displayedRemainingTicks(project, state.worldTick),
        status: project.status,
        startedAtTick: project.startedAtTick,
        durationTicks: project.durationTicks,
      })),
    activeInvasionsAgainstPlayer: invasions,
    empirePaused: state.playerEmpirePause.paused,
    lastWorkoutCompletedAtTick: state.playerFitness.lastWorkoutCompletedAtTick,
    fitnessLevel: state.playerFitness.estimate?.level ?? null,
    fitnessConfidence: state.playerFitness.estimate?.confidence ?? null,
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
    armies: visibleArmiesFor(state, viewerFactionId),
    visibilitySource: state.visibility.has(viewerFactionId) ? 'mapEngine' : 'factionKnowledge',
  };
}
