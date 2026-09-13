import { CompletedWorkoutRecord } from '../session/types';
import { FITNESS_EVIDENCE_VERSION, FitnessEvidence, FitnessEvaluationIssue } from './types';
import { isRecord } from '../guards';

export function validateFitnessEvidence(raw: unknown): FitnessEvaluationIssue[] {
  const issues: FitnessEvaluationIssue[] = [];
  if (!isRecord(raw)) {
    return [{ code: 'evaluation.invalid_evidence', message: 'FitnessEvidence must be an object' }];
  }
  if (raw.evaluationVersion !== FITNESS_EVIDENCE_VERSION) {
    issues.push({ code: 'evaluation.invalid_evidence', message: 'evaluationVersion is invalid' });
  }
  if (typeof raw.playerId !== 'string' || raw.playerId.trim() === '') {
    issues.push({ code: 'evaluation.invalid_ids', message: 'Evidence playerId is invalid' });
  }
  if ('fitnessLevel' in raw || 'fitnessScore' in raw || 'fitnessDelta' in raw || 'confidence' in raw) {
    issues.push({ code: 'evaluation.invalid_evidence', message: 'FitnessEvidence must not contain Fitness Level or Confidence fields' });
  }
  if (!isRecord(raw.components)) {
    issues.push({ code: 'evaluation.invalid_evidence', message: 'components must be an object' });
    return issues;
  }
  for (const key of [
    'perceivedDifficulty',
    'completion',
    'repSpeed',
    'workload',
    'restSkipping',
    'bodySection',
    'frequency',
    'regrouping',
  ] as const) {
    if (!isRecord(raw.components[key])) {
      issues.push({ code: 'evaluation.invalid_evidence', message: `components.${key} is missing` });
    }
  }
  return issues;
}

export function cloneFitnessEvidence(evidence: FitnessEvidence): FitnessEvidence {
  return JSON.parse(JSON.stringify(evidence)) as FitnessEvidence;
}

export function cloneCompletedWorkoutRecord(record: CompletedWorkoutRecord): CompletedWorkoutRecord {
  return JSON.parse(JSON.stringify(record)) as CompletedWorkoutRecord;
}
