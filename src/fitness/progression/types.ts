/**
 * Player progression state for authored workouts.
 *
 * This is not a universal fitness scalar. It stores:
 * - current progression band
 * - per-family movement readiness
 * - compact evidence for future selection
 *
 * Policy numbers below are implementation choices; the authoring contract
 * does not specify advancement math.
 */

import { WorkoutFeedbackValue } from '../session/types';
import { WORKOUT_PROGRESSION_ENGINE_VERSION, WorkoutSize } from '../authoring/types';

export const PROGRESSION_POLICY = Object.freeze({
  engineVersion: WORKOUT_PROGRESSION_ENGINE_VERSION,
  minCompletionsToAdvanceBand: 2,
  minCompletionRatioToAdvance: 0.9,
  advancingFeedback: Object.freeze(['TOO_EASY', 'EASY', 'ABOUT_RIGHT'] as const),
  holdingFeedback: Object.freeze(['HARD', 'TOO_HARD'] as const),
  minCompletionRatioToHold: 0.7,
  consecutiveHardToRegress: 2,
  minCompletionsToAdvanceStage: 2,
  maxEvidenceLog: 24,
  maxRecentIds: 8,
});

export type ProgressionDecision = 'ADVANCE' | 'HOLD' | 'REGRESS' | 'NONE';

export interface MovementReadinessEntry {
  familyId: string;
  stageId: string;
}

export interface ProgressionEvidenceEntry {
  sessionId: string;
  workoutId: string;
  familyId: string;
  size: WorkoutSize;
  bandId: string;
  completed: boolean;
  abandoned: boolean;
  completionRatio: number;
  feedback: WorkoutFeedbackValue | null;
  catalogId: string;
  catalogVersion: string;
  engineVersion: string;
  recordedAt: number;
  decision: ProgressionDecision;
  bandAfter: string | null;
}

export interface PlayerProgressionState {
  engineVersion: string;
  catalogId: string | null;
  catalogVersion: string | null;
  currentBandId: string | null;
  /** familyId → stageId. Independent per movement family. */
  movementReadiness: Record<string, string>;
  /** Timestamp of last band change. Used so prior evidence cannot skip bands. */
  bandUpdatedAt: number | null;
  /** familyId → timestamp of last stage change. */
  readinessUpdatedAt: Record<string, number>;
  recentWorkoutIds: string[];
  recentFamilyIds: string[];
  evidenceLog: ProgressionEvidenceEntry[];
}

export function emptyPlayerProgressionState(): PlayerProgressionState {
  return {
    engineVersion: PROGRESSION_POLICY.engineVersion,
    catalogId: null,
    catalogVersion: null,
    currentBandId: null,
    movementReadiness: {},
    bandUpdatedAt: null,
    readinessUpdatedAt: {},
    recentWorkoutIds: [],
    recentFamilyIds: [],
    evidenceLog: [],
  };
}

export function clonePlayerProgressionState(state: PlayerProgressionState): PlayerProgressionState {
  return {
    engineVersion: state.engineVersion,
    catalogId: state.catalogId,
    catalogVersion: state.catalogVersion,
    currentBandId: state.currentBandId,
    movementReadiness: { ...state.movementReadiness },
    bandUpdatedAt: state.bandUpdatedAt,
    readinessUpdatedAt: { ...state.readinessUpdatedAt },
    recentWorkoutIds: [...state.recentWorkoutIds],
    recentFamilyIds: [...state.recentFamilyIds],
    evidenceLog: state.evidenceLog.map((entry) => ({ ...entry })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.length > 0) out[key] = entry;
  }
  return out;
}

function numberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) out[key] = entry;
  }
  return out;
}

/** Coerce persisted/partial progression without inventing a fitness scalar. */
export function coercePlayerProgressionState(raw: unknown): PlayerProgressionState {
  const empty = emptyPlayerProgressionState();
  if (!isRecord(raw)) return empty;
  const currentBandId = typeof raw.currentBandId === 'string' && raw.currentBandId.length > 0
    ? raw.currentBandId
    : null;
  return {
    engineVersion: typeof raw.engineVersion === 'string' && raw.engineVersion.length > 0
      ? raw.engineVersion
      : empty.engineVersion,
    catalogId: typeof raw.catalogId === 'string' ? raw.catalogId : null,
    catalogVersion: typeof raw.catalogVersion === 'string' ? raw.catalogVersion : null,
    currentBandId,
    movementReadiness: stringRecord(raw.movementReadiness),
    bandUpdatedAt: typeof raw.bandUpdatedAt === 'number' && Number.isFinite(raw.bandUpdatedAt)
      ? raw.bandUpdatedAt
      : null,
    readinessUpdatedAt: numberRecord(raw.readinessUpdatedAt),
    recentWorkoutIds: Array.isArray(raw.recentWorkoutIds)
      ? raw.recentWorkoutIds.filter((id): id is string => typeof id === 'string')
      : [],
    recentFamilyIds: Array.isArray(raw.recentFamilyIds)
      ? raw.recentFamilyIds.filter((id): id is string => typeof id === 'string')
      : [],
    evidenceLog: Array.isArray(raw.evidenceLog)
      ? raw.evidenceLog.filter(isRecord).map((entry) => ({
        sessionId: String(entry.sessionId ?? ''),
        workoutId: String(entry.workoutId ?? ''),
        familyId: String(entry.familyId ?? ''),
        size: (entry.size === 'SHORT' || entry.size === 'LONG' ? entry.size : 'STANDARD') as WorkoutSize,
        bandId: String(entry.bandId ?? ''),
        completed: entry.completed === true,
        abandoned: entry.abandoned === true,
        completionRatio: typeof entry.completionRatio === 'number' ? entry.completionRatio : 0,
        feedback: typeof entry.feedback === 'string' ? entry.feedback as WorkoutFeedbackValue : null,
        catalogId: String(entry.catalogId ?? ''),
        catalogVersion: String(entry.catalogVersion ?? ''),
        engineVersion: String(entry.engineVersion ?? empty.engineVersion),
        recordedAt: typeof entry.recordedAt === 'number' ? entry.recordedAt : 0,
        decision: (entry.decision === 'ADVANCE' || entry.decision === 'REGRESS' || entry.decision === 'HOLD'
          ? entry.decision
          : 'NONE') as ProgressionDecision,
        bandAfter: typeof entry.bandAfter === 'string' ? entry.bandAfter : null,
      }))
      : [],
  };
}
