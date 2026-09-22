import { RuntimeWorkout, RuntimeWorkoutCatalog } from '../authoring/compile';
import { WorkoutSession } from '../session/types';
import { ProgressionDecision, ProgressionEvidenceEntry } from './types';

function prescribedAmount(kind: WorkoutSession['performances'][number]['prescribed']): number {
  return kind.kind === 'repetitions' ? kind.repetitions : kind.durationSeconds;
}

function actualAmount(actual: WorkoutSession['performances'][number]['actual']): number {
  if (actual.kind === 'repetitions') return actual.completedRepetitions;
  if (actual.kind === 'duration') return actual.completedDurationSeconds;
  return 0;
}

export function sessionCompletionRatio(session: WorkoutSession): number {
  const skippable = new Set(
    session.prescribedWorkout.exercises.filter((step) => step.skippable).map((step) => step.order),
  );
  const mandatory = session.performances.filter((row) => !skippable.has(row.order) && row.exerciseType !== 'REST');
  const rows = mandatory.length > 0 ? mandatory : session.performances.filter((row) => row.exerciseType !== 'REST');
  if (rows.length === 0) return session.state === 'COMPLETED' ? 1 : 0;
  let total = 0;
  for (const row of rows) {
    const prescribed = prescribedAmount(row.prescribed);
    if (prescribed <= 0) {
      total += row.status === 'COMPLETED' ? 1 : 0;
      continue;
    }
    total += Math.max(0, Math.min(1, actualAmount(row.actual) / prescribed));
  }
  return total / rows.length;
}

export function sessionIsAuthored(session: WorkoutSession): boolean {
  return !!session.authoredCatalog;
}

export function collectProgressionEvidence(input: {
  session: WorkoutSession;
  workout: RuntimeWorkout;
  catalog: RuntimeWorkoutCatalog;
  now: number;
  decision: ProgressionDecision;
  bandAfter: string | null;
}): ProgressionEvidenceEntry {
  const completed = input.session.state === 'COMPLETED';
  const abandoned = input.session.state === 'ABANDONED';
  return {
    sessionId: input.session.sessionId,
    workoutId: input.workout.id,
    familyId: input.workout.familyId,
    size: input.workout.size,
    bandId: input.workout.progressionBandId,
    completed,
    abandoned,
    completionRatio: completed ? sessionCompletionRatio(input.session) : 0,
    feedback: input.session.feedback?.value ?? null,
    catalogId: input.catalog.catalogId,
    catalogVersion: input.catalog.catalogVersion,
    engineVersion: input.catalog.engineVersion,
    recordedAt: input.now,
    decision: input.decision,
    bandAfter: input.bandAfter,
  };
}
