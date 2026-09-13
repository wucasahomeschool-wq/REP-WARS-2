import { isRecord } from '../guards';
import { FITNESS_MODEL_VERSION } from './types';
import { FITNESS_EVALUATION_CONFIG } from './config';
import { FitnessEstimate } from './types';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateFitnessEstimate(raw: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(raw)) return ['FitnessEstimate must be an object'];
  if (raw.modelVersion !== FITNESS_MODEL_VERSION) issues.push('modelVersion is invalid');
  if (typeof raw.playerId !== 'string' || raw.playerId.trim() === '') issues.push('playerId is invalid');
  if (!isFiniteNumber(raw.level) || raw.level < FITNESS_EVALUATION_CONFIG.levelMin || raw.level > FITNESS_EVALUATION_CONFIG.levelMax) {
    issues.push('level is out of bounds');
  }
  if (!isFiniteNumber(raw.confidence) || raw.confidence < FITNESS_EVALUATION_CONFIG.confidenceMin || raw.confidence > FITNESS_EVALUATION_CONFIG.confidenceMax) {
    issues.push('confidence is out of bounds');
  }
  if (!isRecord(raw.bodySectionLevels)) {
    issues.push('bodySectionLevels is required');
  } else {
    for (const key of ['GLOBAL', 'UPPER_BODY', 'CORE', 'LOWER_BODY'] as const) {
      const value = raw.bodySectionLevels[key];
      if (!isFiniteNumber(value) || value < FITNESS_EVALUATION_CONFIG.levelMin || value > FITNESS_EVALUATION_CONFIG.levelMax) {
        issues.push(`bodySectionLevels.${key} is out of bounds`);
      }
    }
  }
  if (!isFiniteNumber(raw.initializedAt) || raw.initializedAt < 0) issues.push('initializedAt is invalid');
  if (!isFiniteNumber(raw.lastUpdatedAt) || raw.lastUpdatedAt < 0) issues.push('lastUpdatedAt is invalid');
  if (!Number.isInteger(raw.observationCount) || (raw.observationCount as number) < 0) issues.push('observationCount is invalid');
  return issues;
}

export function isFitnessEstimate(raw: unknown): raw is FitnessEstimate {
  return validateFitnessEstimate(raw).length === 0;
}
