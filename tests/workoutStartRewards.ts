import assert from 'assert';
import { request as httpRequest } from 'node:http';
import { compileAuthoringDocument } from '../src/fitness/authoring/compile';
import { sampleAuthoringDocumentV2 } from '../src/fitness/authoring/fixture';
import { getAuthoredWorkoutCatalog, installAuthoredWorkoutCatalog } from '../src/fitness/authoring/registry';
import { beginWorkoutSession, completeExercise, getCurrentExercise, submitWorkoutFeedback } from '../src/fitness/session';
import { WorkoutSession } from '../src/fitness/session/types';
import { InMemoryWorkoutHistoryStore } from '../src/fitness/history/inMemoryStore';
import { loadProductionLevel2Definition, getDefaultWorldCatalog } from '../src/worldDefinition/catalog';
import { validateWorldDefinition } from '../src/worldDefinition/validate';
import { createGameState } from '../src/state/createGameState';
import { cloneGameState } from '../src/state/cloneGameState';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { snapshotGameState } from '../src/persistence/snapshot';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { createInMemoryPersistence, PlayerWorldPersistence } from '../src/server/persistencePort';
import { createSessionHost } from '../src/server/session';
import { createCommandHttpServer } from '../src/server/http';
import { Orchestrator } from '../src/orchestration/orchestrator';
import { CommandRequest, CommandResponse } from '../src/orchestration/protocol';
import { openGameplaySessionLease } from '../src/world/presenceLeases';
import { CompletionRewardEntitlement } from '../src/rewards/completionEntitlement';
import { createActiveInvasion } from '../src/types/GameState';
import { createTelemetryRecorder } from '../src/analytics/recorder';
import { encodePersistable } from '../src/persistence/serialization';
import { runWorkoutRewardPipeline } from '../src/rewards/pipeline/runWorkoutRewardPipeline';

const PLAYER = 'r1-d-player';
const WORLD = 'w_r1_d_contract_fixture';
const policy = (ratio = 1_250_000) => ({ version: 'workout-soldiers.v1' as const, revision: 'test-only-revision', soldiersPerRewardUnitMicros: ratio });

export function scenario() {
  const loaded = loadProductionLevel2Definition();
  if (!loaded.ok) throw new Error('fixture world unavailable');
  const world = structuredClone(loaded.definition);
  world.worldId = WORLD;
  for (const region of world.regions) region.worldId = WORLD;
  world.workoutRewards = policy(); // Synthetic test ratio only, never production content.
  assert.deepStrictEqual(validateWorldDefinition(world), []);
  getDefaultWorldCatalog().register(world);
  const compiled = compileAuthoringDocument(sampleAuthoringDocumentV2());
  if (!compiled.ok || !compiled.catalog) throw new Error('fixture catalog unavailable');
  installAuthoredWorkoutCatalog(compiled.catalog);
  const state = createGameState({ world, seed: 17 });
  const store = new InMemoryGameStateStore(), history = new InMemoryWorkoutHistoryStore();
  assert.ok(store.save(PLAYER, state, 0).ok);
  const persistence = createInMemoryPersistence(store, history);
  const host = createSessionHost(persistence, { nowMs: () => 1000 });
  function load() {
    const result = store.load(PLAYER);
    if (!result.ok) throw new Error(result.message);
    return result;
  }
  function direct() {
    const value = cloneGameState(state);
    value.gameplaySessionLeases = [openGameplaySessionLease({ sessionId: 'server-fixture-lease', receiptMs: 0 })];
    const orch = new Orchestrator(value);
    const req: CommandRequest = { commandId: 'START_WORKOUT', playerId: PLAYER, requestId: 'start',
      gameplaySessionId: 'server-fixture-lease', commandSequence: 1, renewalSequence: 1,
      parameters: { purpose: 'NORMAL_TROOPS', size: 'STANDARD', now: 1000 } };
    return { orch, req };
  }
  return { world, catalog: compiled.catalog, state, store, history, persistence, host, load, direct };
}
type Scenario = ReturnType<typeof scenario>;
function entitlement(response: CommandResponse): CompletionRewardEntitlement {
  assert.strictEqual(response.success, true, JSON.stringify(response.errors));
  const value = response.payload.completionRewardEntitlement as CompletionRewardEntitlement;
  assert.ok(value);
  return value;
}
export async function open(s: Scenario) {
  const opened = await s.host.openGameplaySession(PLAYER, 'open');
  return { commandId: 'START_WORKOUT', playerId: PLAYER, requestId: 'start', gameplaySessionId: opened.sessionId,
    commandSequence: 1, renewalSequence: 1, parameters: { purpose: 'NORMAL_TROOPS', size: 'STANDARD', now: 1000 } } as CommandRequest;
}
export async function finish(host: ReturnType<typeof createSessionHost>, s: Scenario): Promise<WorkoutSession> {
  let now = 2000;
  while (s.load().state.playerFitness.activeSession?.state === 'ACTIVE') {
    const session = s.load().state.playerFitness.activeSession!, step = getCurrentExercise(session)!;
    const response = await host.execute({ commandId: 'RECORD_EXERCISE', playerId: PLAYER,
      parameters: { order: step.order, now: now += 1000, ...(step.prescription.kind === 'repetitions'
        ? { repetitions: step.prescription.repetitions } : { durationSeconds: step.prescription.durationSeconds }) } });
    assert.ok(response.success, JSON.stringify(response.errors));
  }
  return s.load().state.playerFitness.activeSession!;
}

