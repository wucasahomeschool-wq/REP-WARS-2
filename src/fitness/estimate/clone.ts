import { BODY_SECTIONS } from '../types';
import { FitnessBodySectionLevels, FitnessEstimate, FitnessEvaluationResult } from './types';

export function cloneBodySectionLevels(levels: FitnessBodySectionLevels): FitnessBodySectionLevels {
  return {
    GLOBAL: levels.GLOBAL,
    UPPER_BODY: levels.UPPER_BODY,
    CORE: levels.CORE,
    LOWER_BODY: levels.LOWER_BODY,
  };
}

export function cloneFitnessEstimate(estimate: FitnessEstimate): FitnessEstimate {
  return {
    modelVersion: estimate.modelVersion,
    playerId: estimate.playerId,
    level: estimate.level,
    confidence: estimate.confidence,
    bodySectionLevels: cloneBodySectionLevels(estimate.bodySectionLevels),
    initializedAt: estimate.initializedAt,
    lastUpdatedAt: estimate.lastUpdatedAt,
    observationCount: estimate.observationCount,
  };
}

export function cloneFitnessEvaluationResult(result: FitnessEvaluationResult): FitnessEvaluationResult {
  return JSON.parse(JSON.stringify(result)) as FitnessEvaluationResult;
}

export function emptyBodySectionLevels(level: number): FitnessBodySectionLevels {
  return {
    GLOBAL: level,
    UPPER_BODY: level,
    CORE: level,
    LOWER_BODY: level,
  };
}

export function allBodySectionKeys(): readonly (keyof FitnessBodySectionLevels)[] {
  return BODY_SECTIONS;
}
