import assert from 'assert';
import {
  calculateCompletionSoldiers, COMPLETION_REWARD_UNITS, requireWorldWorkoutRewardPolicy,
  SOLDIER_RATIO_SCALE, validateWorldWorkoutRewardPolicy, WorldWorkoutRewardPolicy,
} from '../src/rewards/completionPolicy';
import {
  cloneCompletionRewardEntitlement, completionEntitlementId, createCompletionRewardEntitlement,
  validateCompletionRewardEntitlement, workoutCompletionRewardMode,
} from '../src/rewards/completionEntitlement';
import {
  beginWorkoutSession, cloneWorkoutSession, completeExercise, getCurrentExercise, submitWorkoutFeedback,
} from '../src/fitness/session';
import { WorkoutSession } from '../src/fitness/session/types';
import { WorkoutPurpose } from '../src/fitness/types';
import { cloneWorkoutHistoryEntry, toWorkoutHistoryEntry } from '../src/fitness/history/record';
import { InMemoryWorkoutHistoryStore } from '../src/fitness/history/inMemoryStore';
import { MemoryWorkoutHistoryTable, SupabaseWorkoutHistoryStore } from '../src/persistence/supabase/historyAdapter';
import { createGameState, createLegacySampleMapGameState } from '../src/state/createGameState';
import { cloneGameState } from '../src/state/cloneGameState';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { snapshotGameState } from '../src/persistence/snapshot';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { encodePersistable } from '../src/persistence/serialization';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { loadProductionLevel1Definition, loadProductionLevel2Definition } from '../src/worldDefinition/catalog';
import { parseWorldJson } from '../src/worldDefinition/parse';
import { validateWorldDefinition } from '../src/worldDefinition/validate';
import { serializeWorldDefinitionForClient } from '../src/worldDefinition/clientView';
import { serializePublicGameState } from '../src/orchestration/publicView';
import { Orchestrator } from '../src/orchestration/orchestrator';
import { runWorkoutRewardPipeline, retryPendingWorkoutReward } from '../src/rewards/pipeline/runWorkoutRewardPipeline';
import { GAME_STATE_SCHEMA_VERSION } from '../src/types/GameState';
import { openGameplaySessionLease } from '../src/world/presenceLeases';

