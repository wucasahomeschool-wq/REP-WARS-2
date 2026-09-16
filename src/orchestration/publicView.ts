import { Army, FactionId, Territory } from '../types';
import { GameState } from '../types/GameState';
import { peekCollectibleResources } from '../gameplay/economy/accrual';
import { displayedRemainingTicks } from '../gameplay/construction/progress';
import { isOpenInvasion, remainingDeadlineTicks } from '../gameplay/invasion/deadlines';
import { playerFacingTick } from '../gameplay/invasion/eligibility';
import { evaluateWorldCompletion } from '../gameplay/completion';
import { evaluateWorldTransition } from '../gameplay/worldTransition';
import { serializeLevel1TutorialView } from '../gameplay/tutorial/level1';
import { regionDisplayName } from '../worldDefinition/display';
import { getCurrentExercise } from '../fitness/session';
import { WorkoutSession } from '../fitness/session/types';

/** The current authored world is fully visible. No territory fog. */
export function isArmyVisibleTo(state: GameState, viewerFactionId: FactionId, army: Army): boolean {
  void state;
  void viewerFactionId;
  void army;
  return true;
}

/**
 * Player-facing military strength. Internal armies still store soldiers/knights/siegeEngines
 * for BattleEngine; those categories are not shown on GET_GAME_STATE / GET_VISIBLE_WORLD.
 */
export function playerFacingTroopCount(army: Pick<Army, 'soldiers' | 'knights' | 'siegeEngines'>): number {
  return Math.max(0, army.soldiers) + Math.max(0, army.knights) + Math.max(0, army.siegeEngines);
}

function serializeActiveWorkout(session: WorkoutSession | null): Record<string, unknown> | null {
  if (!session) return null;
  const current = getCurrentExercise(session);
  return {
    sessionId: session.sessionId,
    workoutId: session.workoutId,
    purpose: session.purpose,
    state: session.state,
    intendedDifficulty: session.intendedDifficulty,
    currentExerciseIndex: session.currentExerciseIndex,
    currentExercise: current,
    prescribedExercises: session.prescribedWorkout.exercises.map((step) => ({
      exerciseId: step.exerciseId,
      order: step.order,
      exerciseType: step.exerciseType,
      isRest: step.isRest,
      bodySection: step.bodySection,
      prescription: { ...step.prescription },
      role: step.role,
      skippable: step.skippable,
    })),
    performances: session.performances.map((p) => ({
      exerciseId: p.exerciseId,
      order: p.order,
      status: p.status,
      actual: p.actual,
    })),
    feedbackState: session.feedbackState,
    feedback: session.feedback,
    integrityFlagCount: session.integrityFlags.length,
    gameplayContext: session.gameplayContext ? { ...session.gameplayContext } : null,
  };
}

function serializeArmyForViewer(army: Army, viewerFactionId: FactionId): Record<string, unknown> {
  const own = army.owner === viewerFactionId;
  const troops = playerFacingTroopCount(army);
  return {
    id: army.id,
    owner: army.owner,
    location: army.location,
    troops: own ? troops : Math.round(troops / 50) * 50,
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
    out.push(serializeArmyForViewer(army, viewerFactionId));
  }
  return out;
}

function publicTerritory(state: GameState, t: Territory): Record<string, unknown> {
  const infra = state.territoryInfrastructure.get(t.id);
  return {
    id: t.id,
    regionId: t.regionId,
    regionName: regionDisplayName(state, t.id),
    visibility: 'visible',
    owner: t.owner,
    terrain: t.terrain,
    neighboring: t.neighboring,
    population: t.population,
    baseValue: t.baseValue,
    resourceOutput: t.resourceOutput,
    fortification: t.fortification,
    garrison: t.garrison,
    farm: infra?.farmCompletedAtTick != null,
    mine: infra?.mineCompletedAtTick != null,
    lumber: infra?.lumberCompletedAtTick != null,
  };
}

