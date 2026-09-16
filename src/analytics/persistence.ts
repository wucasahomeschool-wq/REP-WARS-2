import { LoadWorldResult, SaveWorldResult } from '../persistence/types';
import { CatchUpWorldResult } from '../world/catchup';
import { safeObservePersistence } from './recorder';
import { TelemetryRecorder } from './types';

export function observeSaveResult(
  recorder: TelemetryRecorder | null | undefined,
  input: {
    playerId: string;
    worldId: string;
    worldTick: number;
    definitionWorldId?: string | null;
    worldLevel?: number | null;
    playerFactionId?: string | null;
    result: SaveWorldResult;
  },
): void {
  const outcome = input.result.ok
    ? 'ok'
    : input.result.code === 'persistence.conflict'
      ? 'conflict'
      : 'failed';
  safeObservePersistence(recorder, {
    operation: 'save',
    playerId: input.playerId,
    worldId: input.worldId,
    worldTick: input.worldTick,
    definitionWorldId: input.definitionWorldId,
    worldLevel: input.worldLevel,
    playerFactionId: input.playerFactionId,
    outcome,
    code: input.result.ok ? undefined : input.result.code,
    message: input.result.ok ? undefined : input.result.message,
  });
}

export function observeLoadResult(
  recorder: TelemetryRecorder | null | undefined,
  input: {
    playerId: string;
    worldId: string;
    result: LoadWorldResult;
  },
): void {
  if (input.result.ok) {
    safeObservePersistence(recorder, {
      operation: 'load',
      playerId: input.playerId,
      worldId: input.worldId,
      worldTick: input.result.record.worldTick,
      definitionWorldId: input.result.record.definitionWorldId,
      worldLevel: input.result.record.worldLevel,
      playerFactionId: input.result.record.playerFactionId,
      outcome: 'ok',
    });
    return;
  }
  safeObservePersistence(recorder, {
    operation: 'load',
    playerId: input.playerId,
    worldId: input.worldId,
    worldTick: 0,
    outcome: input.result.code === 'persistence.not_found' ? 'not_found' : 'failed',
    code: input.result.code,
    message: input.result.message,
  });
}

export function observeCatchUp(
  recorder: TelemetryRecorder | null | undefined,
  input: {
    playerId: string;
    worldId: string;
    worldTick: number;
    definitionWorldId?: string | null;
    worldLevel?: number | null;
    playerFactionId?: string | null;
    catchUp: CatchUpWorldResult;
  },
): void {
  if (input.catchUp.ticksAdvanced <= 0) return;
  safeObservePersistence(recorder, {
    operation: 'catch_up',
    playerId: input.playerId,
    worldId: input.worldId,
    worldTick: input.worldTick,
    definitionWorldId: input.definitionWorldId,
    worldLevel: input.worldLevel,
    playerFactionId: input.playerFactionId,
    outcome: 'ok',
    ticksAdvanced: input.catchUp.ticksAdvanced,
  });
}
