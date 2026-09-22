import {
  GAME_STATE_SCHEMA_VERSION,
  emptyLevelDefeatState,
  emptyPlayerEmpirePause,
  emptyPlayerFitnessState,
  emptyPlayerRewardState,
} from '../types/GameState';
import { coerceLevel1TutorialState } from '../gameplay/tutorial/level1';
import { coercePlayerProgressionState } from '../fitness/progression/types';
import { PersistenceError } from './errors';

export const MIN_SUPPORTED_GAME_STATE_SCHEMA = 5;
export const CURRENT_GAME_STATE_SCHEMA = GAME_STATE_SCHEMA_VERSION;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PersistenceError('persistence.corrupt', 'Persisted GameState is not an object');
  }
  return value as Record<string, unknown>;
}

function coerceMap(value: unknown): Map<unknown, unknown> {
  if (value instanceof Map) return value;
  if (Array.isArray(value)) {
    const map = new Map<unknown, unknown>();
    for (const entry of value) {
      if (Array.isArray(entry) && entry.length >= 2) map.set(entry[0], entry[1]);
    }
    return map;
  }
  if (value && typeof value === 'object') {
    return new Map(Object.entries(value as Record<string, unknown>));
  }
  return new Map();
}

function migrateInvasion(invasion: unknown): void {
  if (!invasion || typeof invasion !== 'object') return;
  const rec = invasion as Record<string, unknown>;
  if (rec.status === 'active') rec.status = 'pending_response';
  if (!('defenseCompletionDeadlineTick' in rec)) rec.defenseCompletionDeadlineTick = null;
  if (!('defenseSessionId' in rec)) rec.defenseSessionId = null;
  if (!('defenseWorkoutStartedAtTick' in rec)) rec.defenseWorkoutStartedAtTick = null;
}

function migrateTerritory(territory: unknown): void {
  if (!territory || typeof territory !== 'object') return;
  const rec = territory as Record<string, unknown>;
  delete rec.name;
  delete rec.isCapital;
  delete rec.isKnown;
  delete rec.scoutedTurnsAgo;
  if (typeof rec.regionId !== 'string' || rec.regionId.length === 0) {
    rec.regionId = 'r_legacy_sample';
  }
}

function migrateConstruction(project: unknown): void {
  if (!project || typeof project !== 'object') return;
  const rec = project as Record<string, unknown>;
  if (!('lastProgressTick' in rec)) {
    rec.lastProgressTick = rec.startedAtTick ?? 0;
  }
  if (
    rec.projectType !== 'CITY'
    && rec.projectType !== 'FORTIFICATION'
    && rec.projectType !== 'FARM'
    && rec.projectType !== 'MINE'
    && rec.projectType !== 'LUMBER'
  ) {
    rec.projectType = 'FORTIFICATION';
  }
}

function occupancyStamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Farm/Mine/Lumber occupancy only. Roads/Markets are not persisted in v1. */
function migrateInfrastructure(entry: unknown, key: unknown): Record<string, unknown> {
  const rec = entry && typeof entry === 'object' && !Array.isArray(entry)
    ? entry as Record<string, unknown>
    : {};
  const territoryId = typeof rec.territoryId === 'string' && rec.territoryId.length > 0
    ? rec.territoryId
    : typeof key === 'string' ? key : '';
  return {
    territoryId,
    farmCompletedAtTick: occupancyStamp(rec.farmCompletedAtTick),
    mineCompletedAtTick: occupancyStamp(rec.mineCompletedAtTick),
    lumberCompletedAtTick: occupancyStamp(rec.lumberCompletedAtTick),
  };
}

function reviveNestedCollections(state: Record<string, unknown>): void {
  const factions = coerceMap(state.factions);
  state.factions = factions;
  for (const faction of factions.values()) {
    if (!faction || typeof faction !== 'object') continue;
    const rec = faction as Record<string, unknown>;
    rec.diplomacy = coerceMap(rec.diplomacy);
  }

  delete state.visibility;
  delete state.mapWorld;
}

/**
 * Bring a decoded GameState-shaped object forward to schema 12.
 * Missing maps are created empty; major corruption still fails later invariants.
 */
