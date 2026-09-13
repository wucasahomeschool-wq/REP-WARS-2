import { BodySection } from '../types';
import { CompletedWorkoutRecord, WorkoutSessionSummaryExercise } from '../session/types';
import { BodySectionEvidence, BodySectionTotals } from './types';

function emptyTotals(): BodySectionTotals {
  return {
    exercisesPrescribed: 0,
    exercisesCompleted: 0,
    exercisesSkippedRest: 0,
    exercisesIncompleteMandatory: 0,
    prescribedRepetitions: 0,
    completedRepetitions: 0,
    prescribedTimedDurationSeconds: 0,
    completedTimedDurationSeconds: 0,
  };
}

function addStep(totals: BodySectionTotals, step: WorkoutSessionSummaryExercise): void {
  totals.exercisesPrescribed += 1;
  if (step.status === 'COMPLETED') totals.exercisesCompleted += 1;
  if (step.status === 'SKIPPED_REST') totals.exercisesSkippedRest += 1;
  if (step.status === 'INCOMPLETE_MANDATORY') totals.exercisesIncompleteMandatory += 1;
  if (step.exerciseType === 'REP_BASED') {
    if (step.prescribed.kind === 'repetitions') totals.prescribedRepetitions += step.prescribed.repetitions;
    if (step.actual.kind === 'repetitions') totals.completedRepetitions += step.actual.completedRepetitions;
  }
  if (step.exerciseType === 'TIMED') {
    if (step.prescribed.kind === 'duration') totals.prescribedTimedDurationSeconds += step.prescribed.durationSeconds;
    if (step.actual.kind === 'duration') totals.completedTimedDurationSeconds += step.actual.completedDurationSeconds;
  }
}

export function buildBodySectionEvidence(record: CompletedWorkoutRecord): BodySectionEvidence {
  const sections = {
    UPPER_BODY: emptyTotals(),
    CORE: emptyTotals(),
    LOWER_BODY: emptyTotals(),
    GLOBAL: emptyTotals(),
  } as Record<BodySection, BodySectionTotals>;

  let attributed = 0;
  for (const step of record.summary.exercises) {
    if (!step.bodySection) continue;
    attributed += 1;
    addStep(sections[step.bodySection], step);
  }

  const quality = attributed === 0
    ? 'UNAVAILABLE'
    : attributed === record.summary.exercises.length
      ? 'STRONG'
      : 'PARTIAL';

  return {
    source: 'BODY_SECTION',
    quality,
    upperBodyExercises: sections.UPPER_BODY.exercisesPrescribed,
    coreExercises: sections.CORE.exercisesPrescribed,
    lowerBodyExercises: sections.LOWER_BODY.exercisesPrescribed,
    globalExercises: sections.GLOBAL.exercisesPrescribed,
    sections,
  };
}
