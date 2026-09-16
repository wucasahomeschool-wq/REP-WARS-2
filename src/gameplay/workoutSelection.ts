/**
 * Gameplay-facing workout selection: purpose + tutorial context → catalog id
 * and a prescribed snapshot. Does not mutate GameState. Personalization stays
 * in the fitness pipeline.
 */
import { getWorkoutDefinition } from '../fitness/catalog';
import { isWorkoutDifficulty } from '../fitness/difficulty';
import { personalizeWorkout } from '../fitness/personalization';
import { clonePrescribedWorkout, prescribeWorkoutBaseline } from '../fitness/prescription';
import { selectedWorkoutIdForPurpose } from '../fitness/selection';
import { WorkoutDefinition, WorkoutDifficulty, WorkoutPurpose } from '../fitness/types';
import { GameState, Level1TutorialBeat } from '../types/GameState';
import { OrchestrationError, ErrorCode } from '../orchestration/errors';
import { isDeadlineElapsed, isOpenInvasion } from './invasion/deadlines';
import { playerFacingTick } from './invasion/eligibility';
import {
  assertLevel1TutorialWorkoutAllowed,
  expectedActionForBeat,
  isLevel1TutorialGating,
  tutorialExpectedWorkoutPurpose,
} from './tutorial/level1';

export type WorkoutSelectionSource = 'tutorial' | 'purpose';

export interface WorkoutSelectionConstraints {
  requiresInvasionId: boolean;
  workoutIdMustMatchSelection: boolean;
}

export interface PublicPrescribedWorkout {
  workoutId: string;
  intendedDifficulty: WorkoutDifficulty;
  personalized: boolean;
  exercises: WorkoutDefinition['exercises'];
}

export interface WorkoutSelectionView {
  purpose: WorkoutPurpose;
  selectedWorkoutId: string;
  workout: WorkoutDefinition;
  prescribedWorkout: PublicPrescribedWorkout;
  source: WorkoutSelectionSource;
  tutorialBeat: Level1TutorialBeat | null;
  expectedAction: ReturnType<typeof expectedActionForBeat>;
  allowed: boolean;
  recommendedInvasionId: string | null;
  constraints: WorkoutSelectionConstraints;
}

function sessionBusy(state: GameState): boolean {
  const active = state.playerFitness.activeSession;
  return !!active && active.state !== 'COMPLETED' && active.state !== 'ABANDONED';
}

export function recommendedDefenseInvasionId(state: GameState): string | null {
  if (isLevel1TutorialGating(state)) {
    const id = state.level1Tutorial?.scriptedInvasionId;
    if (!id) return null;
    const invasion = state.activeInvasions.get(id);
    if (
      invasion
      && isOpenInvasion(invasion)
      && invasion.status === 'pending_response'
      && !invasion.defenseMobilization
      && invasion.defenseWorkoutStartedAtTick === null
      && invasion.defenseSessionId === null
    ) {
      return id;
    }
    return null;
  }
  const playerId = state.playerFactionId;
  if (!playerId) return null;
  const nowTick = playerFacingTick(state);
  return [...state.activeInvasions.values()]
    .filter((invasion) => (
      invasion.defenderFactionId === playerId
      && isOpenInvasion(invasion)
      && invasion.status === 'pending_response'
      && !invasion.defenseMobilization
      && invasion.defenseWorkoutStartedAtTick === null
      && invasion.defenseSessionId === null
      && !isDeadlineElapsed(nowTick, invasion.responseDeadlineTick)
    ))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]?.id ?? null;
}

export function isWorkoutStartAllowed(state: GameState, purpose: WorkoutPurpose): boolean {
  try {
    assertLevel1TutorialWorkoutAllowed(state, purpose);
  } catch {
    return false;
  }
  if (sessionBusy(state)) return false;
  if (purpose === 'DEFENSE') {
    return recommendedDefenseInvasionId(state) !== null;
  }
  return true;
}

