import { RuntimeWorkout, RuntimeWorkoutCatalog } from '../authoring/compile';
import { WorkoutSession } from '../session/types';
import { collectProgressionEvidence, sessionCompletionRatio } from './evidence';
import { firstStageId, orderedStages, seedMissingReadiness } from './readiness';
import {
  PlayerProgressionState,
  ProgressionDecision,
  ProgressionEvidenceEntry,
  PROGRESSION_POLICY,
  clonePlayerProgressionState,
} from './types';

export interface ProgressionEvaluation {
  next: PlayerProgressionState;
  decision: ProgressionDecision;
  bandBefore: string | null;
  bandAfter: string | null;
  evidence: ProgressionEvidenceEntry;
}

function nextBandId(catalog: RuntimeWorkoutCatalog, currentId: string | null): string | null {
  const ids = catalog.orderedBandIds;
  if (ids.length === 0) return null;
  if (!currentId) return ids[0] ?? null;
  const index = ids.indexOf(currentId);
  if (index < 0) return ids[0] ?? null;
  return ids[index + 1] ?? null;
}

function prevBandId(catalog: RuntimeWorkoutCatalog, currentId: string | null): string | null {
  const ids = catalog.orderedBandIds;
  if (!currentId) return ids[0] ?? null;
  const index = ids.indexOf(currentId);
  if (index <= 0) return ids[0] ?? null;
  return ids[index - 1] ?? null;
}

function isStrongCompletion(entry: ProgressionEvidenceEntry): boolean {
  if (!entry.completed || entry.abandoned) return false;
  if (entry.completionRatio < PROGRESSION_POLICY.minCompletionRatioToAdvance) return false;
  if (entry.feedback === null) return false;
  return (PROGRESSION_POLICY.advancingFeedback as readonly string[]).includes(entry.feedback);
}

function isHardLowCompletion(entry: ProgressionEvidenceEntry): boolean {
  if (!entry.completed || entry.abandoned) return false;
  if (entry.feedback === null) return false;
  if (!(PROGRESSION_POLICY.holdingFeedback as readonly string[]).includes(entry.feedback)) return false;
  return entry.completionRatio < PROGRESSION_POLICY.minCompletionRatioToHold;
}

function since(timestamp: number | null, recordedAt: number): boolean {
  return timestamp === null || recordedAt >= timestamp;
}

function workoutUsesFamily(catalog: RuntimeWorkoutCatalog, workoutId: string, familyId: string): boolean {
  const workout = catalog.workouts[workoutId];
  if (!workout) return false;
  return workout.exercises.some((step) => catalog.exercises[step.exerciseId]?.movementFamilyId === familyId);
}

function pushCapped(list: string[], value: string, max: number): string[] {
  const next = [value, ...list.filter((id) => id !== value)];
  return next.slice(0, max);
}

/**
 * Conservative accumulated-evidence policy. Implementation choice:
 * two strong completions after the last band change to advance one band;
 * two consecutive hard low-completion results to regress one band;
 * a single feedback answer never skips a band or stage.
 */
