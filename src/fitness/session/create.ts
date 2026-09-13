import { exerciseCatalogById, getWorkoutDefinition } from '../catalog';
import { isWorkoutDifficulty } from '../difficulty';
import { FitnessEstimate } from '../estimate/types';
import { clonePrescription, expectedPrescriptionKind } from '../guards';
import { personalizeWorkout } from '../personalization';
import { clonePrescribedWorkout, prescribeWorkoutBaseline, WorkoutPrescriptionResolver } from '../prescription';
import { isWorkoutPurpose } from '../purpose';
import {
  ExerciseDefinition,
  ExerciseId,
  PrescribedWorkout,
  WorkoutDefinition,
  WorkoutDifficulty,
  WorkoutPurpose,
} from '../types';
import { validateWorkoutDefinition } from '../validation';
import { cloneWorkoutSession } from './clone';
import { sessionErr, sessionOk, SessionOpResult } from './errors';
import { isFiniteTimestamp } from './timing';
import { rejectIfTerminal, rejectInvalidTransition } from './transitions';
import {
  ExercisePerformance,
  SessionPrescribedExercise,
  SessionPrescribedWorkout,
  WorkoutGameplayContext,
  WorkoutSession,
} from './types';

export interface CreateWorkoutSessionInput {
  playerId: string;
  purpose: WorkoutPurpose;
  intendedDifficulty: WorkoutDifficulty;
  workout?: WorkoutDefinition;
  workoutId?: string;
  prescribedWorkout?: PrescribedWorkout;
  /** When set and prescribedWorkout is omitted, personalize from the definition. */
  fitnessEstimate?: FitnessEstimate;
  prescriptionResolver?: WorkoutPrescriptionResolver;
  exercisesById?: ReadonlyMap<ExerciseId, ExerciseDefinition>;
  sessionId?: string;
  now: number;
  gameplayContext?: WorkoutGameplayContext;
}

function resolveWorkout(
  input: CreateWorkoutSessionInput,
): SessionOpResult<WorkoutDefinition> {
  if (input.workout) {
    return sessionOk(input.workout);
  }
  if (typeof input.workoutId !== 'string' || input.workoutId.trim() === '') {
    return sessionErr('session.invalid_workout', 'A workout or workoutId is required');
  }
  const found = getWorkoutDefinition(input.workoutId);
  if (!found) {
    return sessionErr('session.unknown_workout', `Unknown workout ${input.workoutId}`, {
      workoutId: input.workoutId,
    });
  }
  return sessionOk(found);
}

function snapshotPrescribed(
  prescribed: PrescribedWorkout,
  exercisesById: ReadonlyMap<ExerciseId, ExerciseDefinition>,
): SessionOpResult<SessionPrescribedWorkout> {
  if (prescribed.exercises.length === 0) {
    return sessionErr('session.invalid_prescription', 'Prescription must contain at least one exercise');
  }
  const exercises: SessionPrescribedExercise[] = [];
  for (let i = 0; i < prescribed.exercises.length; i++) {
    const step = prescribed.exercises[i]!;
    if (step.order !== i) {
      return sessionErr('session.invalid_prescription', 'Prescription exercise order must be 0..n-1', {
        order: step.order,
        index: i,
      });
    }
    const def = exercisesById.get(step.exerciseId);
    if (!def) {
      return sessionErr('session.invalid_prescription', `Prescription references unknown exercise ${step.exerciseId}`, {
        exerciseId: step.exerciseId,
      });
    }
    if (step.prescription.kind !== expectedPrescriptionKind(def.type)) {
      return sessionErr(
        'session.invalid_prescription',
        `${def.type} prescription must use ${expectedPrescriptionKind(def.type)}`,
        { exerciseId: step.exerciseId },
      );
    }
    if (step.skippable !== (def.type === 'REST')) {
      return sessionErr(
        'session.invalid_prescription',
        'Only REST exercises may be skippable in a session prescription',
        { exerciseId: step.exerciseId },
      );
    }
    exercises.push({
      exerciseId: step.exerciseId,
      order: step.order,
      exerciseType: def.type,
      isRest: def.isRest,
      bodySection: def.bodySection,
      prescription: clonePrescription(step.prescription),
      role: step.role,
      skippable: step.skippable,
    });
  }
  return sessionOk({
    workoutId: prescribed.workoutId,
    intendedDifficulty: prescribed.intendedDifficulty,
    exercises,
  });
}

function pendingPerformance(step: SessionPrescribedExercise): ExercisePerformance {
  return {
    exerciseId: step.exerciseId,
    order: step.order,
    exerciseType: step.exerciseType,
    prescribed: clonePrescription(step.prescription),
    actual: { kind: 'none' },
    status: 'PENDING',
    startedAt: null,
    completedAt: null,
    activeDurationMs: null,
  };
}

