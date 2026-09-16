/**
 * Level 1 tutorial/scenario controller.
 *
 * Sequences existing workout, banked-troop ATTACK, invasion, and completion
 * systems. Not a general narrative engine and not a second combat/AI/economy
 * implementation. Active only on the production Level 1 world when a player
 * faction is present.
 */
import { selectedWorkoutIdForPurpose } from '../../fitness/selection';
import { WorkoutPurpose } from '../../fitness/types';
import { Army, TerritoryId } from '../../types';
import {
  GameState,
  Level1TutorialBeat,
  Level1TutorialExpectedAction,
  Level1TutorialState,
  emptyLevel1TutorialState,
} from '../../types/GameState';
import { PRODUCTION_LEVEL_1_WORLD_ID } from '../../worldDefinition/worldConfig';
import { OrchestrationError, ErrorCode } from '../../orchestration/errors';
import { GameEvent, HandlerResult } from '../../orchestration/protocol';
import { MIN_ATTACKING_TROOPS, listImmediateAttackingArmies } from '../../army/strategicAttack';
import { emptyHandlerResult } from '../construction/handlerResult';
import {
  playerOwnedNonAnchorTerritoryIds,
} from '../anchors';
import { evaluateWorldCompletion } from '../completion';
import { beginInvasionAgainstPlayer } from '../invasion/create';
import { isOpenInvasion } from '../invasion/deadlines';
import { isPlayerEmpirePaused } from '../invasion/eligibility';

/** Authored Level 1 tile ids. Used only to decide whether this overlay applies. */
export const LEVEL1_TUTORIAL_TILE_IDS = ['t_01', 't_02', 't_03'] as const;

/**
 * Scripted raid size. Prototype defensePower is 1× physical output while troop
 * rewards are 10×; a full AI army would make the required short DEFENSE
 * workout unwinnable. Same cap the Level 1 production tests already used.
 */
export const LEVEL1_SCRIPTED_RAID_TROOPS = 8;

export interface Level1TutorialPublicView {
  active: boolean;
  beat: Level1TutorialBeat | null;
  expectedAction: Level1TutorialExpectedAction;
  expectedPurpose: WorkoutPurpose | null;
  expectedWorkoutId: string | null;
  nextActionAllowed: boolean;
  scriptedInvasionOccurred: boolean;
  scriptedInvasionId: string | null;
  scriptedInvasionTargetId: TerritoryId | null;
  firstAttackTerritoryIds: TerritoryId[];
  finalAttackTerritoryIds: TerritoryId[];
  defenseInvasionId: string | null;
  completed: boolean;
}

function emptyTutorialResult(): HandlerResult {
  return emptyHandlerResult();
}

export function isLevel1TutorialWorld(state: GameState): boolean {
  return state.definitionWorldId === PRODUCTION_LEVEL_1_WORLD_ID
    && state.worldLevel === 1
    && LEVEL1_TUTORIAL_TILE_IDS.every((id) => state.territories.has(id));
}

export function isLevel1TutorialApplicable(state: GameState): boolean {
  const playerId = state.playerFactionId;
  return isLevel1TutorialWorld(state)
    && !!playerId
    && state.factions.has(playerId);
}

export function isLevel1TutorialGating(state: GameState): boolean {
  const tut = state.level1Tutorial;
  return isLevel1TutorialApplicable(state)
    && !!tut
    && tut.active
    && !tut.completed
    && tut.beat !== 'COMPLETE';
}

export function isLevel1TutorialAiSuppressed(state: GameState, factionId: string): boolean {
  if (!isLevel1TutorialGating(state)) return false;
  if (state.playerFactionId && factionId === state.playerFactionId) return false;
  return true;
}

export function expectedActionForBeat(beat: Level1TutorialBeat | null | undefined): Level1TutorialExpectedAction {
  switch (beat) {
    case 'FIRST_WORKOUT_PENDING':
    case 'FINAL_WORKOUT_PENDING':
      return 'START_WORKOUT_NORMAL_TROOPS';
    case 'FIRST_ATTACK_AVAILABLE':
    case 'FINAL_ATTACK_AVAILABLE':
      return 'ATTACK';
    case 'DEFENSE_PENDING':
      return 'START_WORKOUT_DEFENSE';
    default:
      return 'NONE';
  }
}

