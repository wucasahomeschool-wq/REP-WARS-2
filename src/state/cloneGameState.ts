/**
 * GAMESTATE CLONING (AUTHORITATIVE RUNTIME GAMESTATE PASS). See
 * docs/AUTHORITATIVE_GAMESTATE_ARCHITECTURE.md, "Cloning / snapshots".
 *
 * `cloneGameState()` produces a fully independent deep copy: no shared
 * `Map`/`Set`/array/object references with the source. Modifying the
 * clone (or the source) after cloning must never affect the other. Used
 * for deterministic tests and as the building block a future replay/
 * simulate-ahead feature would use — this file does not implement
 * persistence.
 *
 * NOTE ON DUPLICATION: `src/events/WorldSimulator.ts` already has its own
 * private `cloneTerritory`/`cloneWarlordSnapshot`/`cloneMap`/`cloneActiveEvent`
 * helpers with equivalent semantics, used to keep `WorldSimulator.simulate()`
 * pure. This file intentionally does NOT import or refactor those (out of
 * scope for this pass — `WorldSimulator` is already tested/passing and
 * this pass avoids touching engines that don't need to change). Bringing
 * both sets of clone helpers under one shared module is a documented
 * follow-up in docs/AUTHORITATIVE_GAMESTATE_ARCHITECTURE.md, "Remaining
 * migration gaps".
 */
import { Army, DiplomaticRelationship, FactionId, MapWorldState, PlayerVisibilityMap, Region, Resources, Territory, ThemeDefinition, Treaty, WarlordSnapshot } from '../types';
import { ActiveEvent, ConsequenceDelta, HistoryEntry } from '../events/EventModel';
import {
  ActiveInvasion,
  AttackerCooldown,
  City,
  ConstructionProject,
  DefenseMobilizationAttachment,
  GameState,
  PlayerFitnessState,
  PlayerRewardState,
  TerritoryEconomy,
} from '../types/GameState';
import { cloneCommitment } from '../engine/DecisionEngine';
import { cloneArmyMovement } from '../army/movement';
import { cloneAttackIntent } from '../army/strategicAttack';
import { cloneFitnessEstimate } from '../fitness/estimate/clone';
import { cloneWorkoutSession } from '../fitness/session/clone';
import { cloneGameRewardResult } from '../rewards/validation';

export function cloneMap<K, V>(m: Map<K, V>, cloneFn: (v: V) => V): Map<K, V> {
  const out = new Map<K, V>();
  for (const [k, v] of m.entries())
    out.set(k, cloneFn(v));
  return out;
}

export function cloneTerritory(t: Territory): Territory {
  return {
    ...t,
    neighboring: [...t.neighboring],
    resourceOutput: { ...t.resourceOutput },
  };
}

export function cloneArmy(a: Army): Army {
  const { movement, attackIntent, ...rest } = a;
  const cloned: Army = { ...rest };
  const clonedMovement = cloneArmyMovement(movement);
  if (clonedMovement !== undefined) cloned.movement = clonedMovement;
  const clonedIntent = cloneAttackIntent(attackIntent);
  if (clonedIntent !== undefined) cloned.attackIntent = clonedIntent;
  return cloned;
}

function cloneTreaty(t: Treaty): Treaty {
  return { ...t, terms: { ...t.terms } };
}

function cloneDiplomaticRelationship(r: DiplomaticRelationship): DiplomaticRelationship {
  return { ...r, treaties: r.treaties.map(cloneTreaty) };
}

export function cloneWarlordSnapshot(f: WarlordSnapshot): WarlordSnapshot {
  const diplomacy = new Map<FactionId, DiplomaticRelationship>();
  for (const [k, v] of f.diplomacy.entries())
    diplomacy.set(k, cloneDiplomaticRelationship(v));
  return {
    ...f,
    personality: { ...f.personality },
    territories: [...f.territories],
    armies: [...f.armies],
    resources: { ...f.resources } as Resources,
    resourceIncome: { ...f.resourceIncome },
    diplomacy,
    memory: f.memory.map((m) => ({ ...m, details: { ...m.details } })),
    goals: f.goals.map((g) => ({ ...g })),
    currentThreats: [...f.currentThreats],
    knownFactions: [...f.knownFactions],
    knownTerritories: [...f.knownTerritories],
    lastActions: f.lastActions.map((a) => ({ ...a })),
  };
}