/** Sequential async reporting is intentional: each case temporarily installs authoritative test content. */
export async function runWorkoutStartRewardTests(report: (name: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  const cases: [string, (s: Scenario) => void | Promise<void>][] = [];
  const test = (name: string, run: (s: Scenario) => void | Promise<void>) => cases.push([name, run]);
  for (const [size, units, soldiers] of [['SHORT', 60, 75], ['STANDARD', 100, 125], ['LONG', 145, 181]] as const) {
    test(`${size} locks ${units} authoritative units with half-up fixed-point soldiers`, async s => {
      const req = await open(s);
      const response = await s.host.execute({ ...req, parameters: { ...req.parameters, size } });
      const locked = entitlement(response);
      assert.strictEqual(locked.size, size); assert.strictEqual(locked.rewardUnits, units); assert.strictEqual(locked.soldiers, soldiers);
      assert.strictEqual(locked.world.worldId, WORLD);
      assert.strictEqual(locked.workout.workoutId, response.payload.workoutId);
      assert.deepStrictEqual(s.load().state.playerFitness.activeSession!.completionRewardEntitlement, locked);
      assert.strictEqual(s.load().state.playerRewards.bankedTroops, 0);
      assert.deepStrictEqual(checkGameStateInvariants(s.load().state), []);
    });
  }
  test('explicit workout size wins over forged client size reward units ratio and entitlement', s => {
    const { orch, req } = s.direct();
    const response = orch.execute({ ...req, parameters: { ...req.parameters, workoutId: 'aw_foundations_long', size: 'SHORT',
      rewardUnits: 999999, soldiers: 999999, ratio: 99, workoutRewards: policy(999999), completionRewardEntitlement: { soldiers: 999999 } } });
    const locked = entitlement(response);
    assert.strictEqual(locked.size, 'LONG'); assert.strictEqual(locked.rewardUnits, 145); assert.strictEqual(locked.soldiers, 181);
    assert.strictEqual((response.payload.selection as any).size, 'LONG');
  });
  test('explicit movement readiness bypass is rejected atomically', s => {
    const { orch, req } = s.direct(), before = snapshotGameState(orch.getState());
    const result = orch.execute({ ...req, parameters: { ...req.parameters, workoutId: 'aw_squat_stage2' } });
    assert.strictEqual(result.success, false); assert.match(result.errors[0]!.message, /eligible/);
    assert.deepStrictEqual(snapshotGameState(orch.getState()), before);
  });
  test('explicit workout becomes eligible after its own movement readiness changes', s => {
    const { orch, req } = s.direct();
    orch.getState().playerFitness.progression.movementReadiness.mf_squat = 'ms_sq_2';
    const locked = entitlement(orch.execute({ ...req, parameters: { ...req.parameters, workoutId: 'aw_squat_stage2' } }));
    assert.strictEqual(locked.workout.workoutId, 'aw_squat_stage2'); assert.strictEqual(locked.rewardUnits, 100);
  });
  test('explicit future-band workout cannot bypass progression window', s => {
    const { orch, req } = s.direct();
    const result = orch.execute({ ...req, parameters: { ...req.parameters, workoutId: 'aw_band2a_standard' } });
    assert.strictEqual(result.success, false); assert.match(result.errors[0]!.message, /eligible/);
  });
  test('authored ID collision with a tutorial workout cannot bypass readiness', s => {
    s.catalog.workouts.wk_moderate_full_body = { ...s.catalog.workouts.aw_squat_stage2!, id: 'wk_moderate_full_body' };
    const orch = new Orchestrator(createGameState());
    const result = orch.execute({ commandId: 'START_WORKOUT', playerId: PLAYER,
      parameters: { purpose: 'NORMAL_TROOPS', workoutId: 'wk_moderate_full_body', now: 1000 } });
    assert.strictEqual(result.success, false); assert.match(result.errors[0]!.message, /eligible/);
    assert.strictEqual(orch.getState().playerFitness.activeSession, null);
  });
  test('missing world policy fails without legacy payout fallback or state mutation', s => {
    delete s.world.workoutRewards;
    const { orch, req } = s.direct(), before = snapshotGameState(orch.getState());
    const result = orch.execute(req);
    assert.strictEqual(result.success, false); assert.match(result.errors[0]!.message, /reward policy/);
    assert.deepStrictEqual(snapshotGameState(orch.getState()), before);
  });
  test('malformed world policy is rejected even in a trusted catalog registration', s => {
    (s.world as any).workoutRewards = { ...policy(), soldiersPerRewardUnitMicros: '2' };
    const { orch, req } = s.direct();
    assert.strictEqual(orch.execute(req).success, false);
    assert.strictEqual(orch.getState().playerFitness.activeSession, null);
  });
  test('legacy workout has no inferred reward size even with a valid world policy', s => {
    const { orch, req } = s.direct();
    const result = orch.execute({ ...req, parameters: { ...req.parameters, workoutId: 'wk_very_easy_mobility', size: 'LONG' } });
    assert.strictEqual(result.success, false); assert.match(result.errors[0]!.message, /authored workout size/);
  });
  test('new locks require existing durable gameplay command identity', s => {
    const { orch, req } = s.direct();
    for (const changes of [{ gameplaySessionId: undefined }, { gameplaySessionId: 'forged' }, { commandSequence: undefined },
      { commandSequence: 0 }, { commandSequence: 0.5 }, { commandSequence: Number.MAX_SAFE_INTEGER + 1 }]) {
      assert.strictEqual(orch.execute({ ...req, ...changes }).success, false);
      assert.strictEqual(orch.getState().playerFitness.activeSession, null);
    }
  });
  test('client workout session IDs cannot choose collision identities', s => {
    const a = s.direct(), b = s.direct();
    const first = entitlement(a.orch.execute({ ...a.req, parameters: { ...a.req.parameters, sessionId: 'forged-id', now: 17 } }));
    const second = entitlement(b.orch.execute({ ...b.req, parameters: { ...b.req.parameters, sessionId: 'other-id', now: 99999 } }));
    assert.strictEqual(first.sessionId, second.sessionId); assert.deepStrictEqual(first, second);
    assert.notStrictEqual(first.sessionId, 'forged-id');
  });
  test('identical canonical inputs and command identity replay identical complete state', s => {
    const a = s.direct(), b = s.direct();
    assert.deepStrictEqual(a.orch.execute(a.req), b.orch.execute(b.req));
    assert.deepStrictEqual(snapshotGameState(a.orch.getState()), snapshotGameState(b.orch.getState()));
  });
  test('exercise progress pause resume feedback and client terms cannot alter a lock', async s => {
    const locked = entitlement(await s.host.execute(await open(s)));
    for (const commandId of ['PAUSE_WORKOUT', 'RESUME_WORKOUT']) {
      const response = await s.host.execute({ commandId, playerId: PLAYER, parameters: { now: 1500, completionRewardEntitlement: { soldiers: 9999 } } });
      assert.ok(response.success);
    }
    const done = await finish(s.host, s);
    assert.strictEqual(done.state, 'COMPLETED');
    assert.deepStrictEqual(done.completionRewardEntitlement, locked);
    const feedback = await s.host.execute({ commandId: 'SUBMIT_WORKOUT_FEEDBACK', playerId: PLAYER,
      parameters: { value: 'ABOUT_RIGHT', now: 20000, soldiers: 99999 } });
    assert.ok(feedback.success);
    assert.deepStrictEqual(s.load().state.playerFitness.activeSession!.completionRewardEntitlement, locked);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, 0);
  });
  test('world policy catalog and readiness changes cannot reprice progress or reload', async s => {
    const locked = entitlement(await s.host.execute(await open(s)));
    s.world.workoutRewards = { ...policy(9_000_000), revision: 'changed' };
    s.catalog.catalogVersion = 'changed'; s.catalog.workouts[locked.workout.workoutId]!.size = 'LONG';
    const saved = s.load(); saved.state.playerFitness.progression.movementReadiness.mf_squat = 'ms_sq_3';
    assert.ok(s.store.save(PLAYER, saved.state, saved.record.stateVersion).ok);
    const reconnected = createSessionHost(s.persistence, { nowMs: () => 1000 });
    const view = await reconnected.execute({ commandId: 'GET_GAME_STATE', playerId: PLAYER });
    assert.deepStrictEqual((view.payload.gameState as any).playerGameplay.activeWorkout.completionRewardEntitlement, locked);
    await finish(reconnected, s);
    assert.deepStrictEqual(s.load().state.playerFitness.activeSession!.completionRewardEntitlement, locked);
  });
  test('duplicate start returns committed exact lock after lost response and policy change', async s => {
    const req = await open(s), first = await s.host.execute(req), locked = entitlement(first);
    const before = snapshotGameState(s.load().state);
    s.world.workoutRewards = policy(8_000_000);
    const retry = await createSessionHost(s.persistence, { nowMs: () => 1000 }).execute({ ...req,
      parameters: { purpose: 'NORMAL_TROOPS', size: 'LONG', sessionId: 'retry-forgery', soldiers: 99999 } });
    assert.strictEqual(retry.idempotentReplay, true); assert.deepStrictEqual(retry.payload, JSON.parse(JSON.stringify(first.payload)));
    assert.deepStrictEqual(s.load().state.playerFitness.activeSession!.completionRewardEntitlement, locked);
    assert.deepStrictEqual(snapshotGameState(s.load().state), before);
  });
  test('stale and conflicting command attempts cannot replace an entitlement', async s => {
    const req = await open(s), locked = entitlement(await s.host.execute({ ...req, commandSequence: 5 }));
    for (const changed of [{ commandSequence: 4 }, { commandSequence: 5, requestId: 'different' }, { commandSequence: 6 }]) {
      assert.strictEqual((await s.host.execute({ ...req, ...changed })).success, false);
      assert.deepStrictEqual(s.load().state.playerFitness.activeSession!.completionRewardEntitlement, locked);
    }
  });
  test('failed transaction leaves no orphan and retry uses same server identity', s => {
    const { orch, req } = s.direct(), before = snapshotGameState(orch.getState());
    s.world.workoutRewards = undefined;
    assert.strictEqual(orch.execute(req).success, false);
    assert.deepStrictEqual(snapshotGameState(orch.getState()), before);
    s.world.workoutRewards = policy();
    const locked = entitlement(orch.execute(req));
    const clean = s.direct();
    assert.deepStrictEqual(entitlement(clean.orch.execute(clean.req)), locked);
  });
  test('failed persistence consumes neither identity nor a durable lock; retry succeeds', async s => {
    const req = await open(s), before = snapshotGameState(s.load().state);
    let fail = true;
    const broken: PlayerWorldPersistence = { ...s.persistence, save: (...args) => fail
      ? { ok: false, code: 'persistence.save_failed', message: 'injected failure', persisted: false } : s.persistence.save(...args) };
    const host = createSessionHost(broken, { nowMs: () => 1000 });
    await assert.rejects(host.execute(req), /injected failure/);
    assert.deepStrictEqual(snapshotGameState(s.load().state), before);
    fail = false;
    const locked = entitlement(await host.execute(req));
    assert.strictEqual(locked.sessionId, `wses_reward:${JSON.stringify([PLAYER, req.gameplaySessionId, 1])}`);
  });
  test('CAS loser cannot leave another committed lock or overwrite the winner', async s => {
    const req = await open(s);
    const competing = createSessionHost(s.persistence, { nowMs: () => 1000 });
    await competing.execute({ commandId: 'GET_GAME_STATE', playerId: PLAYER }); // Cache the same pre-start version.
    const first = await s.host.execute(req), committed = s.load();
    const before = snapshotGameState(committed.state);
    s.world.workoutRewards = policy(9_000_000);
    await assert.rejects(competing.execute(req), /Stale world write/);
    const result = await competing.execute(req);
    assert.deepStrictEqual(result.payload, JSON.parse(JSON.stringify(first.payload)));
    assert.deepStrictEqual(snapshotGameState(s.load().state), before);
  });
  test('half-unit boundaries use the R1-C integer rounding helper at start', s => {
    for (const [ratio, amount] of [[24_999, 1], [25_000, 2], [25_001, 2]]) {
      s.world.workoutRewards = policy(ratio);
      const { orch, req } = s.direct();
      const locked = entitlement(orch.execute({ ...req, parameters: { ...req.parameters, workoutId: 'aw_foundations_short' } }));
      assert.strictEqual(locked.soldiers, amount);
    }
  });
  test('post-lock invariant failure rolls back the whole session and identity', s => {
    const { orch, req } = s.direct();
    orch.getState().playerRewards.bankedTroops = -1;
    const before = encodePersistable(orch.getState());
    assert.strictEqual(orch.execute(req).success, false);
    assert.deepStrictEqual(encodePersistable(orch.getState()), before);
    orch.getState().playerRewards.bankedTroops = 0;
    const locked = entitlement(orch.execute(req)), clean = s.direct();
    assert.deepStrictEqual(entitlement(clean.orch.execute(clean.req)), locked);
  });
  test('normal-start telemetry retains selected-before-started causal order', s => {
    const direct = s.direct(), recorder = createTelemetryRecorder();
    const orch = new Orchestrator(direct.orch.getState(), undefined, recorder);
    const locked = entitlement(orch.execute(direct.req));
    const types = recorder.getEvents({ sessionId: locked.sessionId }).map(e => e.eventType);
    assert.ok(types.includes('workout.selected') && types.includes('workout.started'));
    assert.ok(types.indexOf('workout.selected') < types.indexOf('workout.started'));
  });
  test('difficulty feedback and claimed fitness multipliers cannot alter soldier units', s => {
    const a = s.direct(), b = s.direct();
    const base = entitlement(a.orch.execute(a.req));
    const other = entitlement(b.orch.execute({ ...b.req, parameters: { ...b.req.parameters, intendedDifficulty: 'VERY_HARD',
      confidence: 1, fitnessLevel: 100, speed: 100, frequency: 100, feedback: 'TOO_EASY', rewardUnitOverride: 9999 } }));
    assert.deepStrictEqual(other, base);
  });
  test('existing paid identities cannot be reused by any new normal start', s => {
    const { orch, req } = s.direct();
    const id = `wses_reward:${JSON.stringify([PLAYER, req.gameplaySessionId, 1])}`;
    orch.getState().playerRewards.appliedRewards.push({ applicationId: 'historical-payment', sessionId: id, kind: 'TROOPS',
      appliedAtTick: 0, result: { ok: true } });
    const before = snapshotGameState(orch.getState());
    assert.strictEqual(orch.execute(req).success, false);
    assert.deepStrictEqual(snapshotGameState(orch.getState()), before);
  });
  test('legacy active session still completes and pays its original amount exactly once after reload', async s => {
    const created = beginWorkoutSession({ playerId: PLAYER, sessionId: 'legacy-existing', workoutId: 'wk_very_easy_mobility',
      purpose: 'NORMAL_TROOPS', intendedDifficulty: 'VERY_EASY', now: 1000 });
    if (!created.ok) throw new Error(created.error.message);
    const saved = s.load(); saved.state.playerFitness.activeSession = created.value;
    assert.ok(s.store.save(PLAYER, saved.state, saved.record.stateVersion).ok);
    const req = await open(s);
    assert.strictEqual((await s.host.execute(req)).success, false);
    await finish(s.host, s);
    assert.ok((await s.host.execute({ commandId: 'SUBMIT_WORKOUT_FEEDBACK', playerId: PLAYER,
      parameters: { value: 'ABOUT_RIGHT', now: 10000 } })).success);
    const finalize: CommandRequest = { ...req, commandId: 'FINALIZE_WORKOUT', requestId: 'legacy-finalize', commandSequence: 2, parameters: { now: 11000 } };
    const response = await s.host.execute(finalize);
    assert.ok(response.success, JSON.stringify(response.errors));
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, Math.floor(Number(response.payload.physicalOutput) * 10));
    const before = snapshotGameState(s.load().state);
    const replay = await createSessionHost(s.persistence, { nowMs: () => 1000 }).execute(finalize);
    assert.strictEqual(replay.idempotentReplay, true);
    assert.deepStrictEqual(snapshotGameState(s.load().state), before);
  });
  test('an existing pending legacy reward blocks all replacement workouts', s => {
    const { orch, req } = s.direct();
    const created = beginWorkoutSession({ playerId: PLAYER, sessionId: 'legacy-pending', workoutId: 'wk_very_easy_mobility',
      purpose: 'NORMAL_TROOPS', intendedDifficulty: 'VERY_EASY', now: 1000 });
    if (!created.ok) throw new Error(created.error.message);
    let session = created.value, now = 1000;
    while (session.state === 'ACTIVE') {
      const step = getCurrentExercise(session)!;
      const next = completeExercise(session, { order: step.order, durationSeconds: step.prescription.kind === 'duration' ? step.prescription.durationSeconds : 0 }, now += 1000);
      if (!next.ok) throw new Error(next.error.message); session = next.value;
    }
    const feedback = submitWorkoutFeedback(session, 'ABOUT_RIGHT', now + 1000);
    if (!feedback.ok) throw new Error(feedback.error.message);
    const state = orch.getState(), player = state.playerFactionId;
    state.playerFactionId = null;
    assert.strictEqual(runWorkoutRewardPipeline(state, feedback.value, PLAYER).ok, false);
    state.playerFactionId = player;
    assert.ok(state.playerFitness.pendingReward);
    const before = snapshotGameState(state);
    assert.strictEqual(orch.execute(req).success, false);
    assert.deepStrictEqual(snapshotGameState(orch.getState()), before);
  });
  test('unpaid completed lock cannot be replaced and settles only its locked amount', async s => {
    const req = await open(s), locked = entitlement(await s.host.execute(req));
    await finish(s.host, s);
    for (const parameters of [{ purpose: 'NORMAL_TROOPS', size: 'LONG' }, { purpose: 'GOLDEN_YIELD' }, { purpose: 'EXTRA_CONSTRUCTION_WORKERS' }]) {
      const result = await s.host.execute({ ...req, commandSequence: 2, requestId: 'replacement', parameters });
      assert.strictEqual(result.success, false); assert.match(result.errors[0]!.message, /settled/);
    }
    const result = await s.host.execute({ commandId: 'FINALIZE_WORKOUT', playerId: PLAYER });
    assert.strictEqual(result.success, true);
    const state = s.load().state;
    assert.strictEqual(state.playerRewards.bankedTroops, locked.soldiers); assert.strictEqual(state.playerRewards.appliedRewards.length, 1);
    assert.strictEqual(state.playerFitness.pendingReward, null);
    assert.deepStrictEqual(state.playerFitness.activeSession!.completionRewardEntitlement, locked);
  });
  test('unpaid completed legacy session cannot be discarded by START_WORKOUT', s => {
    const { orch, req } = s.direct();
    const value = beginWorkoutSession({ playerId: PLAYER, sessionId: 'legacy-unpaid', workoutId: 'wk_very_easy_mobility',
      purpose: 'NORMAL_TROOPS', intendedDifficulty: 'VERY_EASY', now: 0 });
    if (!value.ok) throw new Error('legacy fixture failed');
    orch.getState().playerFitness.activeSession = { ...value.value, state: 'COMPLETED' };
    const before = snapshotGameState(orch.getState());
    assert.strictEqual(orch.execute(req).success, false); assert.deepStrictEqual(snapshotGameState(orch.getState()), before);
  });
  test('abandoned locked workout can be replaced only by a fresh server identity', async s => {
    const req = await open(s), first = entitlement(await s.host.execute(req));
    assert.ok((await s.host.execute({ ...req, commandId: 'ABANDON_WORKOUT', requestId: 'abandon', commandSequence: 2, parameters: { now: 1500 } })).success);
    const second = entitlement(await s.host.execute({ ...req, requestId: 'fresh', commandSequence: 3,
      parameters: { ...req.parameters, sessionId: first.sessionId } }));
    assert.notStrictEqual(second.sessionId, first.sessionId); assert.notStrictEqual(second.entitlementId, first.entitlementId);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, 0);
  });
  test('specialized workout cannot impersonate the server reward-session namespace', async s => {
    const req = await open(s);
    const result = await s.host.execute({ ...req, parameters: { purpose: 'GOLDEN_YIELD', sessionId: 'wses_reward:forged' } });
    assert.strictEqual(result.success, false); assert.strictEqual(s.load().state.playerFitness.activeSession, null);
  });
  test('same-instant specialized starts allocate fresh default identities without a waiting gate', s => {
    const { orch } = s.direct();
    const req: CommandRequest = { commandId: 'START_WORKOUT', playerId: PLAYER,
      parameters: { purpose: 'GOLDEN_YIELD', workoutId: 'wk_very_easy_mobility', now: 1000 } };
    const first = orch.execute(req); assert.ok(first.success, JSON.stringify(first.errors));
    assert.ok(orch.execute({ commandId: 'ABANDON_WORKOUT', playerId: PLAYER, parameters: { now: 1000 } }).success);
    const second = orch.execute(req); assert.ok(second.success, JSON.stringify(second.errors));
    assert.notStrictEqual(second.payload.sessionId, first.payload.sessionId);
    assert.strictEqual(orch.getState().worldTick, 0);
  });
  test('a fresh default defense identity stays bound to the invasion after a clock collision', s => {
    const { orch } = s.direct(), value = orch.getState(), player = value.playerFactionId!;
    const prior = orch.execute({ commandId: 'START_WORKOUT', playerId: PLAYER,
      parameters: { purpose: 'GOLDEN_YIELD', workoutId: 'wk_very_easy_mobility', now: 1000 } });
    assert.ok(prior.success);
    assert.ok(orch.execute({ commandId: 'ABANDON_WORKOUT', playerId: PLAYER, parameters: { now: 1000 } }).success);
    const current = orch.getState();
    current.activeInvasions.set('fresh-defense', createActiveInvasion({ id: 'fresh-defense', territoryId: current.factions.get(player)!.territories[0]!,
      defenderFactionId: player, attackerFactionId: [...current.factions.keys()].find(id => id !== player)!,
      startedAtTick: 0, notifiedAtTick: 0, responseDeadlineTick: 30 }));
    const defense = orch.execute({ commandId: 'START_WORKOUT', playerId: PLAYER,
      parameters: { purpose: 'DEFENSE', invasionId: 'fresh-defense', workoutId: 'wk_very_easy_mobility', now: 1000 } });
    assert.ok(defense.success, JSON.stringify(defense.errors));
    assert.notStrictEqual(defense.payload.sessionId, prior.payload.sessionId);
    assert.strictEqual(orch.getState().activeInvasions.get('fresh-defense')!.defenseSessionId, defense.payload.sessionId);
    assert.strictEqual(orch.getState().playerFitness.activeSession!.sessionId, defense.payload.sessionId);
    assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
  });
  for (const purpose of ['GOLDEN_YIELD', 'EXTRA_CONSTRUCTION_WORKERS'] as const) {
    test(`${purpose} starts without a normal entitlement or world policy`, async s => {
      delete s.world.workoutRewards;
      const response = await s.host.execute({ commandId: 'START_WORKOUT', playerId: PLAYER,
        parameters: { purpose, workoutId: 'wk_very_easy_mobility', sessionId: purpose, now: 1000 } });
      assert.ok(response.success, JSON.stringify(response.errors));
      assert.ok(!('completionRewardEntitlement' in response.payload));
      assert.strictEqual(s.load().state.playerFitness.activeSession!.completionRewardEntitlement, undefined);
    });
  }
  test('defense keeps the inclusive 30-minute start window and creates no normal entitlement', s => {
    const { orch } = s.direct(), value = orch.getState();
    const player = value.playerFactionId!, target = value.factions.get(player)!.territories[0]!;
    const other = [...value.factions.keys()].find(id => id !== player)!;
    value.activeInvasions.set('defense-fixture', createActiveInvasion({ id: 'defense-fixture', territoryId: target,
      defenderFactionId: player, attackerFactionId: other, startedAtTick: 0, notifiedAtTick: 0, responseDeadlineTick: 30 }));
    value.worldTick = value.accruedTargetWorldTick = 30;
    const response = orch.execute({ commandId: 'START_WORKOUT', playerId: PLAYER, parameters: { purpose: 'DEFENSE',
      workoutId: 'wk_very_easy_mobility', invasionId: 'defense-fixture', sessionId: 'fresh-defense', now: 1000 } });
    assert.ok(response.success, JSON.stringify(response.errors));
    assert.strictEqual(orch.getState().playerFitness.activeSession!.completionRewardEntitlement, undefined);
    assert.ok(orch.getState().activeInvasions.get('defense-fixture')!.defenseCompletionDeadlineTick! > 30);
  });
  test('defense after its start window or a second defense cannot reuse a prior workout', s => {
    const { orch } = s.direct(), value = orch.getState(), player = value.playerFactionId!;
    value.activeInvasions.set('late-defense', createActiveInvasion({ id: 'late-defense', territoryId: value.factions.get(player)!.territories[0]!,
      defenderFactionId: player, attackerFactionId: [...value.factions.keys()].find(id => id !== player)!, startedAtTick: 0, notifiedAtTick: 0, responseDeadlineTick: 30 }));
    value.worldTick = value.accruedTargetWorldTick = 31;
    assert.strictEqual(orch.execute({ commandId: 'START_WORKOUT', playerId: PLAYER, parameters: { purpose: 'DEFENSE', invasionId: 'late-defense',
      workoutId: 'wk_very_easy_mobility' } }).success, false);
  });
  test('HTTP wire body exposes only server-calculated lock and active-session terms', async s => {
    const req = await open(s), server = createCommandHttpServer(s.host);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('port');
      const wire = JSON.stringify({ ...req, parameters: { ...req.parameters, soldiers: 999999, sessionId: 'client-wire-id' } });
      const response = await new Promise<CommandResponse>((resolve, reject) => {
        const request = httpRequest({ hostname: '127.0.0.1', port: address.port, path: '/commands', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(wire) } }, res => {
          let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
        }); request.on('error', reject); request.end(wire);
      });
      const locked = entitlement(response); assert.strictEqual(locked.soldiers, 125);
      assert.notStrictEqual(locked.sessionId, 'client-wire-id');
      const view = await s.host.execute({ commandId: 'GET_GAME_STATE', playerId: PLAYER });
      assert.deepStrictEqual((view.payload.gameState as any).playerGameplay.activeWorkout.completionRewardEntitlement, locked);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
  for (const [name, run] of cases) {
    await report(`R1-D ${name}`, async () => {
      const previous = getAuthoredWorkoutCatalog();
      try { await run(scenario()); } finally { installAuthoredWorkoutCatalog(previous); }
    });
  }
}
