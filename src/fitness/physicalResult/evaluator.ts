import { cloneCompletedWorkoutRecord, cloneFitnessEvidence, validateFitnessEvidence } from '../evaluation/clone';
import { isEligibleCompletedWorkoutRecord, validateCompletedWorkoutRecord } from '../evaluation/validation';
import { FitnessEvidence } from '../evaluation/types';
import { BODY_SECTIONS } from '../types';
import { CompletedWorkoutRecord } from '../session/types';
import {
  PHYSICAL_RESULT_CONFIG,
  PhysicalResultConfig,
  difficultyFactor,
  roundPhysicalOutput,
} from './config';
import { contributeExercise } from './contribution';
import { clonePhysicalResult, emptyBodySectionOutput, validatePhysicalResultConfig } from './clone';
import { physicalResultErr, physicalResultOk, PhysicalResultOpResult } from './errors';
import { PhysicalResult, PhysicalResultContext } from './types';

function metadataLevel(
  context: PhysicalResultContext,
): { level: number | null; confidence: number | null } {
  if (context.fitnessLevelAtPrescription !== undefined || context.confidenceAtPrescription !== undefined) {
    return {
      level: context.fitnessLevelAtPrescription ?? context.fitnessEstimate?.level ?? null,
      confidence: context.confidenceAtPrescription ?? context.fitnessEstimate?.confidence ?? null,
    };
  }
  if (context.fitnessEstimate) {
    return {
      level: context.fitnessEstimate.level,
      confidence: context.fitnessEstimate.confidence,
    };
  }
  return { level: null, confidence: null };
}

export function calculatePhysicalResult(input: {
  completedWorkout: CompletedWorkoutRecord;
  evidence: FitnessEvidence;
  context?: PhysicalResultContext;
  configuration?: PhysicalResultConfig;
}): PhysicalResultOpResult<PhysicalResult> {
  const config = input.configuration ?? PHYSICAL_RESULT_CONFIG;
  const configIssues = validatePhysicalResultConfig(config);
  if (configIssues.length > 0) {
    return physicalResultErr('physicalResult.invalid_configuration', configIssues[0]!);
  }

  const recordIssues = validateCompletedWorkoutRecord(input.completedWorkout);
  if (recordIssues.length > 0) {
    return physicalResultErr('physicalResult.malformed_record', recordIssues[0]!.message);
  }
  if (!isEligibleCompletedWorkoutRecord(input.completedWorkout)) {
    const state = input.completedWorkout.summary?.state ?? 'unknown';
    return physicalResultErr(
      'physicalResult.not_eligible',
      `Record is not eligible for a PhysicalResult (${state})`,
      { state },
    );
  }

  const evidenceIssues = validateFitnessEvidence(input.evidence);
  if (evidenceIssues.length > 0) {
    return physicalResultErr('physicalResult.invalid_evidence', evidenceIssues[0]!.message);
  }

  const record = cloneCompletedWorkoutRecord(input.completedWorkout);
  const evidence = cloneFitnessEvidence(input.evidence);
  const context = input.context ?? {};

  if (
    evidence.playerId !== record.playerId
    || evidence.sessionId !== record.sessionId
    || evidence.workoutId !== record.workoutId
  ) {
    return physicalResultErr(
      'physicalResult.evidence_mismatch',
      'FitnessEvidence does not match the completed workout record',
      {
        evidenceSession: evidence.sessionId,
        recordSession: record.sessionId,
      },
    );
  }

  if (context.fitnessEstimate) {
    const estimate = context.fitnessEstimate;
    if (typeof estimate.playerId !== 'string' || estimate.playerId !== record.playerId) {
      return physicalResultErr(
        'physicalResult.invalid_estimate',
        'Fitness estimate playerId does not match the completed workout',
      );
    }
    if (!Number.isFinite(estimate.level) || !Number.isFinite(estimate.confidence)) {
      return physicalResultErr('physicalResult.invalid_estimate', 'Fitness estimate level/confidence is invalid');
    }
  }

  const diffFactor = difficultyFactor(record.intendedDifficulty, config);
  const contributions = record.summary.exercises.map((step) => contributeExercise(step, diffFactor, config));
  const bodySectionOutput = emptyBodySectionOutput();
  for (const row of contributions) {
    bodySectionOutput[row.bodySection] = roundPhysicalOutput(
      bodySectionOutput[row.bodySection] + row.physicalOutput,
    );
  }
  const totalPhysicalOutput = roundPhysicalOutput(
    contributions.reduce((sum, row) => sum + row.physicalOutput, 0),
  );
  const sectionSum = roundPhysicalOutput(
    BODY_SECTIONS.reduce((sum, key) => sum + bodySectionOutput[key], 0),
  );
  if (Math.abs(sectionSum - totalPhysicalOutput) > 0.002) {
    return physicalResultErr(
      'physicalResult.invalid_values',
      'Body-section output must sum to total physical output',
      { totalPhysicalOutput, sectionSum },
    );
  }

  const meta = metadataLevel(context);
  const result: PhysicalResult = {
    modelVersion: config.modelVersion,
    outputVersion: config.outputVersion,
    playerId: record.playerId,
    sessionId: record.sessionId,
    workoutId: record.workoutId,
    purpose: record.purpose,
    intendedDifficulty: record.intendedDifficulty,
    completedAt: record.completedAt,
    fitnessLevelAtPrescription: meta.level,
    confidenceAtPrescription: meta.confidence,
    personalizationModelVersion: context.personalization?.modelVersion ?? null,
    totalPhysicalOutput,
    bodySectionOutput,
    exerciseContributions: contributions,
    notes: [
      'output_from_completed_personalized_workload',
      'fitness_level_is_audit_metadata_not_a_multiplier',
      'purpose_is_metadata',
      'feedback_speed_frequency_do_not_scale_output',
    ],
  };

  return physicalResultOk(clonePhysicalResult(result));
}