/** Maps a tutorial beat to a WorkoutPurpose. Workout ids come from fitness selection. */
export function tutorialExpectedWorkoutPurpose(beat: Level1TutorialBeat | null | undefined): WorkoutPurpose | null {
  switch (beat) {
    case 'FIRST_WORKOUT_PENDING':
    case 'FINAL_WORKOUT_PENDING':
      return 'NORMAL_TROOPS';
    case 'DEFENSE_PENDING':
      return 'DEFENSE';
    default:
      return null;
  }
}

function tutorialExpectedWorkoutId(beat: Level1TutorialBeat | null | undefined): string | null {
  const purpose = tutorialExpectedWorkoutPurpose(beat);
  return purpose ? selectedWorkoutIdForPurpose(purpose) : null;
}

function troopWorkoutSessionIds(state: GameState): string[] {
  return state.playerFitness.compactHistory
    .filter((entry) => entry.purpose === 'NORMAL_TROOPS')
    .map((entry) => entry.sessionId);
}

function playerAdjacentTo(state: GameState, territoryId: TerritoryId): boolean {
  const playerId = state.playerFactionId;
  const tile = state.territories.get(territoryId);
  if (!playerId || !tile) return false;
  return tile.neighboring.some((neighborId) => state.territories.get(neighborId)?.owner === playerId);
}

function armyTroopCount(army: Army): number {
  return Math.max(0, army.soldiers) + Math.max(0, army.knights) + Math.max(0, army.siegeEngines);
}