function cloneThemeDefinition(t: ThemeDefinition): ThemeDefinition {
  return {
    ...t,
    preferredTerrain: t.preferredTerrain.map((p) => ({ ...p })),
    terrainDistributionWeights: { ...t.terrainDistributionWeights },
    naming: {
      ...t.naming,
      prefixes: [...t.naming.prefixes],
      roots: [...t.naming.roots],
      suffixes: [...t.naming.suffixes],
      formatWeights: { ...t.naming.formatWeights },
    },
    resourceTendencies: { ...t.resourceTendencies },
    baseValueRange: [...t.baseValueRange] as [number, number],
    populationRange: [...t.populationRange] as [number, number],
    garrisonRange: [...t.garrisonRange] as [number, number],
    fortificationWeights: { ...t.fortificationWeights },
    borderSizePreference: { ...t.borderSizePreference },
    allowedAdjacentThemes: [...t.allowedAdjacentThemes],
  };
}

function cloneRegion(r: Region): Region {
  return { ...r, territories: [...r.territories] };
}

function cloneMapWorldState(w: MapWorldState): MapWorldState {
  return {
    ...w,
    territories: cloneMap(w.territories, cloneTerritory),
    regions: cloneMap(w.regions, cloneRegion),
    themes: cloneMap(w.themes, cloneThemeDefinition),
    graphMeta: {
      ...w.graphMeta,
      frontierTerritories: new Set(w.graphMeta.frontierTerritories),
      coordToTerritory: new Map(w.graphMeta.coordToTerritory),
      territoryPos: new Map(
        Array.from(w.graphMeta.territoryPos.entries()).map(([k, v]) => [k, { ...v }] as const),
      ),
    },
  };
}

function clonePlayerVisibilityMap(v: PlayerVisibilityMap): PlayerVisibilityMap {
  return {
    ...v,
    visibility: cloneMap(v.visibility, (entry) => ({ ...entry })),
    knownThemes: new Set(v.knownThemes),
    knownRegions: new Set(v.knownRegions),
  };
}

/**
 * Clones a `ConsequenceDelta`, only including its optional `delta.*`
 * sub-fields when the source actually had them — an object literal that
 * never had a `resourceOutputPct` key must not gain one (with value
 * `undefined`) after cloning, since that changes the object's own-key
 * shape even though the field reads as `undefined` either way (visible to
 * `assert.deepStrictEqual`, which distinguishes "key present with value
 * `undefined`" from "key absent").
 */
function cloneConsequenceDelta(c: ConsequenceDelta): ConsequenceDelta {
  const delta: ConsequenceDelta['delta'] = { ...c.delta };
  if (c.delta.resources) delta.resources = { ...c.delta.resources };
  if (c.delta.resourceOutputPct) delta.resourceOutputPct = { ...c.delta.resourceOutputPct };
  if (c.delta.relationshipDeltaOpinion) delta.relationshipDeltaOpinion = { ...c.delta.relationshipDeltaOpinion };
  return { ...c, delta };
}

function cloneActiveEvent(e: ActiveEvent): ActiveEvent {
  const cloned: ActiveEvent = {
    ...e,
    causes: [...(e.causes ?? [])],
    consequences: (e.consequences ?? []).map(cloneConsequenceDelta),
    chainDelays: (e.chainDelays ?? []).map((cd) => ({ ...cd })),
    choicesPending: (e.choicesPending ?? []).map((c) => (c.cost ? { ...c, cost: { ...c.cost } } : { ...c })),
  };
  if (e.choiceTaken) {
    cloned.choiceTaken = {
      ...e.choiceTaken,
      consequences: e.choiceTaken.consequences.map(cloneConsequenceDelta),
    };
  }
  return cloned;
}

