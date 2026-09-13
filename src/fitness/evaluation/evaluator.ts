import { isEligibleForFitnessEvaluation, finalizeCompletedWorkout } from '../session/summary';
import { CompletedWorkoutRecord, WorkoutSession } from '../session/types';
import { buildBodySectionEvidence } from './bodySection';
import { cloneCompletedWorkoutRecord, cloneFitnessEvidence, validateFitnessEvidence } from './clone';
import { evaluationErr, evaluationOk, EvaluationOpResult } from './errors';
import { FITNESS_EVIDENCE_VERSION, FitnessEvidence, FitnessEvaluationContext } from './types';
import { buildCompletionEvidence } from './performance';
import { buildPerceivedDifficultyEvidence } from './perceivedDifficulty';
import { buildFrequencyEvidence, buildRegroupingEvidence } from './placeholders';
import { buildRestSkippingEvidence } from './rest';
import { buildRepSpeedEvidence } from './speed';
import { isEligibleCompletedWorkoutRecord, validateCompletedWorkoutRecord } from './validation';
import { buildWorkloadEvidence } from './workload';

function notEligible(state: string, extra?: string): EvaluationOpResult<FitnessEvidence> {
  return evaluationErr(
    'evaluation.not_eligible',
    extra ?? `Record is not eligible for fitness evaluation (${state})`,
    { details: { state } },
  );
}

export function evaluateFitnessEvidence(
  record: unknown,
  context: FitnessEvaluationContext = {},
): EvaluationOpResult<FitnessEvidence> {
  const issues = validateCompletedWorkoutRecord(record);
  if (issues.length > 0) {
    const first = issues[0]!;
    const allowed = [
      'evaluation.malformed_record',
      'evaluation.invalid_feedback',
      'evaluation.invalid_difficulty',
      'evaluation.invalid_ids',
      'evaluation.invalid_timestamp',
      'evaluation.invalid_values',
      'evaluation.invalid_exercise',
    ] as const;
    const mapped = (allowed as readonly string[]).includes(first.code)
      ? (first.code as typeof allowed[number])
      : 'evaluation.malformed_record';
    return evaluationErr(mapped, first.message, { issues });
  }

  if (!isEligibleCompletedWorkoutRecord(record)) {
    const state = (record as { summary?: { state?: string } }).summary?.state ?? 'unknown';
    if (state === 'ABANDONED') return notEligible('ABANDONED', 'Abandoned sessions are not completed-workout fitness evidence');
    return notEligible(state);
  }

  const typed = cloneCompletedWorkoutRecord(record as CompletedWorkoutRecord);
  const evidence: FitnessEvidence = {
    evaluationVersion: FITNESS_EVIDENCE_VERSION,
    playerId: typed.playerId,
    sessionId: typed.sessionId,
    workoutId: typed.workoutId,
    purpose: typed.purpose,
    intendedDifficulty: typed.intendedDifficulty,
    feedback: typed.feedback!.value,
    completedAt: typed.completedAt,
    evaluatedAt: typeof context.evaluatedAt === 'number' && Number.isFinite(context.evaluatedAt)
      ? context.evaluatedAt
      : null,
    integrityFlagCount: typed.summary.flagCount,
    components: {
      perceivedDifficulty: buildPerceivedDifficultyEvidence(typed),
      completion: buildCompletionEvidence(typed),
      repSpeed: buildRepSpeedEvidence(typed),
      workload: buildWorkloadEvidence(typed),
      restSkipping: buildRestSkippingEvidence(typed),
      bodySection: buildBodySectionEvidence(typed),
      frequency: buildFrequencyEvidence(),
      regrouping: buildRegroupingEvidence(),
    },
  };

  const outputIssues = validateFitnessEvidence(evidence);
  if (outputIssues.length > 0) {
    return evaluationErr('evaluation.malformed_record', outputIssues[0]!.message, { issues: outputIssues });
  }

  return evaluationOk(cloneFitnessEvidence(evidence));
}

export function evaluateSessionFitnessEvidence(
  session: WorkoutSession,
  context: FitnessEvaluationContext = {},
): EvaluationOpResult<FitnessEvidence> {
  if (session.state === 'ABANDONED') {
    return notEligible('ABANDONED', 'Abandoned sessions are not completed-workout fitness evidence');
  }
  if (session.state !== 'COMPLETED') {
    return notEligible(session.state);
  }
  if (!isEligibleForFitnessEvaluation(session)) {
    return notEligible(session.state, 'Completed workouts require submitted feedback before evaluation');
  }
  const finalized = finalizeCompletedWorkout(session);
  if (!finalized.ok) {
    return evaluationErr('evaluation.not_eligible', finalized.error.message, { details: { state: session.state } });
  }
  return evaluateFitnessEvidence(finalized.value, context);
}