function remainingAiArmiesAfterCapture(state: GameState, capturedId: TerritoryId): Army[] {
  const playerId = state.playerFactionId;
  return [...state.armies.values()].filter((army) => (
    army.owner !== playerId
    && army.location !== capturedId
    && armyTroopCount(army) > 0
  )).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function isValidFirstTutorialAttackTarget(state: GameState, territoryId: TerritoryId): boolean {
  const playerId = state.playerFactionId;
  const tile = state.territories.get(territoryId);
  if (!playerId || !tile || !tile.owner || tile.owner === playerId) return false;
  if (!playerAdjacentTo(state, territoryId)) return false;
  const remaining = remainingAiArmiesAfterCapture(state, territoryId);
  if (remaining.length === 0) return false;
  return remaining.some((army) => {
    const loc = state.territories.get(army.location);
    return !!loc && loc.neighboring.includes(territoryId);
  });
}

export function listFirstTutorialAttackTerritoryIds(state: GameState): TerritoryId[] {
  if (!state.playerFactionId) return [];
  return [...state.territories.values()]
    .map((tile) => tile.id)
    .filter((id) => isValidFirstTutorialAttackTarget(state, id))
    .sort();
}

export function listFinalTutorialAttackTerritoryIds(state: GameState): TerritoryId[] {
  const playerId = state.playerFactionId;
  if (!playerId) return [];
  return [...state.territories.values()]
    .filter((tile) => tile.owner && tile.owner !== playerId && playerAdjacentTo(state, tile.id))
    .map((tile) => tile.id)
    .sort();
}

export function selectScriptedInvasionTarget(state: GameState): TerritoryId | null {
  const playerId = state.playerFactionId;
  if (!playerId) return null;
  const nonAnchors = playerOwnedNonAnchorTerritoryIds(state);
  for (const territoryId of nonAnchors) {
    const tile = state.territories.get(territoryId);
    if (!tile) continue;
    const hasAdjacentAiArmy = [...state.armies.values()].some((army) => (
      army.owner !== playerId
      && armyTroopCount(army) > 0
      && tile.neighboring.includes(army.location)
    ));
    if (hasAdjacentAiArmy) return territoryId;
  }
  return nonAnchors[0] ?? null;
}

function selectScriptedAttacker(state: GameState, targetId: TerritoryId): string | null {
  const playerId = state.playerFactionId;
  const target = state.territories.get(targetId);
  if (!playerId || !target) return null;
  const armies = [...state.armies.values()]
    .filter((army) => (
      army.owner !== playerId
      && armyTroopCount(army) > 0
      && target.neighboring.includes(army.location)
    ))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return armies[0]?.owner ?? null;
}

function openInvasionAgainstPlayer(state: GameState) {
  const playerId = state.playerFactionId;
  if (!playerId) return undefined;
  return [...state.activeInvasions.values()]
    .filter((invasion) => invasion.defenderFactionId === playerId && isOpenInvasion(invasion))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

function computeBeat(state: GameState, tut: Level1TutorialState): Level1TutorialBeat {
  if (tut.completed) return 'COMPLETE';
  if (evaluateWorldCompletion(state)?.complete) return 'COMPLETE';
  if (tut.secondWorkoutSessionId) return 'FINAL_ATTACK_AVAILABLE';
  if (tut.defenseResolved) return 'FINAL_WORKOUT_PENDING';
  if (tut.scriptedInvasionId) {
    const invasion = state.activeInvasions.get(tut.scriptedInvasionId);
    if (invasion && isOpenInvasion(invasion)) return 'DEFENSE_PENDING';
    return 'FINAL_WORKOUT_PENDING';
  }
  if (tut.firstConquestTerritoryId) return 'SCRIPTED_ATTACK_PENDING';
  if (tut.firstWorkoutSessionId) return 'FIRST_ATTACK_AVAILABLE';
  return 'FIRST_WORKOUT_PENDING';
}

function nextActionAllowed(state: GameState, viewBeat: Level1TutorialBeat | null): boolean {
  const expected = expectedActionForBeat(viewBeat);
  const active = state.playerFitness.activeSession;
  const busy = !!active && active.state !== 'COMPLETED' && active.state !== 'ABANDONED';
  if (expected === 'START_WORKOUT_NORMAL_TROOPS') return !busy;
  if (expected === 'START_WORKOUT_DEFENSE') {
    const invasionId = state.level1Tutorial?.scriptedInvasionId;
    const invasion = invasionId ? state.activeInvasions.get(invasionId) : undefined;
    return !!invasion && isOpenInvasion(invasion) && invasion.status === 'pending_response' && !busy;
  }
  if (expected === 'ATTACK') {
    return state.playerRewards.bankedTroops > MIN_ATTACKING_TROOPS;
  }
  return false;
}

export function serializeLevel1TutorialView(state: GameState): Level1TutorialPublicView {
  const tut = state.level1Tutorial;
  if (!tut) {
    return {
      active: false,
      beat: null,
      expectedAction: 'NONE',
      expectedPurpose: null,
      expectedWorkoutId: null,
      nextActionAllowed: false,
      scriptedInvasionOccurred: false,
      scriptedInvasionId: null,
      scriptedInvasionTargetId: null,
      firstAttackTerritoryIds: [],
      finalAttackTerritoryIds: [],
      defenseInvasionId: null,
      completed: false,
    };
  }
  const beat = tut.beat;
  const defenseOpen = tut.scriptedInvasionId
    ? state.activeInvasions.get(tut.scriptedInvasionId)
    : undefined;
  return {
    active: tut.active && !tut.completed,
    beat,
    expectedAction: expectedActionForBeat(beat),
    expectedPurpose: tutorialExpectedWorkoutPurpose(beat),
    expectedWorkoutId: tutorialExpectedWorkoutId(beat),
    nextActionAllowed: nextActionAllowed(state, beat),
    scriptedInvasionOccurred: tut.scriptedInvasionId !== null,
    scriptedInvasionId: tut.scriptedInvasionId,
    scriptedInvasionTargetId: tut.scriptedInvasionTargetId,
    firstAttackTerritoryIds: beat === 'FIRST_ATTACK_AVAILABLE' ? listFirstTutorialAttackTerritoryIds(state) : [],
    finalAttackTerritoryIds: beat === 'FINAL_ATTACK_AVAILABLE' ? listFinalTutorialAttackTerritoryIds(state) : [],
    defenseInvasionId: defenseOpen && isOpenInvasion(defenseOpen) ? defenseOpen.id : null,
    completed: tut.completed || beat === 'COMPLETE',
  };
}

function beatChangedEvent(state: GameState, fromBeat: Level1TutorialBeat, toBeat: Level1TutorialBeat): GameEvent {
  return {
    kind: 'world',
    id: `tutorial_beat_${toBeat}_${state.worldTick}`,
    title: 'Level 1 tutorial',
    summary: `Tutorial beat ${fromBeat} → ${toBeat}`,
    factionId: state.playerFactionId,
    data: {
      tutorialProgression: 'beat_changed',
      fromBeat,
      toBeat,
      beat: toBeat,
    },
  };
}

function scriptedInvasionEvent(state: GameState, invasionId: string, territoryId: TerritoryId): GameEvent {
  return {
    kind: 'world',
    id: `tutorial_invasion_${invasionId}`,
    title: 'Level 1 scripted attack',
    summary: `Scripted invasion ${invasionId} targets ${territoryId}`,
    territoryId,
    factionId: state.playerFactionId,
    data: {
      tutorialProgression: 'scripted_invasion',
      invasionId,
      territoryId,
      raidTroops: LEVEL1_SCRIPTED_RAID_TROOPS,
    },
  };
}

function capRaidArmy(state: GameState, armyId: string): void {
  const army = state.armies.get(armyId);
  if (!army) return;
  army.soldiers = LEVEL1_SCRIPTED_RAID_TROOPS;
  army.knights = 0;
  army.siegeEngines = 0;
}

function tryFireScriptedInvasion(state: GameState, tut: Level1TutorialState): HandlerResult {
  if (tut.scriptedInvasionId) return emptyTutorialResult();
  if (isPlayerEmpirePaused(state)) return emptyTutorialResult();
  const targetId = selectScriptedInvasionTarget(state);
  if (!targetId) return emptyTutorialResult();
  const attackerId = selectScriptedAttacker(state, targetId);
  if (!attackerId) return emptyTutorialResult();
  const armies = listImmediateAttackingArmies(state, attackerId, targetId);
  if (armies.length === 0) return emptyTutorialResult();
  const raid = armies[0]!;
  const inner = beginInvasionAgainstPlayer(state, {
    attackerId,
    territoryId: targetId,
    armies: [raid],
    bypassPlayerDefenseGates: true,
  });
  capRaidArmy(state, raid.id);
  const invasionId = typeof inner.payload.invasionId === 'string' ? inner.payload.invasionId : null;
  if (!invasionId) return inner;
  tut.scriptedInvasionId = invasionId;
  tut.scriptedInvasionTargetId = targetId;
  return {
    ...inner,
    events: [...inner.events, scriptedInvasionEvent(state, invasionId, targetId)],
    payload: {
      scriptedInvasionId: invasionId,
      scriptedInvasionTargetId: targetId,
    },
  };
}

function deriveMissingTutorial(state: GameState): Level1TutorialState {
  const tut = emptyLevel1TutorialState();
  if (evaluateWorldCompletion(state)?.complete) {
    tut.active = false;
    tut.completed = true;
    tut.beat = 'COMPLETE';
    return tut;
  }
  const troops = troopWorkoutSessionIds(state);
  if (troops[0]) tut.firstWorkoutSessionId = troops[0]!;
  const nonAnchor = playerOwnedNonAnchorTerritoryIds(state)[0];
  if (nonAnchor) tut.firstConquestTerritoryId = nonAnchor;
  const open = openInvasionAgainstPlayer(state);
  if (open) {
    tut.scriptedInvasionId = open.id;
    tut.scriptedInvasionTargetId = open.territoryId;
  }
  if (tut.scriptedInvasionId && !open) {
    tut.defenseResolved = true;
  }
  if (tut.defenseResolved && troops[1] && troops[1] !== tut.firstWorkoutSessionId) {
    tut.secondWorkoutSessionId = troops[1]!;
  } else if (tut.firstWorkoutSessionId && troops.length > 1) {
    const second = troops.find((id) => id !== tut.firstWorkoutSessionId);
    if (second && (tut.defenseResolved || tut.scriptedInvasionId)) {
      tut.secondWorkoutSessionId = second;
    }
  }
  tut.beat = computeBeat(state, tut);
  if (tut.beat === 'COMPLETE') {
    tut.completed = true;
    tut.active = false;
  }
  return tut;
}

/**
 * Attach or reconstruct the overlay. Does not fire invasions (hydrate-safe).
 */
export function bindLevel1Tutorial(state: GameState): void {
  if (!isLevel1TutorialApplicable(state)) {
    if (!state.level1Tutorial) state.level1Tutorial = null;
    return;
  }
  if (!state.level1Tutorial) {
    state.level1Tutorial = deriveMissingTutorial(state);
  }
}

function stampProgress(state: GameState, tut: Level1TutorialState): void {
  const troops = troopWorkoutSessionIds(state);
  if (!tut.firstWorkoutSessionId && troops[0]) {
    tut.firstWorkoutSessionId = troops[0]!;
  }
  if (!tut.firstConquestTerritoryId) {
    const gained = playerOwnedNonAnchorTerritoryIds(state)[0];
    if (gained) tut.firstConquestTerritoryId = gained;
  }
  if (tut.scriptedInvasionId) {
    const invasion = state.activeInvasions.get(tut.scriptedInvasionId);
    if (!invasion || !isOpenInvasion(invasion)) {
      tut.defenseResolved = true;
    }
  }
  if (tut.defenseResolved && !tut.secondWorkoutSessionId) {
    const second = troops.find((id) => id !== tut.firstWorkoutSessionId);
    if (second) tut.secondWorkoutSessionId = second;
  }
  if (evaluateWorldCompletion(state)?.complete) {
    tut.completed = true;
    tut.active = false;
  }
}

/**
 * Idempotent tutorial step. Safe to call after every mutating command and
 * inside ADVANCE_WORLD catch-up chunks. Fires the scripted invasion at most
 * once (`scriptedInvasionId`).
 */
export function syncLevel1Tutorial(state: GameState): HandlerResult {
  bindLevel1Tutorial(state);
  if (!isLevel1TutorialApplicable(state)) return emptyTutorialResult();
  const tut = state.level1Tutorial;
  if (!tut) return emptyTutorialResult();

  const fromBeat = tut.beat;
  stampProgress(state, tut);

  let fired = emptyTutorialResult();
  const pendingBeat = computeBeat(state, tut);
  if (
    tut.active
    && !tut.completed
    && !tut.scriptedInvasionId
    && (pendingBeat === 'SCRIPTED_ATTACK_PENDING' || !!tut.firstConquestTerritoryId)
    && !tut.defenseResolved
  ) {
    try {
      fired = tryFireScriptedInvasion(state, tut);
      stampProgress(state, tut);
    } catch (err) {
      if (!(err instanceof OrchestrationError)) throw err;
      fired = emptyTutorialResult();
    }
  }

  tut.beat = computeBeat(state, tut);
  if (tut.beat === 'COMPLETE') {
    tut.completed = true;
    tut.active = false;
  }

  const events: GameEvent[] = [...fired.events];
  const beatChanged = fromBeat !== tut.beat;
  if (beatChanged) {
    events.push(beatChangedEvent(state, fromBeat, tut.beat));
  }
  const view = serializeLevel1TutorialView(state);
  const stateChanges = [...fired.stateChanges];
  if (beatChanged) {
    stateChanges.push({
      entity: 'world',
      id: 'level1Tutorial',
      summary: `Level 1 tutorial ${tut.beat}`,
    });
  }
  return {
    ...emptyTutorialResult(),
    stateChanges,
    events,
    notifications: fired.notifications,
    newlyAvailableActions: [],
    payload: {
      tutorial: view,
      ...(typeof fired.payload.scriptedInvasionId === 'string'
        ? {
          scriptedInvasionId: fired.payload.scriptedInvasionId,
          scriptedInvasionTargetId: fired.payload.scriptedInvasionTargetId,
        }
        : {}),
    },
  };
}

export function applyLevel1TutorialToHandlerResult(state: GameState, result: HandlerResult): HandlerResult {
  const extra = syncLevel1Tutorial(state);
  const tutorial = serializeLevel1TutorialView(state);
  return {
    ...result,
    stateChanges: [...result.stateChanges, ...extra.stateChanges],
    events: [...result.events, ...extra.events],
    notifications: [...result.notifications, ...extra.notifications],
    newlyAvailableActions: result.newlyAvailableActions,
    payload: {
      ...result.payload,
      tutorial,
      ...(typeof extra.payload.scriptedInvasionId === 'string'
        ? {
          scriptedInvasionId: extra.payload.scriptedInvasionId,
          scriptedInvasionTargetId: extra.payload.scriptedInvasionTargetId,
        }
        : {}),
    },
  };
}

export function assertLevel1TutorialPlayerAttackAllowed(
  state: GameState,
  attackerId: string,
  territoryId: TerritoryId,
  commitAmount: number | undefined,
): void {
  if (!isLevel1TutorialGating(state)) return;
  if (state.playerFactionId && attackerId !== state.playerFactionId) return;
  const beat = state.level1Tutorial!.beat;
  if (beat !== 'FIRST_ATTACK_AVAILABLE' && beat !== 'FINAL_ATTACK_AVAILABLE') {
    throw new OrchestrationError(
      ErrorCode.ACTION_NOT_ALLOWED,
      `Level 1 tutorial does not allow ATTACK during ${beat}`,
      { tutorialBeat: beat, expectedAction: expectedActionForBeat(beat) },
    );
  }
  if (commitAmount === undefined) {
    throw new OrchestrationError(
      ErrorCode.MISSING_PARAMETER,
      'Level 1 tutorial attacks require commitAmount',
      { tutorialBeat: beat },
    );
  }
  if (beat === 'FIRST_ATTACK_AVAILABLE' && !isValidFirstTutorialAttackTarget(state, territoryId)) {
    throw new OrchestrationError(
      ErrorCode.INVALID_TARGET,
      'Level 1 first attack must leave an AI army able to stage the scripted raid',
      {
        tutorialBeat: beat,
        territoryId,
        allowedTerritoryIds: listFirstTutorialAttackTerritoryIds(state),
      },
    );
  }
}

export function assertLevel1TutorialWorkoutAllowed(state: GameState, purpose: string): void {
  if (!isLevel1TutorialGating(state)) return;
  const beat = state.level1Tutorial!.beat;
  if (purpose === 'DEFENSE') {
    if (beat !== 'DEFENSE_PENDING') {
      throw new OrchestrationError(
        ErrorCode.ACTION_NOT_ALLOWED,
        `Level 1 tutorial does not allow DEFENSE during ${beat}`,
        { tutorialBeat: beat, expectedAction: expectedActionForBeat(beat) },
      );
    }
    return;
  }
  if (purpose === 'NORMAL_TROOPS') {
    if (beat !== 'FIRST_WORKOUT_PENDING' && beat !== 'FINAL_WORKOUT_PENDING') {
      throw new OrchestrationError(
        ErrorCode.ACTION_NOT_ALLOWED,
        `Level 1 tutorial does not allow a troops workout during ${beat}`,
        { tutorialBeat: beat, expectedAction: expectedActionForBeat(beat) },
      );
    }
  }
}

/**
 * Level 1's first onboarding workout is intentionally short and skips the
 * normal post-workout feedback screen. Later Level 1 workouts still require
 * SUBMIT_WORKOUT_FEEDBACK.
 */
export function shouldWaiveWorkoutFeedback(
  state: GameState,
  session: { purpose: string; sessionId: string },
): boolean {
  if (!isLevel1TutorialGating(state)) return false;
  const tut = state.level1Tutorial;
  if (!tut || tut.beat !== 'FIRST_WORKOUT_PENDING') return false;
  if (session.purpose !== 'NORMAL_TROOPS') return false;
  if (tut.firstWorkoutSessionId && tut.firstWorkoutSessionId !== session.sessionId) return false;
  return true;
}

export function coerceLevel1TutorialState(raw: unknown): Level1TutorialState | null {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const base = emptyLevel1TutorialState();
  const beat = typeof rec.beat === 'string' ? rec.beat : base.beat;
  return {
    active: rec.active === false ? false : true,
    beat: (
      beat === 'FIRST_WORKOUT_PENDING'
      || beat === 'FIRST_ATTACK_AVAILABLE'
      || beat === 'SCRIPTED_ATTACK_PENDING'
      || beat === 'DEFENSE_PENDING'
      || beat === 'FINAL_WORKOUT_PENDING'
      || beat === 'FINAL_ATTACK_AVAILABLE'
      || beat === 'COMPLETE'
    ) ? beat : base.beat,
    firstWorkoutSessionId: typeof rec.firstWorkoutSessionId === 'string' ? rec.firstWorkoutSessionId : null,
    firstConquestTerritoryId: typeof rec.firstConquestTerritoryId === 'string' ? rec.firstConquestTerritoryId : null,
    scriptedInvasionId: typeof rec.scriptedInvasionId === 'string' ? rec.scriptedInvasionId : null,
    scriptedInvasionTargetId: typeof rec.scriptedInvasionTargetId === 'string' ? rec.scriptedInvasionTargetId : null,
    defenseResolved: rec.defenseResolved === true,
    secondWorkoutSessionId: typeof rec.secondWorkoutSessionId === 'string' ? rec.secondWorkoutSessionId : null,
    completed: rec.completed === true,
  };
}
