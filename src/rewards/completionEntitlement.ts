import type { WorkoutSession } from '../fitness/session/types';
import type { WorkoutSize } from '../fitness/authoring/types';
import { WORLD_FORMAT_VERSION } from '../worldDefinition/types';
import {
  calculateCompletionSoldiers, COMPLETION_REWARD_UNITS, contractId, contractRecord,
  validateWorldWorkoutRewardPolicy, WorldWorkoutRewardPolicy,
} from './completionPolicy';

export const COMPLETION_ENTITLEMENT_VERSION = 'workout-completion.v1' as const;
type SessionBinding = Pick<WorkoutSession, 'playerId' | 'sessionId' | 'workoutId' | 'purpose'>
  & Partial<Pick<WorkoutSession, 'authoredCatalog'>>;

/** Immutable start-time facts, NOT a payment ledger or GameRewardResult. */
export interface CompletionRewardEntitlement {
  readonly version: typeof COMPLETION_ENTITLEMENT_VERSION;
  readonly entitlementId: string;
  readonly playerId: string;
  readonly sessionId: string;
  readonly purpose: 'NORMAL_TROOPS';
  readonly workout: Readonly<{ workoutId: string; catalogId: string; catalogVersion: string }>;
  readonly size: WorkoutSize;
  readonly rewardUnits: number;
  /** Origin world, deliberately independent of the current campaign world. */
  readonly world: Readonly<{ worldId: string; formatVersion: typeof WORLD_FORMAT_VERSION; level: number }>;
  readonly policy: WorldWorkoutRewardPolicy;
  readonly soldiers: number;
}

/** Stable logical identity: never includes policy version/revision, ratio or calculated amount. */
export function completionEntitlementId(playerId: string, sessionId: string): string {
  contractId(playerId, 'player identity');
  contractId(sessionId, 'session identity');
  return `workout-completion:${JSON.stringify([playerId, sessionId])}`;
}

export function validateCompletionRewardEntitlement(value: unknown, session?: SessionBinding): asserts value is CompletionRewardEntitlement {
  const record = contractRecord(value, [
    'version', 'entitlementId', 'playerId', 'sessionId', 'purpose', 'workout', 'size', 'rewardUnits', 'world', 'policy', 'soldiers',
  ], 'completion entitlement');
  if (record.version !== COMPLETION_ENTITLEMENT_VERSION || record.purpose !== 'NORMAL_TROOPS') {
    throw new Error('Unsupported completion entitlement contract or purpose');
  }
  contractId(record.playerId, 'entitlement player');
  contractId(record.sessionId, 'entitlement session');
  if (record.entitlementId !== completionEntitlementId(record.playerId, record.sessionId)) throw new Error('Entitlement identity mismatch');
  const workout = contractRecord(record.workout, ['workoutId', 'catalogId', 'catalogVersion'], 'entitlement workout');
  for (const key of ['workoutId', 'catalogId', 'catalogVersion']) contractId(workout[key], key);
  if (record.size !== 'SHORT' && record.size !== 'STANDARD' && record.size !== 'LONG') throw new Error('Invalid entitlement workout size');
  if (record.rewardUnits !== COMPLETION_REWARD_UNITS[record.size]) throw new Error('Entitlement reward units do not match size');
  const world = contractRecord(record.world, ['worldId', 'formatVersion', 'level'], 'entitlement world');
  contractId(world.worldId, 'entitlement world id');
  if (world.formatVersion !== WORLD_FORMAT_VERSION || typeof world.level !== 'number'
    || !Number.isSafeInteger(world.level) || world.level < 1) throw new Error('Invalid entitlement world identity');
  validateWorldWorkoutRewardPolicy(record.policy);
  if (record.soldiers !== calculateCompletionSoldiers(record.rewardUnits as number, record.policy.soldiersPerRewardUnitMicros)) {
    throw new Error('Entitlement soldier amount does not match locked terms');
  }
  if (session) {
    if (record.playerId !== session.playerId || record.sessionId !== session.sessionId
      || workout.workoutId !== session.workoutId || record.purpose !== session.purpose) throw new Error('Entitlement session binding mismatch');
    const authored = session.authoredCatalog;
    if (authored && (authored.size !== record.size || authored.catalogId !== workout.catalogId
      || authored.catalogVersion !== workout.catalogVersion)) throw new Error('Entitlement authored workout mismatch');
  }
}

export function cloneCompletionRewardEntitlement(value: CompletionRewardEntitlement, session?: SessionBinding): CompletionRewardEntitlement {
  validateCompletionRewardEntitlement(value, session);
  return Object.freeze({
    ...value, workout: Object.freeze({ ...value.workout }), world: Object.freeze({ ...value.world }),
    policy: Object.freeze({ ...value.policy }),
  });
}

/** Pure server-side construction helper. R1-C does not call this from START_WORKOUT. */
export function createCompletionRewardEntitlement(input: {
  session: SessionBinding;
  size: WorkoutSize;
  catalogId: string;
  catalogVersion: string;
  world: CompletionRewardEntitlement['world'];
  policy: WorldWorkoutRewardPolicy;
}): CompletionRewardEntitlement {
  const { session } = input;
  validateWorldWorkoutRewardPolicy(input.policy);
  const value: CompletionRewardEntitlement = {
    version: COMPLETION_ENTITLEMENT_VERSION, entitlementId: completionEntitlementId(session.playerId, session.sessionId),
    playerId: session.playerId, sessionId: session.sessionId, purpose: 'NORMAL_TROOPS',
    workout: { workoutId: session.workoutId, catalogId: input.catalogId, catalogVersion: input.catalogVersion },
    size: input.size, rewardUnits: COMPLETION_REWARD_UNITS[input.size], world: { ...input.world }, policy: { ...input.policy },
    soldiers: calculateCompletionSoldiers(COMPLETION_REWARD_UNITS[input.size], input.policy.soldiersPerRewardUnitMicros),
  };
  return cloneCompletionRewardEntitlement(value, session);
}

export function workoutCompletionRewardMode(session: Pick<WorkoutSession, 'completionRewardEntitlement'>): 'LEGACY' | 'LOCKED_COMPLETION' {
  if (session.completionRewardEntitlement === undefined) return 'LEGACY';
  validateCompletionRewardEntitlement(session.completionRewardEntitlement);
  return 'LOCKED_COMPLETION';
}