export function resolveStartWorkoutId(
  state: GameState,
  purpose: WorkoutPurpose,
  requestedWorkoutId: string | undefined,
): string {
  const selectedWorkoutId = selectedWorkoutIdForPurpose(purpose);
  if (!getWorkoutDefinition(selectedWorkoutId)) {
    throw new OrchestrationError(
      ErrorCode.INVALID_GAME_STATE,
      `Authoritative workout ${selectedWorkoutId} is missing from the catalog`,
      { purpose, selectedWorkoutId },
    );
  }
  if (!requestedWorkoutId) return selectedWorkoutId;
  if (!getWorkoutDefinition(requestedWorkoutId)) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, `Unknown workout ${requestedWorkoutId}`);
  }
  if (isLevel1TutorialGating(state) && requestedWorkoutId !== selectedWorkoutId) {
    throw new OrchestrationError(
      ErrorCode.INVALID_PARAMETER,
      `Level 1 tutorial requires workout ${selectedWorkoutId}`,
      {
        selectedWorkoutId,
        requestedWorkoutId,
        tutorialBeat: state.level1Tutorial?.beat ?? null,
      },
    );
  }
  return requestedWorkoutId;
}

function prescribeForSelection(
  definition: WorkoutDefinition,
  playerId: string,
  purpose: WorkoutPurpose,
  intendedDifficulty: WorkoutDifficulty,
  state: GameState,
): PublicPrescribedWorkout {
  const estimate = state.playerFitness.estimate;
  if (estimate) {
    const personalized = personalizeWorkout(definition, {
      playerId,
      fitnessEstimate: estimate,
      desiredDifficulty: intendedDifficulty,
      purpose,
    });
    if (!personalized.ok) {
      throw new OrchestrationError(
        ErrorCode.INVALID_GAME_STATE,
        personalized.error.message,
        { reason: personalized.error.code },
      );
    }
    const clone = clonePrescribedWorkout(personalized.value);
    return {
      workoutId: clone.workoutId,
      intendedDifficulty: clone.intendedDifficulty,
      personalized: clone.personalization?.applied === true,
      exercises: clone.exercises,
    };
  }
  const baseline = prescribeWorkoutBaseline(definition, {
    playerId,
    desiredDifficulty: intendedDifficulty,
    purpose,
  });
  return {
    workoutId: baseline.workoutId,
    intendedDifficulty: baseline.intendedDifficulty,
    personalized: false,
    exercises: baseline.exercises,
  };
}

export function serializeWorkoutSelectionView(
  state: GameState,
  playerId: string,
  purpose: WorkoutPurpose,
  intendedDifficultyRaw?: string,
): WorkoutSelectionView {
  const selectedWorkoutId = selectedWorkoutIdForPurpose(purpose);
  const workout = getWorkoutDefinition(selectedWorkoutId);
  if (!workout) {
    throw new OrchestrationError(
      ErrorCode.INVALID_GAME_STATE,
      `Authoritative workout ${selectedWorkoutId} is missing from the catalog`,
      { purpose, selectedWorkoutId },
    );
  }
  const intendedDifficulty = intendedDifficultyRaw ?? workout.intendedDifficulty;
  if (!isWorkoutDifficulty(intendedDifficulty)) {
    throw new OrchestrationError(ErrorCode.INVALID_PARAMETER, 'intendedDifficulty is invalid');
  }
  const tutorialBeat = state.level1Tutorial?.beat ?? null;
  const expectedPurpose = tutorialExpectedWorkoutPurpose(tutorialBeat);
  const source: WorkoutSelectionSource = (
    isLevel1TutorialGating(state) && expectedPurpose === purpose
  ) ? 'tutorial' : 'purpose';
  return {
    purpose,
    selectedWorkoutId,
    workout,
    prescribedWorkout: prescribeForSelection(
      workout,
      playerId,
      purpose,
      intendedDifficulty,
      state,
    ),
    source,
    tutorialBeat,
    expectedAction: expectedActionForBeat(tutorialBeat),
    allowed: isWorkoutStartAllowed(state, purpose),
    recommendedInvasionId: purpose === 'DEFENSE' ? recommendedDefenseInvasionId(state) : null,
    constraints: {
      requiresInvasionId: purpose === 'DEFENSE',
      workoutIdMustMatchSelection: isLevel1TutorialGating(state),
    },
  };
}