/** Read-only public slice safe for GET_GAME_STATE / GET_VISIBLE_WORLD. */
export function serializePublicGameState(state: GameState, viewerFactionId: FactionId | null): Record<string, unknown> {
  const territories: Record<string, unknown> = {};
  for (const t of state.territories.values()) {
    territories[t.id] = publicTerritory(state, t);
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
    definitionWorldId: state.definitionWorldId,
    worldLevel: state.worldLevel,
    worldName: state.worldName,
    levelAnchorTerritoryIds: [...state.levelAnchorTerritoryIds],
    levelDefeatStatus: state.levelDefeat.status,
    allFactionIds: [...state.allFactionIds],
    factions,
    territories,
    armies,
    activeEventCount: state.activeEvents.filter((e) => e.status === 'active').length,
    commitmentCount: [...state.commitments.values()].filter((c) => c !== null).length,
    currentWorldFullyVisible: true,
    worldCompletion: evaluateWorldCompletion(state),
    worldTransition: evaluateWorldTransition(state),
    tutorial: serializeLevel1TutorialView(state),
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
    infrastructure: Object.fromEntries(ownedTerritoryIds.map((territoryId) => {
      const infra = state.territoryInfrastructure.get(territoryId);
      return [territoryId, {
        farm: infra?.farmCompletedAtTick != null,
        mine: infra?.mineCompletedAtTick != null,
        lumber: infra?.lumberCompletedAtTick != null,
      }];
    })),
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
        projectType: project.projectType,
        remainingTicks: displayedRemainingTicks(project, state.worldTick),
        status: project.status,
        startedAtTick: project.startedAtTick,
        durationTicks: project.durationTicks,
      })),
    activeInvasionsAgainstPlayer: invasions,
    empirePaused: state.playerEmpirePause.paused,
    activeWorkout: serializeActiveWorkout(state.playerFitness.activeSession),
    pendingWorkoutReward: state.playerFitness.pendingReward
      ? {
        sessionId: state.playerFitness.pendingReward.sessionId,
        kind: state.playerFitness.pendingReward.reward.kind,
        purpose: state.playerFitness.pendingReward.reward.purpose,
      }
      : null,
    lastWorkoutCompletedAtTick: state.playerFitness.lastWorkoutCompletedAtTick,
    fitnessLevel: state.playerFitness.estimate?.level ?? null,
    fitnessConfidence: state.playerFitness.estimate?.confidence ?? null,
    levelAnchorTerritoryIds: [...state.levelAnchorTerritoryIds],
    levelDefeat: {
      status: state.levelDefeat.status,
      defeatedAtTick: state.levelDefeat.defeatedAtTick,
      defeatedLevel: state.levelDefeat.defeatedLevel,
      defeatedWorldId: state.levelDefeat.defeatedWorldId,
      lastLostAnchorTerritoryId: state.levelDefeat.lastLostAnchorTerritoryId,
      previousWorldIds: [...state.levelDefeat.previousWorldIds],
    },
    tutorial: serializeLevel1TutorialView(state),
  };
}

export function serializeVisibleWorld(state: GameState, viewerFactionId: FactionId): Record<string, unknown> {
  const territories: Record<string, unknown> = {};
  for (const t of state.territories.values()) {
    territories[t.id] = publicTerritory(state, t);
  }
  const viewer = state.factions.get(viewerFactionId);
  return {
    turn: state.turn,
    worldTick: state.worldTick,
    viewerFactionId,
    definitionWorldId: state.definitionWorldId,
    worldLevel: state.worldLevel,
    worldName: state.worldName,
    knownFactions: viewer?.knownFactions ?? [...state.allFactionIds],
    territories,
    armies: visibleArmiesFor(state, viewerFactionId),
    currentWorldFullyVisible: true,
    worldCompletion: evaluateWorldCompletion(state),
    worldTransition: evaluateWorldTransition(state),
    levelAnchorTerritoryIds: [...state.levelAnchorTerritoryIds],
    levelDefeatStatus: state.levelDefeat.status,
    tutorial: serializeLevel1TutorialView(state),
  };
}
