import { isWorkoutDifficulty } from '../difficulty';
import { isBodySection, isExerciseType, isRecord } from '../guards';
import { isWorkoutPurpose } from '../purpose';
import { isWorkoutFeedbackValue } from '../session/feedback';
import { EXERCISE_PERFORMANCE_STATUSES, WORKOUT_FEEDBACK_STATES, WORKOUT_SESSION_STATES } from '../session/types';
import { FitnessEvaluationIssue } from './types';

function issue(code: string, message: string): FitnessEvaluationIssue {
  return { code, message };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isNonNegativeNumber(value) && Number.isInteger(value);
}

function isPerformanceStatus(value: unknown): boolean {
  return typeof value === 'string' && (EXERCISE_PERFORMANCE_STATUSES as readonly string[]).includes(value);
}

function validatePrescription(raw: unknown, path: string): FitnessEvaluationIssue[] {
  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    return [issue('evaluation.invalid_exercise', `${path} prescription is invalid`)];
  }
  if (raw.kind === 'repetitions') {
    if (!isNonNegativeInteger(raw.repetitions) || raw.repetitions <= 0) {
      return [issue('evaluation.invalid_values', `${path} prescribed repetitions must be a positive integer`)];
    }
    return [];
  }
  if (raw.kind === 'duration') {
    if (!isNonNegativeNumber(raw.durationSeconds) || raw.durationSeconds <= 0) {
      return [issue('evaluation.invalid_values', `${path} prescribed duration must be a positive number`)];
    }
    return [];
  }
  return [issue('evaluation.invalid_exercise', `${path} prescription kind is invalid`)];
}

function validateActual(raw: unknown, path: string): FitnessEvaluationIssue[] {
  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    return [issue('evaluation.invalid_exercise', `${path} actual performance is invalid`)];
  }
  if (raw.kind === 'none' || raw.kind === 'skipped_rest') return [];
  if (raw.kind === 'repetitions') {
    if (!isNonNegativeInteger(raw.completedRepetitions)) {
      return [issue('evaluation.invalid_values', `${path} completed repetitions cannot be negative`)];
    }
    return [];
  }
  if (raw.kind === 'duration') {
    if (!isNonNegativeNumber(raw.completedDurationSeconds)) {
      return [issue('evaluation.invalid_values', `${path} completed duration cannot be negative`)];
    }
    return [];
  }
  return [issue('evaluation.invalid_exercise', `${path} actual kind is invalid`)];
}