function cloneHistoryEntry(h: HistoryEntry): HistoryEntry {
  return h.detail ? { ...h, detail: { ...h.detail } } : { ...h };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneDefenseMobilization(
  attachment: DefenseMobilizationAttachment | null,
): DefenseMobilizationAttachment | null {
  return attachment ? { ...attachment } : null;
}

function cloneActiveInvasion(invasion: ActiveInvasion): ActiveInvasion {
  return {
    ...invasion,
    attackingArmyIds: [...invasion.attackingArmyIds],
    defenseMobilization: cloneDefenseMobilization(invasion.defenseMobilization),
  };
}

function cloneConstruction(project: ConstructionProject): ConstructionProject {
  return { ...project };
}

function cloneCity(city: City): City {
  return {
    ...city,
    buildings: city.buildings.map((building) => ({ ...building })),
  };
}

function cloneTerritoryEconomy(economy: TerritoryEconomy): TerritoryEconomy {
  return {
    territoryId: economy.territoryId,
    lastAccrualTick: economy.lastAccrualTick,
    uncollected: { ...economy.uncollected },
  };
}

function clonePlayerFitness(fitness: PlayerFitnessState): PlayerFitnessState {
  return {
    estimate: fitness.estimate ? cloneFitnessEstimate(fitness.estimate) : null,
    lastWorkoutCompletedAtTick: fitness.lastWorkoutCompletedAtTick,
    compactHistory: fitness.compactHistory.map((entry) => ({ ...entry })),
    activeSession: fitness.activeSession ? cloneWorkoutSession(fitness.activeSession) : null,
    pendingReward: fitness.pendingReward
      ? {
        sessionId: fitness.pendingReward.sessionId,
        reward: cloneGameRewardResult(fitness.pendingReward.reward),
        context: { ...fitness.pendingReward.context },
      }
      : null,
  };
}

function cloneCooldown(cooldown: AttackerCooldown): AttackerCooldown {
  return { ...cooldown };
}

function clonePlayerRewardState(rewards: PlayerRewardState): PlayerRewardState {
  return {
    bankedTroops: rewards.bankedTroops,
    pendingConstructionEffects: rewards.pendingConstructionEffects.map((effect) => ({ ...effect })),
    pendingGoldenYieldEffects: rewards.pendingGoldenYieldEffects.map((effect) => ({ ...effect })),
    appliedRewards: rewards.appliedRewards.map((record) => ({
      applicationId: record.applicationId,
      sessionId: record.sessionId,
      kind: record.kind,
      appliedAtTick: record.appliedAtTick,
      result: cloneJson(record.result),
    })),
  };
}

/**
 * Deep-clones a `GameState` with no shared mutable nested references.
 * Every `Map`/`Set`/array/object nested field is rebuilt, including
 * `factions[].diplomacy`, `mapWorld.graphMeta`, `visibility[].visibility`,
 * `commitments`, `activeEvents`, `playerRewards`, and `activeInvasions`.
 * See tests/run.ts, "GameState clone isolation".
 */
export function cloneGameState(state: GameState): GameState {
  return {
    schemaVersion: state.schemaVersion,
    turn: state.turn,
    worldTick: state.worldTick,
    lastAiDecisionTick: new Map(state.lastAiDecisionTick),
    worldSeed: state.worldSeed,
    factions: cloneMap(state.factions, cloneWarlordSnapshot),
    allFactionIds: [...state.allFactionIds],
    playerFactionId: state.playerFactionId,
    territories: cloneMap(state.territories, cloneTerritory),
    mapWorld: state.mapWorld ? cloneMapWorldState(state.mapWorld) : null,
    visibility: cloneMap(state.visibility, clonePlayerVisibilityMap),
    armies: cloneMap(state.armies, cloneArmy),
    commitments: cloneMap(state.commitments, (c) => (c ? cloneCommitment(c) : null)),
    activeEvents: state.activeEvents.map(cloneActiveEvent),
    eventHistory: state.eventHistory.map(cloneHistoryEntry),
    playerRewards: clonePlayerRewardState(state.playerRewards),
    activeInvasions: cloneMap(state.activeInvasions, cloneActiveInvasion),
    constructions: cloneMap(state.constructions, cloneConstruction),
    cities: cloneMap(state.cities, cloneCity),
    territoryEconomy: cloneMap(state.territoryEconomy, cloneTerritoryEconomy),
    playerFitness: clonePlayerFitness(state.playerFitness),
    playerEmpirePause: { ...state.playerEmpirePause },
    attackerCooldowns: cloneMap(state.attackerCooldowns, cloneCooldown),
  };
}