// Explicit synthetic test policy, NOT approved production balance.
function policy(micros = 1_250_000, revision = 'fixture-revision'): WorldWorkoutRewardPolicy {
  return { version: 'workout-soldiers.v1', revision, soldiersPerRewardUnitMicros: micros };
}
function session(id = 'contract-session', purpose: WorkoutPurpose = 'NORMAL_TROOPS'): WorkoutSession {
  const result = beginWorkoutSession({ playerId: 'contract-player', sessionId: id, now: 1000,
    workoutId: 'wk_very_easy_mobility', intendedDifficulty: 'VERY_EASY', purpose });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
function completed(id: string): WorkoutSession {
  let value = session(id), now = 1000;
  while (value.state === 'ACTIVE') {
    const step = getCurrentExercise(value)!;
    const result = completeExercise(value, step.prescription.kind === 'repetitions'
      ? { order: step.order, repetitions: step.prescription.repetitions }
      : { order: step.order, durationSeconds: step.prescription.durationSeconds }, now += 1000);
    if (!result.ok) throw new Error(result.error.message);
    value = result.value;
  }
  const feedback = submitWorkoutFeedback(value, 'ABOUT_RIGHT', now + 1000);
  if (!feedback.ok) throw new Error(feedback.error.message);
  return feedback.value;
}
function lock(value = session(), terms = policy()) {
  return createCompletionRewardEntitlement({ session: value, size: 'STANDARD', catalogId: 'fixture-catalog',
    catalogVersion: 'fixture.v1', world: { worldId: 'origin-world', formatVersion: 'rep-wars-world.v1', level: 1 }, policy: terms });
}
function locked(value = session()): WorkoutSession {
  return { ...value, completionRewardEntitlement: lock(value) };
}
function state(value: WorkoutSession | null = session()) {
  const result = createLegacySampleMapGameState({ seed: 31, playerFactionId: 'iron_kingdom' });
  result.playerFitness.activeSession = value;
  return result;
}
function definition() {
  const result = loadProductionLevel1Definition();
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return structuredClone(result.definition);
}

export function registerWorkoutRewardContractTests({ test }: { test: (name: string, fn: () => void | Promise<void>) => void }): void {
  for (const [size, units] of [['SHORT', 60], ['STANDARD', 100], ['LONG', 145]] as const) {
    test(`R1-C ${size} uses exactly ${units} units without overrides`, () => {
      const value = createCompletionRewardEntitlement({ session: session(), size, catalogId: 'fixture', catalogVersion: 'v1',
        world: lock().world, policy: policy() });
      assert.strictEqual(COMPLETION_REWARD_UNITS[size], units);
      assert.strictEqual(value.rewardUnits, units);
      assert.strictEqual(value.soldiers, Math.floor((units * 1_250_000 + 500_000) / SOLDIER_RATIO_SCALE));
    });
  }
  test('R1-C fixed-point half-up boundaries use exact integer rounding', () => {
    assert.strictEqual(calculateCompletionSoldiers(1, 499_999), 0);
    assert.strictEqual(calculateCompletionSoldiers(1, 500_000), 1);
    assert.strictEqual(calculateCompletionSoldiers(1, 500_001), 1);
    assert.strictEqual(calculateCompletionSoldiers(145, 100_000), 15);
    assert.strictEqual(calculateCompletionSoldiers(0, 1), 0);
    assert.strictEqual(calculateCompletionSoldiers(60, 1), 0);
  });
  test('R1-C BigInt intermediate preserves near-safe-integer results', () => {
    const n = Number.MAX_SAFE_INTEGER;
    assert.strictEqual(calculateCompletionSoldiers(n, 1_000_000), n);
    assert.strictEqual(calculateCompletionSoldiers(n, 999_999), Number((BigInt(n) * 999_999n + 500_000n) / 1_000_000n));
    assert.throws(() => calculateCompletionSoldiers(n, 1_000_001), /safe integer range/);
    assert.throws(() => calculateCompletionSoldiers(n, n), /safe integer range/);
  });
  test('R1-C rejects invalid numeric input without coercion', () => {
    for (const bad of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100', null, undefined]) {
      assert.throws(() => calculateCompletionSoldiers(bad as number, 1_000_000));
      assert.throws(() => calculateCompletionSoldiers(100, bad as number));
    }
    assert.throws(() => calculateCompletionSoldiers(100, 0));
  });
  test('R1-C rejects malformed policy versions revisions ratios and overrides', () => {
    const cases = [null, {}, [], { ...policy(), version: 'v2' }, { ...policy(), revision: ' ' },
      { ...policy(), soldiersPerRewardUnitMicros: 0 }, { ...policy(), soldiersPerRewardUnitMicros: '100' },
      { ...policy(), soldiersPerRewardUnitMicros: Number.MAX_SAFE_INTEGER + 1 }, { ...policy(), rewardUnitOverrides: { SHORT: 999 } }];
    for (const bad of cases) assert.throws(() => validateWorldWorkoutRewardPolicy(bad));
    validateWorldWorkoutRewardPolicy(policy(Number.MAX_SAFE_INTEGER));
  });
  test('R1-C missing policy remains legacy content and strict resolution rejects it', () => {
    const def = definition();
    assert.strictEqual(def.workoutRewards, undefined);
    assert.deepStrictEqual(validateWorldDefinition(def), []);
    assert.throws(() => requireWorldWorkoutRewardPolicy(def));
    const result = loadProductionLevel2Definition();
    assert.ok(result.ok);
    if (result.ok) assert.strictEqual(result.definition.workoutRewards, undefined);
  });
  test('R1-C present invalid world policy fails authoritative world loading', () => {
    for (const bad of [null, {}, { ...policy(), soldiersPerRewardUnitMicros: -1 }, { ...policy(), extra: 1 }]) {
      const def = { ...definition(), workoutRewards: bad };
      const result = parseWorldJson(JSON.stringify(def));
      assert.strictEqual(result.ok, false);
      if (!result.ok) assert.ok(result.issues.some(issue => issue.code === 'world.invalid_workout_rewards'));
    }
  });
  test('R1-C world policy survives JSON client export and parse without a default ratio', () => {
    const def = { ...definition(), workoutRewards: policy() };
    const before = JSON.stringify(def), view = serializeWorldDefinitionForClient(def);
    assert.notStrictEqual(view.workoutRewards, def.workoutRewards);
    assert.deepStrictEqual(requireWorldWorkoutRewardPolicy(view), policy());
    const result = parseWorldJson(JSON.stringify(view));
    assert.ok(result.ok);
    if (result.ok) assert.deepStrictEqual(result.definition, def);
    assert.strictEqual(JSON.stringify(def), before);
    assert.ok(!Object.prototype.hasOwnProperty.call(serializeWorldDefinitionForClient(definition()), 'workoutRewards'));
  });
  test('R1-C identity is stable across policy revision ratio world and workout metadata', () => {
    const first = lock(), second = lock(session(), policy(2_000_000, 'next-revision'));
    assert.strictEqual(first.entitlementId, second.entitlementId);
    assert.notStrictEqual(first.soldiers, second.soldiers);
    const changed = createCompletionRewardEntitlement({ session: session(), size: 'LONG', catalogId: 'next', catalogVersion: 'v2',
      world: { ...first.world, worldId: 'next-world', level: 2 }, policy: policy() });
    assert.strictEqual(changed.entitlementId, first.entitlementId);
    assert.notStrictEqual(completionEntitlementId('p:a', 'b'), completionEntitlementId('p', 'a:b'));
    assert.notStrictEqual(completionEntitlementId('p', 's'), completionEntitlementId('p', 's2'));
    assert.throws(() => completionEntitlementId('', 's'));
  });
  test('R1-C frozen entitlement copies do not alias source objects', () => {
    const original = lock(), copy = cloneCompletionRewardEntitlement(original);
    assert.deepStrictEqual(copy, original);
    for (const key of ['world', 'workout', 'policy'] as const) {
      assert.notStrictEqual(copy[key], original[key]);
      assert.ok(Object.isFrozen(copy[key]));
    }
    assert.ok(Object.isFrozen(copy));
    assert.throws(() => { (copy as any).soldiers = 999; });
    assert.throws(() => { (copy.policy as any).revision = 'mutated'; });
  });
  test('R1-C factory requires explicit size and respects authored catalog binding', () => {
    const base = session();
    const authored = { ...base, authoredCatalog: { catalogId: 'fixture-catalog', catalogVersion: 'fixture.v1', engineVersion: 'v1',
      familyId: 'fixture-family', size: 'STANDARD' as const, progressionBandId: 'fixture-band' } };
    validateCompletionRewardEntitlement(lock(authored), authored);
    assert.throws(() => lock({ ...authored, authoredCatalog: { ...authored.authoredCatalog, size: 'SHORT' } }));
    assert.throws(() => lock({ ...authored, authoredCatalog: { ...authored.authoredCatalog, catalogVersion: 'other' } }));
    assert.throws(() => createCompletionRewardEntitlement({ session: base, size: undefined as any, catalogId: 'c', catalogVersion: 'v',
      world: lock().world, policy: policy() }));
  });
  test('R1-C specialized workout purposes cannot receive normal soldier entitlements', () => {
    for (const purpose of ['DEFENSE', 'GOLDEN_YIELD', 'EXTRA_CONSTRUCTION_WORKERS'] as const) assert.throws(() => lock(session('s', purpose)));
  });
  test('R1-C clone and reward-mode distinguish legacy from validated locks', () => {
    const legacy = session(), modern = locked();
    assert.strictEqual(workoutCompletionRewardMode(legacy), 'LEGACY');
    assert.strictEqual(workoutCompletionRewardMode(modern), 'LOCKED_COMPLETION');
    assert.ok(!('completionRewardEntitlement' in cloneWorkoutSession(legacy)));
    const copy = cloneWorkoutSession(modern);
    assert.deepStrictEqual(copy, modern);
    assert.notStrictEqual(copy.completionRewardEntitlement, modern.completionRewardEntitlement);
    assert.throws(() => workoutCompletionRewardMode({ completionRewardEntitlement: null as any }));
  });
  test('R1-C session entitlement survives full snapshot JSON hydration and repeated reload', () => {
    const value = state(locked()), original = snapshotGameState(value);
    const loaded = hydratePersistedPayload(JSON.stringify(original));
    assert.strictEqual(loaded.schemaVersion, GAME_STATE_SCHEMA_VERSION);
    assert.deepStrictEqual(snapshotGameState(loaded), original);
    assert.deepStrictEqual(snapshotGameState(hydratePersistedPayload(snapshotGameState(loaded))), original);
    assert.deepStrictEqual(cloneGameState(value).playerFitness.activeSession, value.playerFitness.activeSession);
    assert.ok(Object.isFrozen(loaded.playerFitness.activeSession!.completionRewardEntitlement!.policy));
  });
  test('R1-C locked origin terms survive a different current world without recalc', () => {
    const value = createGameState();
    value.playerFitness.activeSession = locked();
    assert.notStrictEqual(value.definitionWorldId, lock().world.worldId);
    const loaded = hydratePersistedPayload(snapshotGameState(value));
    assert.deepStrictEqual(loaded.playerFitness.activeSession!.completionRewardEntitlement, lock());
    const terms = policy();
    const entitlement = lock(session(), terms);
    (terms as any).soldiersPerRewardUnitMicros = 9_000_000;
    assert.strictEqual(entitlement.soldiers, 125);
  });
  test('R1-C public active-workout projection retains immutable copied terms only when present', () => {
    const value = state(locked());
    const view = serializePublicGameState(value, value.playerFactionId);
    const projected = (view.playerGameplay as any).activeWorkout.completionRewardEntitlement;
    assert.deepStrictEqual(projected, lock());
    assert.notStrictEqual(projected, value.playerFitness.activeSession!.completionRewardEntitlement);
    assert.ok(!('completionRewardEntitlement' in (serializePublicGameState(state(), value.playerFactionId).playerGameplay as any).activeWorkout));
  });
  test('R1-C history round trips retain lock without becoming a settlement ledger', () => {
    const value = locked(completed('history-session'));
    const entry = toWorkoutHistoryEntry(value), copy = cloneWorkoutHistoryEntry(entry);
    assert.deepStrictEqual(copy.completionRewardEntitlement, value.completionRewardEntitlement);
    assert.strictEqual(copy.rewardApplicationId, null);
    for (const store of [new InMemoryWorkoutHistoryStore(), new SupabaseWorkoutHistoryStore(new MemoryWorkoutHistoryTable())]) {
      store.upsert(entry);
      const loaded = store.get(entry.playerId, entry.sessionId)!;
      assert.deepStrictEqual(loaded, entry);
      assert.notStrictEqual(loaded.completionRewardEntitlement, entry.completionRewardEntitlement);
      store.replacePlayer(entry.playerId, [loaded]);
      assert.deepStrictEqual(store.clonePlayer(entry.playerId), [entry]);
    }
    const legacy = toWorkoutHistoryEntry(completed('legacy-history'));
    assert.ok(!('completionRewardEntitlement' in cloneWorkoutHistoryEntry(legacy)));
  });
  test('R1-C history rejects a lock rebound to another session', () => {
    const entry = toWorkoutHistoryEntry(locked(completed('history-session')));
    assert.throws(() => cloneWorkoutHistoryEntry({ ...entry, sessionId: 'forged' }));
  });
  test('R1-C schema 28 migration preserves active session receipts armies bank and applied ledger', () => {
    const value = state();
    value.playerRewards.bankedTroops = 71;
    value.playerRewards.appliedRewards.push({ applicationId: 'legacy-application', sessionId: 'legacy-paid', kind: 'TROOPS',
      appliedAtTick: 0, result: { ok: true, alreadyApplied: false } });
    value.playerRewards.pendingConstructionEffects.push({ applicationId: 'legacy-workers', sessionId: 'workers-session',
      workoutId: 'workers-workout', playerId: 'contract-player', workerPower: 7.5, permanence: 'TEMPORARY_ACCELERATION',
      appliedAtTick: 0, sourcePhysicalOutput: 30 });
    value.playerRewards.pendingGoldenYieldEffects.push({ applicationId: 'legacy-yield', sessionId: 'yield-session',
      workoutId: 'yield-workout', playerId: 'contract-player', multiplier: 1.5, effect: 'ONE_TIME_COLLECTION',
      permanence: 'EPHEMERAL', consumed: false, appliedAtTick: 0, sourcePhysicalOutput: 10 });
    value.gameplaySessionLeases.push({ ...openGameplaySessionLease({ sessionId: 'gameplay-session', receiptMs: 1000 }),
      lastCommandSequence: 1, lastCommandReceipt: { sequence: 1, requestId: 'legacy-command', commandId: 'START_WORKOUT',
        success: true, payload: { sessionId: session().sessionId }, errors: [] } });
    const baseline = encodePersistable(value) as any;
    baseline.schemaVersion = 28;
    // Empire-bank migration adds zero NPC reserves and full-world knowledge.
    for (const [,f] of baseline.factions.$map) { f.bankedTroops=0;f.knownTerritories=baseline.territories.$map.map(([id]:[string,unknown])=>id);f.knownFactions=[...baseline.allFactionIds]; }
    const loaded = hydratePersistedPayload(baseline);
    assert.strictEqual(loaded.schemaVersion, GAME_STATE_SCHEMA_VERSION);
    assert.strictEqual(workoutCompletionRewardMode(loaded.playerFitness.activeSession!), 'LEGACY');
    assert.deepStrictEqual(encodePersistable(loaded), { ...baseline, schemaVersion: GAME_STATE_SCHEMA_VERSION, definitionContentFingerprint: null });
  });
  test('R1-C schema 28 pending reward migration retains identity amount and exactly-once retry', () => {
    const value = state(null), done = completed('legacy-pending');
    value.playerFactionId = null;
    const result = runWorkoutRewardPipeline(value, done, done.playerId);
    assert.strictEqual(result.ok, false);
    assert.ok(value.playerFitness.pendingReward);
    const oldReward = structuredClone(value.playerFitness.pendingReward);
    value.playerFactionId = 'iron_kingdom';
    const baseline = encodePersistable(value) as any;
    baseline.schemaVersion = 28;
    // Empire-bank migration adds zero NPC reserves and full-world knowledge.
    for (const [,f] of baseline.factions.$map) { f.bankedTroops=0;f.knownTerritories=baseline.territories.$map.map(([id]:[string,unknown])=>id);f.knownFactions=[...baseline.allFactionIds]; }
    const loaded = hydratePersistedPayload(baseline);
    assert.deepStrictEqual(encodePersistable(loaded.playerFitness.pendingReward), encodePersistable(oldReward));
    assert.deepStrictEqual(encodePersistable(loaded), { ...baseline, schemaVersion: GAME_STATE_SCHEMA_VERSION, definitionContentFingerprint: null });
    const paid = retryPendingWorkoutReward(loaded, done.playerId);
    assert.ok(paid?.ok);
    const after = snapshotGameState(loaded);
    retryPendingWorkoutReward(loaded, done.playerId);
    assert.deepStrictEqual(snapshotGameState(loaded), after);
    assert.strictEqual(loaded.playerRewards.appliedRewards.length, 1);
  });
  test('R1-C legacy schemas cannot smuggle a future entitlement', () => {
    for (const schema of [27, 28]) {
      const payload = encodePersistable(state(locked())) as any;
      payload.schemaVersion = schema;
      assert.throws(() => hydratePersistedPayload(payload), /Legacy workout session/);
    }
  });
  const corruptions: [string, (value: any) => void][] = [
    ['version', e => { e.version = 'unknown'; }],
    ['identity', e => { e.entitlementId = 'forged'; }],
    ['player binding', e => { e.playerId = 'other'; e.entitlementId = completionEntitlementId(e.playerId, e.sessionId); }],
    ['session binding', e => { e.sessionId = 'other'; e.entitlementId = completionEntitlementId(e.playerId, e.sessionId); }],
    ['workout binding', e => { e.workout.workoutId = 'other'; }],
    ['missing catalog', e => { delete e.workout.catalogId; }],
    ['size', e => { e.size = 'MEDIUM'; }],
    ['unit override', e => { e.rewardUnits = 101; }],
    ['amount', e => { e.soldiers++; }],
    ['fractional amount', e => { e.soldiers = 125.5; }],
    ['policy ratio', e => { e.policy.soldiersPerRewardUnitMicros = 0; }],
    ['policy revision', e => { e.policy.revision = ''; }],
    ['policy version', e => { e.policy.version = 'future'; }],
    ['world identity', e => { e.world.worldId = ''; }],
    ['world level', e => { e.world.level = 1.5; }],
    ['world format', e => { e.world.formatVersion = 'unsupported'; }],
    ['specialized purpose', e => { e.purpose = 'DEFENSE'; }],
    ['extra payment fields', e => { e.paid = true; }],
  ];
  for (const [name, corrupt] of corruptions) {
    test(`R1-C hydration rejects forged persisted entitlement ${name}`, () => {
      const payload = encodePersistable(state(locked())) as any;
      corrupt(payload.playerFitness.activeSession.completionRewardEntitlement);
      assert.throws(() => hydratePersistedPayload(payload), /invariants/);
    });
  }
  test('R1-C null missing or malformed nested entitlement cannot silently become legacy', () => {
    for (const bad of [null, {}, { ...lock(), policy: null }, { ...lock(), world: [] }]) {
      const payload = encodePersistable(state(locked())) as any;
      payload.playerFitness.activeSession.completionRewardEntitlement = bad;
      assert.throws(() => hydratePersistedPayload(payload), /invariants/);
      assert.throws(() => cloneWorkoutSession(payload.playerFitness.activeSession));
    }
  });
  test('R1-C session authored size and prescription identity mismatches fail invariants', () => {
    const value = state(locked());
    value.playerFitness.activeSession!.prescribedWorkout.workoutId = 'other';
    assert.ok(checkGameStateInvariants(value).some(v => v.code === 'fitness.invalid_completion_entitlement'));
    const value2 = state(locked());
    value2.playerFitness.activeSession!.authoredCatalog = { catalogId: 'fixture-catalog', catalogVersion: 'fixture.v1',
      engineVersion: 'v1', familyId: 'f', size: 'SHORT', progressionBandId: 'p' };
    assert.throws(() => snapshotGameState(value2), /invalid/);
  });
  test('R1-C CAS round trip retains immutable lock and rejects stale reward rewrite', () => {
    const store = new InMemoryGameStateStore(), value = state(locked());
    assert.ok(store.save('contract-player', value, 0).ok);
    const a = store.load('contract-player'), b = store.load('contract-player');
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) throw new Error('load failed');
    a.state.playerRewards.bankedTroops++;
    assert.ok(store.save('contract-player', a.state, a.record.stateVersion).ok);
    assert.strictEqual(store.save('contract-player', b.state, b.record.stateVersion).ok, false);
    const loaded = store.load('contract-player');
    assert.ok(loaded.ok);
    if (loaded.ok) assert.deepStrictEqual(loaded.state.playerFitness.activeSession!.completionRewardEntitlement, lock());
  });
  test('R1-C client-supplied entitlement terms cannot replace missing authoritative start data', () => {
    const orch = new Orchestrator(state(null));
    const result = orch.execute({ commandId: 'START_WORKOUT', playerId: 'contract-player', requestId: 'start-contract',
      parameters: { purpose: 'NORMAL_TROOPS', workoutId: 'wk_very_easy_mobility', intendedDifficulty: 'VERY_EASY',
        completionRewardEntitlement: lock(), soldiers: 999_999, workoutRewards: policy() } });
    assert.strictEqual(result.success, false);
    assert.strictEqual(orch.getState().playerFitness.activeSession, null);
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, 0);
  });
  test('R1-C contracts alone do not change legacy finalization amounts or settlement identity', () => {
    const value = state(null), done = completed('unchanged-payout');
    const result = runWorkoutRewardPipeline(value, done, done.playerId);
    assert.ok(result.ok);
    assert.strictEqual(value.playerRewards.bankedTroops, Math.min(10_000, Math.floor(result.physicalOutput! * 10)));
    assert.ok(value.playerRewards.appliedRewards[0]!.applicationId.includes('game-reward.v1:game-reward-config.v1'));
    const before = snapshotGameState(value);
    lock(session(), policy(9_000_000));
    assert.deepStrictEqual(snapshotGameState(value), before);
    runWorkoutRewardPipeline(value, done, done.playerId);
    assert.deepStrictEqual(snapshotGameState(value), before);
  });
}