export function validateCompletedWorkoutRecord(raw: unknown): FitnessEvaluationIssue[] {
  const issues: FitnessEvaluationIssue[] = [];
  if (!isRecord(raw)) {
    return [issue('evaluation.malformed_record', 'Completed workout record must be an object')];
  }
  if (raw.kind !== 'completed_workout_record') {
    issues.push(issue('evaluation.malformed_record', 'Record kind must be completed_workout_record'));
  }
  if (typeof raw.playerId !== 'string' || raw.playerId.trim() === '') {
    issues.push(issue('evaluation.invalid_ids', 'playerId must be a non-empty string'));
  }
  if (typeof raw.sessionId !== 'string' || raw.sessionId.trim() === '') {
    issues.push(issue('evaluation.invalid_ids', 'sessionId must be a non-empty string'));
  }
  if (typeof raw.workoutId !== 'string' || raw.workoutId.trim() === '') {
    issues.push(issue('evaluation.invalid_ids', 'workoutId must be a non-empty string'));
  }
  if (!isWorkoutDifficulty(raw.intendedDifficulty)) {
    issues.push(issue('evaluation.invalid_difficulty', 'intendedDifficulty is invalid'));
  }
  if (!isWorkoutPurpose(raw.purpose)) {
    issues.push(issue('evaluation.malformed_record', 'purpose is invalid'));
  }
  if (!isFiniteNumber(raw.completedAt) || raw.completedAt < 0) {
    issues.push(issue('evaluation.invalid_timestamp', 'completedAt must be a finite non-negative timestamp'));
  }
  if (typeof raw.eligibleForFitnessEvaluation !== 'boolean') {
    issues.push(issue('evaluation.malformed_record', 'eligibleForFitnessEvaluation must be a boolean'));
  }
  if (typeof raw.feedbackState !== 'string' || !(WORKOUT_FEEDBACK_STATES as readonly string[]).includes(raw.feedbackState)) {
    issues.push(issue('evaluation.malformed_record', 'feedbackState is invalid'));
  }
  if (raw.feedback !== null && raw.feedback !== undefined) {
    if (!isRecord(raw.feedback)) {
      issues.push(issue('evaluation.invalid_feedback', 'feedback must be an object or null'));
    } else {
      if (!isWorkoutFeedbackValue(raw.feedback.value)) {
        issues.push(issue('evaluation.invalid_feedback', 'feedback value is invalid'));
      }
      if (!isWorkoutDifficulty(raw.feedback.intendedDifficulty)) {
        issues.push(issue('evaluation.invalid_difficulty', 'feedback intendedDifficulty is invalid'));
      }
      if (!isFiniteNumber(raw.feedback.submittedAt) || raw.feedback.submittedAt < 0) {
        issues.push(issue('evaluation.invalid_timestamp', 'feedback submittedAt is invalid'));
      }
    }
  }
  if (!isRecord(raw.summary)) {
    issues.push(issue('evaluation.malformed_record', 'summary must be an object'));
    return issues;
  }
  const summary = raw.summary;
  if (typeof summary.state !== 'string' || !(WORKOUT_SESSION_STATES as readonly string[]).includes(summary.state)) {
    issues.push(issue('evaluation.malformed_record', 'summary.state is invalid'));
  }
  for (const countKey of [
    'exerciseCount',
    'completedExerciseCount',
    'skippedRestCount',
    'mandatoryIncompleteCount',
    'flagCount',
    'pauseCount',
    'totalPausedMs',
    'totalActiveDurationMs',
  ] as const) {
    if (!isNonNegativeNumber(summary[countKey])) {
      issues.push(issue('evaluation.invalid_values', `summary.${countKey} cannot be negative`));
    }
  }
  if (!Array.isArray(summary.exercises) || summary.exercises.length === 0) {
    issues.push(issue('evaluation.invalid_exercise', 'summary must include at least one exercise'));
    return issues;
  }
  summary.exercises.forEach((step, index) => {
    const path = `exercises[${index}]`;
    if (!isRecord(step)) {
      issues.push(issue('evaluation.invalid_exercise', `${path} must be an object`));
      return;
    }
    if (typeof step.exerciseId !== 'string' || step.exerciseId.trim() === '') {
      issues.push(issue('evaluation.invalid_ids', `${path} exerciseId is invalid`));
    }
    if (!Number.isInteger(step.order) || (step.order as number) < 0) {
      issues.push(issue('evaluation.invalid_exercise', `${path} order is invalid`));
    }
    if (!isExerciseType(step.exerciseType)) {
      issues.push(issue('evaluation.invalid_exercise', `${path} exerciseType is invalid`));
    }
    if (step.bodySection !== undefined && !isBodySection(step.bodySection)) {
      issues.push(issue('evaluation.invalid_exercise', `${path} bodySection is invalid`));
    }
    if (!isPerformanceStatus(step.status)) {
      issues.push(issue('evaluation.invalid_exercise', `${path} status is invalid`));
    }
    issues.push(...validatePrescription(step.prescribed, path));
    issues.push(...validateActual(step.actual, path));
    if (step.activeDurationMs !== null && step.activeDurationMs !== undefined && !isNonNegativeNumber(step.activeDurationMs)) {
      issues.push(issue('evaluation.invalid_values', `${path} activeDurationMs cannot be negative`));
    }
    if (isRecord(step.prescribed) && isRecord(step.actual)) {
      if (step.prescribed.kind === 'repetitions' && step.actual.kind === 'duration') {
        issues.push(issue('evaluation.invalid_exercise', `${path} cannot mix repetition prescription with duration actual`));
      }
      if (step.prescribed.kind === 'duration' && step.actual.kind === 'repetitions') {
        issues.push(issue('evaluation.invalid_exercise', `${path} cannot mix duration prescription with repetition actual`));
      }
    }
  });
  return issues;
}

export function isEligibleCompletedWorkoutRecord(raw: unknown): boolean {
  if (!isRecord(raw) || !isRecord(raw.summary)) return false;
  const feedbackSubmitted = raw.feedbackState === 'FEEDBACK_SUBMITTED' && raw.feedback !== null;
  const feedbackWaived = raw.feedbackState === 'NOT_APPLICABLE' && (raw.feedback === null || raw.feedback === undefined);
  return (
    raw.kind === 'completed_workout_record'
    && raw.eligibleForFitnessEvaluation === true
    && (feedbackSubmitted || feedbackWaived)
    && raw.summary.state === 'COMPLETED'
    && raw.summary.abandonedAt === null
    && raw.summary.abandonmentReason === null
  );
}
