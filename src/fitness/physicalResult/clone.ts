import { isRecord } from '../guards';
import { PHYSICAL_RESULT_CONFIG, PhysicalResultConfig } from './config';
import { PhysicalBodySectionOutput, PhysicalResult } from './types';

export function clonePhysicalResult(result: PhysicalResult): PhysicalResult {
  return JSON.parse(JSON.stringify(result)) as PhysicalResult;
}

export function emptyBodySectionOutput(): PhysicalBodySectionOutput {
  return {
    UPPER_BODY: 0,
    CORE: 0,
    LOWER_BODY: 0,
    GLOBAL: 0,
  };
}

export function validatePhysicalResultConfig(raw: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(raw)) return ['Physical result configuration must be an object'];
  const required = PHYSICAL_RESULT_CONFIG;
  for (const key of Object.keys(required) as (keyof PhysicalResultConfig)[]) {
    if (!(key in raw)) issues.push(`${String(key)} is required`);
  }
  const numericKeys: (keyof PhysicalResultConfig)[] = [
    'repWorkUnit',
    'timedWorkUnitPerSecond',
    'defaultExerciseModifier',
    'restFactor',
    'stretchFactor',
    'referenceDifficultyRank',
    'difficultyStepPerRank',
    'difficultyFactorMin',
    'difficultyFactorMax',
  ];
  for (const key of numericKeys) {
    if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key])) {
      issues.push(`${String(key)} must be a finite number`);
    }
  }
  if (typeof raw.repWorkUnit === 'number' && raw.repWorkUnit < 0) issues.push('repWorkUnit must be >= 0');
  if (typeof raw.timedWorkUnitPerSecond === 'number' && raw.timedWorkUnitPerSecond < 0) {
    issues.push('timedWorkUnitPerSecond must be >= 0');
  }
  if (typeof raw.restFactor === 'number' && raw.restFactor < 0) issues.push('restFactor must be >= 0');
  if (typeof raw.stretchFactor === 'number' && raw.stretchFactor < 0) issues.push('stretchFactor must be >= 0');
  if (
    typeof raw.difficultyFactorMin === 'number'
    && typeof raw.difficultyFactorMax === 'number'
    && raw.difficultyFactorMin > raw.difficultyFactorMax
  ) {
    issues.push('difficultyFactorMin must be <= difficultyFactorMax');
  }
  if (raw.modelVersion !== PHYSICAL_RESULT_CONFIG.modelVersion) issues.push('modelVersion is invalid');
  if (raw.outputVersion !== PHYSICAL_RESULT_CONFIG.outputVersion) issues.push('outputVersion is invalid');
  if (!Array.isArray(raw.stretchExerciseIds)) issues.push('stretchExerciseIds must be an array');
  if (!isRecord(raw.exerciseModifiers)) issues.push('exerciseModifiers must be an object');
  return issues;
}

export function validatePhysicalResult(raw: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(raw)) return ['PhysicalResult must be an object'];
  if (raw.modelVersion !== PHYSICAL_RESULT_CONFIG.modelVersion) issues.push('modelVersion is invalid');
  if (raw.outputVersion !== PHYSICAL_RESULT_CONFIG.outputVersion) issues.push('outputVersion is invalid');
  if (typeof raw.playerId !== 'string' || raw.playerId.trim() === '') issues.push('playerId is invalid');
  if (typeof raw.totalPhysicalOutput !== 'number' || !Number.isFinite(raw.totalPhysicalOutput) || raw.totalPhysicalOutput < 0) {
    issues.push('totalPhysicalOutput must be a finite non-negative number');
  }
  if ('fitnessScore' in raw || 'physicalScore' in raw) {
    issues.push('PhysicalResult must not contain a fitness or physical score field');
  }
  if (!Array.isArray(raw.exerciseContributions)) issues.push('exerciseContributions must be an array');
  if (!isRecord(raw.bodySectionOutput)) issues.push('bodySectionOutput must be an object');
  return issues;
}
