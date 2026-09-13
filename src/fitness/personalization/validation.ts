import { FITNESS_EVALUATION_CONFIG } from '../estimate/config';
import { isRecord } from '../guards';
import { FITNESS_PERSONALIZATION_CONFIG, FitnessPersonalizationConfig } from './config';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validatePersonalizationConfig(raw: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(raw)) return ['Personalization configuration must be an object'];
  const required = FITNESS_PERSONALIZATION_CONFIG;
  for (const key of Object.keys(required) as (keyof FitnessPersonalizationConfig)[]) {
    if (!(key in raw)) issues.push(`${String(key)} is required`);
  }
  const numericKeys: (keyof FitnessPersonalizationConfig)[] = [
    'referenceLevel',
    'levelMin',
    'levelMax',
    'fitnessCompression',
    'maxFitnessShift',
    'maxDifficultyShift',
    'minMultiplier',
    'maxMultiplier',
    'maxAbsRepAdjustment',
    'maxAbsDurationAdjustment',
    'minRepetitions',
    'maxRepetitions',
    'minDurationSeconds',
    'maxDurationSeconds',
    'confidenceFloor',
    'confidenceFull',
    'confidenceCurve',
  ];
  for (const key of numericKeys) {
    if (!isFiniteNumber(raw[key])) issues.push(`${String(key)} must be a finite number`);
  }
  if (isFiniteNumber(raw.minMultiplier) && isFiniteNumber(raw.maxMultiplier) && raw.minMultiplier >= raw.maxMultiplier) {
    issues.push('minMultiplier must be less than maxMultiplier');
  }
  if (isFiniteNumber(raw.minMultiplier) && raw.minMultiplier <= 0) {
    issues.push('minMultiplier must be positive');
  }
  if (isFiniteNumber(raw.minRepetitions) && isFiniteNumber(raw.maxRepetitions) && raw.minRepetitions > raw.maxRepetitions) {
    issues.push('minRepetitions must be <= maxRepetitions');
  }
  if (isFiniteNumber(raw.minDurationSeconds) && isFiniteNumber(raw.maxDurationSeconds) && raw.minDurationSeconds > raw.maxDurationSeconds) {
    issues.push('minDurationSeconds must be <= maxDurationSeconds');
  }
  if (isFiniteNumber(raw.confidenceFloor) && isFiniteNumber(raw.confidenceFull) && raw.confidenceFloor >= raw.confidenceFull) {
    issues.push('confidenceFloor must be less than confidenceFull');
  }
  if (isFiniteNumber(raw.confidenceCurve) && raw.confidenceCurve <= 0) {
    issues.push('confidenceCurve must be positive');
  }
  if (isFiniteNumber(raw.maxAbsRepAdjustment) && raw.maxAbsRepAdjustment < 0) {
    issues.push('maxAbsRepAdjustment must be >= 0');
  }
  if (isFiniteNumber(raw.maxAbsDurationAdjustment) && raw.maxAbsDurationAdjustment < 0) {
    issues.push('maxAbsDurationAdjustment must be >= 0');
  }
  if (isFiniteNumber(raw.minRepetitions) && (!Number.isInteger(raw.minRepetitions) || raw.minRepetitions < 1)) {
    issues.push('minRepetitions must be a positive integer');
  }
  if (isFiniteNumber(raw.maxRepetitions) && (!Number.isInteger(raw.maxRepetitions) || raw.maxRepetitions < 1)) {
    issues.push('maxRepetitions must be a positive integer');
  }
  if (typeof raw.useBodySectionLevels !== 'boolean') {
    issues.push('useBodySectionLevels must be a boolean');
  }
  if (raw.personalizationVersion !== FITNESS_PERSONALIZATION_CONFIG.personalizationVersion) {
    issues.push('personalizationVersion is invalid');
  }
  if (isFiniteNumber(raw.referenceLevel)
    && (raw.referenceLevel < FITNESS_EVALUATION_CONFIG.levelMin || raw.referenceLevel > FITNESS_EVALUATION_CONFIG.levelMax)) {
    issues.push('referenceLevel is out of Fitness Level bounds');
  }
  return issues;
}