export function evaluateAuthoredProgression(input: {
  catalog: RuntimeWorkoutCatalog;
  state: PlayerProgressionState;
  session: WorkoutSession;
  workout: RuntimeWorkout;
  now: number;
}): ProgressionEvaluation {
  const next = clonePlayerProgressionState(input.state);
  if (next.evidenceLog.some((entry) => entry.sessionId === input.session.sessionId)) {
    return {
      next: input.state,
      decision: 'NONE',
      bandBefore: input.state.currentBandId,
      bandAfter: input.state.currentBandId,
      evidence: collectProgressionEvidence({
        session: input.session,
        workout: input.workout,
        catalog: input.catalog,
        now: input.now,
        decision: 'NONE',
        bandAfter: input.state.currentBandId,
      }),
    };
  }
  next.engineVersion = PROGRESSION_POLICY.engineVersion;
  next.catalogId = input.catalog.catalogId;
  next.catalogVersion = input.catalog.catalogVersion;
  seedMissingReadiness(input.catalog, next);
  if (!next.currentBandId || !input.catalog.progressionBands[next.currentBandId]) {
    next.currentBandId = input.catalog.orderedBandIds[0] ?? null;
  }

  const bandBefore = next.currentBandId;
  let decision: ProgressionDecision = 'NONE';
  let bandAfter = bandBefore;

  const completed = input.session.state === 'COMPLETED';
  const abandoned = input.session.state === 'ABANDONED';

  if (completed && !abandoned) {
    const preview: ProgressionEvidenceEntry = collectProgressionEvidence({
      session: input.session,
      workout: input.workout,
      catalog: input.catalog,
      now: input.now,
      decision: 'HOLD',
      bandAfter: bandBefore,
    });
    preview.completionRatio = sessionCompletionRatio(input.session);

    const inBand = [...next.evidenceLog, preview].filter((entry) => since(next.bandUpdatedAt, entry.recordedAt));
    const strong = inBand.filter(isStrongCompletion);
    const completedInBand = inBand.filter((entry) => entry.completed && !entry.abandoned);
    const lastHard = completedInBand.slice(-PROGRESSION_POLICY.consecutiveHardToRegress);

    if (strong.length >= PROGRESSION_POLICY.minCompletionsToAdvanceBand) {
      let target = nextBandId(input.catalog, bandBefore);
      if (
        input.workout.bridge
        && input.workout.bridge.fromBandId === bandBefore
        && input.catalog.progressionBands[input.workout.bridge.toBandId]
      ) {
        target = input.workout.bridge.toBandId;
      }
      if (target && target !== bandBefore) {
        decision = 'ADVANCE';
        bandAfter = target;
        next.currentBandId = target;
        next.bandUpdatedAt = input.now;
      } else {
        decision = 'HOLD';
      }
    } else if (
      lastHard.length >= PROGRESSION_POLICY.consecutiveHardToRegress
      && lastHard.every(isHardLowCompletion)
    ) {
      const target = prevBandId(input.catalog, bandBefore);
      if (target && target !== bandBefore) {
        decision = 'REGRESS';
        bandAfter = target;
        next.currentBandId = target;
        next.bandUpdatedAt = input.now;
      } else {
        decision = 'HOLD';
      }
    } else {
      decision = 'HOLD';
    }

    for (const family of Object.values(input.catalog.movementFamilies)) {
      if (!workoutUsesFamily(input.catalog, input.workout.id, family.id)) continue;
      const updatedAt = next.readinessUpdatedAt[family.id] ?? null;
      const familyStrong = [...next.evidenceLog, preview].filter((entry) => (
        isStrongCompletion(entry)
        && since(updatedAt, entry.recordedAt)
        && workoutUsesFamily(input.catalog, entry.workoutId, family.id)
      ));
      if (familyStrong.length < PROGRESSION_POLICY.minCompletionsToAdvanceStage) continue;
      const current = next.movementReadiness[family.id] ?? firstStageId(family);
      const stages = orderedStages(family);
      const index = stages.findIndex((stage) => stage.id === current);
      const following = index >= 0 ? stages[index + 1] : null;
      if (following) {
        next.movementReadiness[family.id] = following.id;
        next.readinessUpdatedAt[family.id] = input.now;
      }
    }
  }

  const evidence = collectProgressionEvidence({
    session: input.session,
    workout: input.workout,
    catalog: input.catalog,
    now: input.now,
    decision,
    bandAfter,
  });
  next.recentWorkoutIds = pushCapped(next.recentWorkoutIds, input.workout.id, PROGRESSION_POLICY.maxRecentIds);
  next.recentFamilyIds = pushCapped(next.recentFamilyIds, input.workout.familyId, PROGRESSION_POLICY.maxRecentIds);
  next.evidenceLog = [...next.evidenceLog, evidence].slice(-PROGRESSION_POLICY.maxEvidenceLog);
  return { next, decision, bandBefore, bandAfter, evidence };
}
