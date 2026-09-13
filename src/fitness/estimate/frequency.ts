import { FitnessEvidence } from '../evaluation/types';
import { FITNESS_EVALUATION_CONFIG, MS_PER_DAY, MS_PER_MONTH, MS_PER_WEEK } from './config';
import { FitnessFrequencySnapshot } from './types';

function uniqueCompletedAt(records: readonly FitnessEvidence[]): number[] {
  const seen = new Set<string>();
  const times: number[] = [];
  for (const record of records) {
    if (seen.has(record.sessionId)) continue;
    seen.add(record.sessionId);
    if (Number.isFinite(record.completedAt)) times.push(record.completedAt);
  }
  return times;
}

function countSince(times: readonly number[], now: number, windowMs: number): number {
  const start = now - windowMs;
  return times.filter((time) => time <= now && time >= start).length;
}

function activeDaysLastWeek(times: readonly number[], now: number): number {
  const start = now - MS_PER_WEEK;
  const days = new Set<number>();
  for (const time of times) {
    if (time <= now && time >= start) days.add(Math.floor(time / MS_PER_DAY));
  }
  return days.size;
}

export function buildFrequencySnapshot(
  current: FitnessEvidence,
  prior: readonly FitnessEvidence[],
  now: number,
): FitnessFrequencySnapshot {
  if (prior.length === 0) {
    return {
      available: false,
      workoutsLastDay: null,
      workoutsLastWeek: null,
      workoutsLastMonth: null,
      activeDaysLastWeek: null,
    };
  }
  const times = uniqueCompletedAt([...prior, current]);
  return {
    available: true,
    workoutsLastDay: countSince(times, now, MS_PER_DAY),
    workoutsLastWeek: countSince(times, now, MS_PER_WEEK),
    workoutsLastMonth: countSince(times, now, MS_PER_MONTH),
    activeDaysLastWeek: activeDaysLastWeek(times, now),
  };
}

export function frequencySignal(snapshot: FitnessFrequencySnapshot): { signal: number; notes: string } {
  if (!snapshot.available || snapshot.workoutsLastWeek === null) {
    return { signal: 0, notes: 'no_history' };
  }
  const week = snapshot.workoutsLastWeek;
  if (week >= FITNESS_EVALUATION_CONFIG.frequency.grindThresholdPerWeek) {
    return { signal: 0, notes: 'high_volume_not_treated_as_xp' };
  }
  if (week <= 0) return { signal: 0, notes: 'no_recent_workouts' };
  return {
    signal: FITNESS_EVALUATION_CONFIG.frequency.modestSignal,
    notes: 'recent_consistency_context',
  };
}