export function migrateGameStatePayload(raw: unknown): Record<string, unknown> {
  const state = asRecord(raw);
  const schema = typeof state.schemaVersion === 'number' ? state.schemaVersion : 0;
  if (!Number.isInteger(schema)) {
    throw new PersistenceError('persistence.corrupt', 'schemaVersion is missing or invalid', { schemaVersion: state.schemaVersion });
  }
  if (schema > CURRENT_GAME_STATE_SCHEMA) {
    throw new PersistenceError(
      'persistence.unsupported_schema',
      `GameState schema ${schema} is newer than supported ${CURRENT_GAME_STATE_SCHEMA}`,
      { schemaVersion: schema },
    );
  }
  if (schema < MIN_SUPPORTED_GAME_STATE_SCHEMA) {
    throw new PersistenceError(
      'persistence.unsupported_schema',
      `GameState schema ${schema} is older than supported ${MIN_SUPPORTED_GAME_STATE_SCHEMA}`,
      { schemaVersion: schema },
    );
  }

  state.lastAiDecisionTick = coerceMap(state.lastAiDecisionTick);
  state.territories = coerceMap(state.territories);
  state.armies = coerceMap(state.armies);
  state.commitments = coerceMap(state.commitments);
  reviveNestedCollections(state);

  const territories = state.territories as Map<unknown, unknown>;
  for (const territory of territories.values()) migrateTerritory(territory);

  state.regions = coerceMap(state.regions);
  if (typeof state.definitionWorldId !== 'string') state.definitionWorldId = 'legacy:sample-map';
  if (typeof state.definitionFormatVersion !== 'string') state.definitionFormatVersion = 'legacy-sample-map';
  if (typeof state.worldLevel !== 'number') state.worldLevel = 1;
  if (state.worldName === undefined) state.worldName = null;

  const allTerritoryIds = [...territories.keys()].filter((id): id is string => typeof id === 'string');
  const regions = state.regions as Map<unknown, unknown>;
  if (regions.size === 0 && allTerritoryIds.length > 0) {
    regions.set('r_legacy_sample', {
      id: 'r_legacy_sample',
      name: 'Legacy Sample Map',
      territoryIds: [...allTerritoryIds],
    });
  }

  const factions = state.factions as Map<unknown, unknown>;
  for (const faction of factions.values()) {
    if (!faction || typeof faction !== 'object') continue;
    const rec = faction as Record<string, unknown>;
    rec.knownTerritories = [...allTerritoryIds];
  }

  if (!state.playerRewards) state.playerRewards = emptyPlayerRewardState();
  if (!state.activeInvasions) state.activeInvasions = new Map();
  if (!state.constructions) state.constructions = new Map();
  if (!state.cities) state.cities = new Map();
  if (!state.territoryEconomy) state.territoryEconomy = new Map();
  if (!state.territoryInfrastructure) state.territoryInfrastructure = new Map();
  if (!state.playerFitness) state.playerFitness = emptyPlayerFitnessState();
  if (!state.playerEmpirePause) state.playerEmpirePause = emptyPlayerEmpirePause();
  if (!state.attackerCooldowns) state.attackerCooldowns = new Map();
  if (!Array.isArray(state.levelAnchorTerritoryIds)) state.levelAnchorTerritoryIds = [];
  if (!state.levelDefeat || typeof state.levelDefeat !== 'object' || Array.isArray(state.levelDefeat)) {
    state.levelDefeat = emptyLevelDefeatState();
  } else {
    const defeat = state.levelDefeat as Record<string, unknown>;
    if (defeat.status !== 'active' && defeat.status !== 'defeated') defeat.status = 'active';
    if (!Array.isArray(defeat.previousWorldIds)) defeat.previousWorldIds = [];
    if (!('defeatedAtTick' in defeat)) defeat.defeatedAtTick = null;
    if (!('defeatedLevel' in defeat)) defeat.defeatedLevel = null;
    if (!('defeatedWorldId' in defeat)) defeat.defeatedWorldId = null;
    if (!('lastLostAnchorTerritoryId' in defeat)) defeat.lastLostAnchorTerritoryId = null;
  }

  if ('level1Tutorial' in state) {
    state.level1Tutorial = coerceLevel1TutorialState(state.level1Tutorial);
  } else {
    state.level1Tutorial = null;
  }

  state.activeInvasions = coerceMap(state.activeInvasions);
  for (const invasion of (state.activeInvasions as Map<unknown, unknown>).values()) migrateInvasion(invasion);

  state.constructions = coerceMap(state.constructions);
  for (const project of (state.constructions as Map<unknown, unknown>).values()) migrateConstruction(project);

  state.cities = coerceMap(state.cities);
  state.territoryEconomy = coerceMap(state.territoryEconomy);
  state.territoryInfrastructure = coerceMap(state.territoryInfrastructure);
  const infrastructure = state.territoryInfrastructure as Map<unknown, unknown>;
  for (const [key, value] of [...infrastructure.entries()]) {
    infrastructure.set(key, migrateInfrastructure(value, key));
  }
  state.attackerCooldowns = coerceMap(state.attackerCooldowns);

  const worldTick = typeof state.worldTick === 'number' && Number.isInteger(state.worldTick) && state.worldTick >= 0
    ? state.worldTick
    : 0;
  if (!Number.isInteger(state.lastFoodConsumptionTick) || (state.lastFoodConsumptionTick as number) < 0) {
    state.lastFoodConsumptionTick = worldTick;
  }

  const fitness = state.playerFitness as Record<string, unknown> | undefined;
  if (fitness && typeof fitness === 'object') {
    if (!Array.isArray(fitness.compactHistory)) fitness.compactHistory = [];
    if (!('pendingReward' in fitness)) fitness.pendingReward = null;
    if (!('activeSession' in fitness)) fitness.activeSession = null;
    if (!('estimate' in fitness)) fitness.estimate = null;
    if (!('lastWorkoutCompletedAtTick' in fitness)) fitness.lastWorkoutCompletedAtTick = null;
    fitness.progression = coercePlayerProgressionState(fitness.progression);
  }

  if (!Array.isArray(state.allFactionIds)) state.allFactionIds = [];
  if (!Array.isArray(state.activeEvents)) state.activeEvents = [];
  if (!Array.isArray(state.eventHistory)) state.eventHistory = [];

  state.schemaVersion = CURRENT_GAME_STATE_SCHEMA;
  return state;
}
