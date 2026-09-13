import { PauseInterval, WorkoutSession } from './types';

export function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function closedPauseMs(interval: PauseInterval, now: number): number {
  const end = interval.endedAt ?? now;
  return Math.max(0, end - interval.startedAt);
}

export function totalPausedMs(session: WorkoutSession, now: number): number {
  return session.pauseIntervals.reduce((sum, interval) => sum + closedPauseMs(interval, now), 0);
}

export function pausedMsBetween(
  intervals: readonly PauseInterval[],
  start: number,
  end: number,
): number {
  let total = 0;
  for (const interval of intervals) {
    const intervalEnd = interval.endedAt ?? end;
    const overlapStart = Math.max(start, interval.startedAt);
    const overlapEnd = Math.min(end, intervalEnd);
    if (overlapEnd > overlapStart) total += overlapEnd - overlapStart;
  }
  return total;
}

export function activeDurationMs(
  startedAt: number,
  endedAt: number,
  intervals: readonly PauseInterval[],
): number {
  return Math.max(0, endedAt - startedAt - pausedMsBetween(intervals, startedAt, endedAt));
}

export function currentOpenPause(session: WorkoutSession): PauseInterval | null {
  const last = session.pauseIntervals[session.pauseIntervals.length - 1];
  if (!last || last.endedAt !== null) return null;
  return last;
}