export function createWorkoutSession(input: CreateWorkoutSessionInput): SessionOpResult<WorkoutSession> {
  if (!isFiniteTimestamp(input.now)) {
    return sessionErr('session.invalid_timestamp', 'Session timestamp must be a finite number');
  }
  if (typeof input.playerId !== 'string' || input.playerId.trim() === '') {
    return sessionErr('session.invalid_player', 'playerId must be a non-empty string');
  }
  if (!isWorkoutDifficulty(input.intendedDifficulty)) {
    return sessionErr('session.invalid_difficulty', 'Intended difficulty is invalid');
  }
  if (!isWorkoutPurpose(input.purpose)) {
    return sessionErr('session.invalid_purpose', 'Workout purpose is invalid');
  }
  if (input.sessionId !== undefined && (typeof input.sessionId !== 'string' || input.sessionId.trim() === '')) {
    return sessionErr('session.invalid_session_id', 'sessionId must be a non-empty string when provided');
  }

  const workoutResult = resolveWorkout(input);
  if (!workoutResult.ok) return workoutResult;
  const workout = workoutResult.value;
  const exercisesById = input.exercisesById ?? exerciseCatalogById();
  const definitionIssues = validateWorkoutDefinition(workout, exercisesById);
  if (definitionIssues.length > 0) {
    return sessionErr('session.invalid_workout', definitionIssues[0]!.message, {
      workoutId: workout.id,
    });
  }

  const resolver = input.prescriptionResolver ?? { prescribe: prescribeWorkoutBaseline };
  let prescribed: PrescribedWorkout;
  if (input.prescribedWorkout) {
    prescribed = clonePrescribedWorkout(input.prescribedWorkout);
  } else if (input.fitnessEstimate) {
    const personalized = personalizeWorkout(workout, {
      playerId: input.playerId,
      fitnessEstimate: input.fitnessEstimate,
      desiredDifficulty: input.intendedDifficulty,
      purpose: input.purpose,
      exercisesById,
    });
    if (!personalized.ok) {
      return sessionErr('session.invalid_prescription', personalized.error.message, {
        reason: personalized.error.code,
      });
    }
    prescribed = personalized.value;
  } else {
    prescribed = resolver.prescribe(workout, {
      playerId: input.playerId,
      desiredDifficulty: input.intendedDifficulty,
      purpose: input.purpose,
    });
  }
  if (prescribed.workoutId !== workout.id) {
    return sessionErr('session.invalid_prescription', 'Prescription workoutId must match the workout', {
      workoutId: workout.id,
    });
  }
  if (prescribed.exercises.length !== workout.exercises.length) {
    return sessionErr('session.invalid_prescription', 'Prescription must include every workout exercise');
  }
  for (let i = 0; i < workout.exercises.length; i++) {
    if (prescribed.exercises[i]!.exerciseId !== workout.exercises[i]!.exerciseId) {
      return sessionErr('session.invalid_prescription', 'Prescription exercises must match the workout order');
    }
  }

  const snapshotResult = snapshotPrescribed(prescribed, exercisesById);
  if (!snapshotResult.ok) return snapshotResult;
  const snapshot = snapshotResult.value;

  const session: WorkoutSession = {
    sessionId: input.sessionId ?? `wses_${input.playerId.trim()}_${input.now}`,
    playerId: input.playerId.trim(),
    workoutId: workout.id,
    intendedDifficulty: input.intendedDifficulty,
    purpose: input.purpose,
    state: 'NOT_STARTED',
    prescribedWorkout: snapshot,
    currentExerciseIndex: null,
    performances: snapshot.exercises.map(pendingPerformance),
    createdAt: input.now,
    startedAt: null,
    completedAt: null,
    abandonedAt: null,
    abandonmentReason: null,
    pauseIntervals: [],
    pauseCount: 0,
    integrityFlags: [],
    feedbackState: 'NOT_APPLICABLE',
    feedback: null,
    ...(input.gameplayContext ? { gameplayContext: { ...input.gameplayContext } } : {}),
  };
  return sessionOk(session);
}

export function startWorkoutSession(session: WorkoutSession, now: number): SessionOpResult<WorkoutSession> {
  if (!isFiniteTimestamp(now)) {
    return sessionErr('session.invalid_timestamp', 'Session timestamp must be a finite number');
  }
  if (typeof session.sessionId !== 'string' || session.sessionId.trim() === '') {
    return sessionErr('session.invalid_session_id', 'Session id is invalid');
  }
  const terminal = rejectIfTerminal<WorkoutSession>(session);
  if (terminal) return terminal;
  const transition = rejectInvalidTransition<WorkoutSession>(session, 'ACTIVE');
  if (transition) return transition;

  const next = cloneWorkoutSession(session);
  next.state = 'ACTIVE';
  next.startedAt = now;
  next.currentExerciseIndex = 0;
  const first = next.performances[0];
  if (first) first.startedAt = now;
  return sessionOk(next);
}

export function beginWorkoutSession(input: CreateWorkoutSessionInput): SessionOpResult<WorkoutSession> {
  const created = createWorkoutSession(input);
  if (!created.ok) return created;
  return startWorkoutSession(created.value, input.now);
}
