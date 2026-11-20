import assert from 'assert';
import { request as httpRequest } from 'node:http';
import { scenario, open, finish } from './workoutStartRewards';
import { getAuthoredWorkoutCatalog, installAuthoredWorkoutCatalog } from '../src/fitness/authoring/registry';
import { WorkoutRewardView } from '../src/rewards/workoutRewardView';
import { createSessionHost } from '../src/server/session';
import { createCommandHttpServer as createHttpServer } from '../src/server/http';
const createCommandHttpServer: typeof createHttpServer = (host, options) => createHttpServer(host, { ...options, identity: { mode: 'development' } });
import { CommandRequest, CommandResponse } from '../src/orchestration/protocol';
import { snapshotGameState } from '../src/persistence/snapshot';
import { Orchestrator } from '../src/orchestration/orchestrator';
import { createDefaultRegistry } from '../src/orchestration/engineRegistry';
import { beginWorkoutSession, completeExercise, getCurrentExercise } from '../src/fitness/session';
import { loadProductionLevel1Definition, getDefaultWorldCatalog } from '../src/worldDefinition/catalog';
import { createGameState } from '../src/state/createGameState';
import { createActiveInvasion } from '../src/types/GameState';
import { buildNextWorldState } from '../src/gameplay/worldTransition';
import { toWorkoutHistoryEntry } from '../src/fitness/history/record';

const PLAYER = 'r1-d-player';
type Scenario = ReturnType<typeof scenario>;
const command = (commandId: string, parameters: Record<string, unknown> = {}): CommandRequest => ({ commandId, playerId: PLAYER, parameters });
function reward(response: CommandResponse): WorkoutRewardView {
  assert.ok(response.success, JSON.stringify(response.errors));
  const value = response.payload.workoutReward as WorkoutRewardView;
  assert.ok(value); assert.strictEqual(value.formatVersion, 'workout-reward-view.v1');
  return value;
}
const lookup = (s: Scenario, sessionId: string) => s.host.execute(command('GET_WORKOUT_REWARD', { sessionId }));
const settle = (s: Scenario, sessionId?: string) => s.host.execute(command('FINALIZE_WORKOUT', sessionId ? { sessionId } : {}));
async function completed(s: Scenario) {
  reward(await s.host.execute(await open(s)));
  return finish(s.host, s);
}
async function wire(s: Scenario, run: (post: (body: CommandRequest) => Promise<{ response: CommandResponse; text: string; status: number }>) => Promise<void>) {
  const server = createCommandHttpServer(s.host);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('no HTTP port');
  const post = (body: CommandRequest) => new Promise<{ response: CommandResponse; text: string; status: number }>((resolve, reject) => {
    const text = JSON.stringify(body);
    const req = httpRequest({ hostname: '127.0.0.1', port: address.port, path: '/commands', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) } }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); resolve({ response: JSON.parse(text), text, status: res.statusCode! }); });
    });
    req.on('error', reject); req.end(text);
  });
  try { await run(post); } finally { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); }
}

export async function runWorkoutRewardApiTests(report: (name: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  const cases: [string, (s: Scenario) => void | Promise<void>][] = [];
  const test = (name: string, fn: (s: Scenario) => void | Promise<void>) => cases.push([name, fn]);
  for (const [size, units, soldiers] of [['SHORT', 60, 75], ['STANDARD', 100, 125], ['LONG', 145, 181]] as const) {
    test(`${size} wire start and reconnect preserve authoritative promise`, async s => {
      const req = await open(s);
      await wire(s, async post => {
        const first = await post({ ...req, parameters: { ...req.parameters, size } });
        assert.strictEqual(first.status, 200);
        const started = reward(first.response), lock = started.completionRewardEntitlement!;
        assert.strictEqual(started.workoutSize, size); assert.strictEqual(lock.rewardUnits, units);
        assert.strictEqual(lock.soldiers, soldiers); assert.strictEqual(lock.workout.workoutId, started.workoutId);
        assert.strictEqual(started.mode, 'LOCKED_COMPLETION'); assert.strictEqual(started.status, 'NOT_EARNED');
        assert.strictEqual(started.settlement, null); assert.strictEqual(started.canFinalize, false);
        assert.strictEqual(lock.policy.revision, 'test-only-revision');
        const raw = await post(command('GET_GAME_STATE'));
        const active = (raw.response.payload.gameState as any).playerGameplay.activeWorkout;
        assert.deepStrictEqual(active.workoutReward, started);
        assert.deepStrictEqual(active.completionRewardEntitlement, first.response.payload.completionRewardEntitlement);
        assert.deepStrictEqual(reward((await post(command('GET_WORKOUT_REWARD', { sessionId: started.sessionId }))).response), started);
        s.host = createSessionHost(s.persistence, { nowMs: () => 1000 });
        assert.deepStrictEqual(reward(await lookup(s, started.sessionId)), started);
      });
    });
    test(`${size} completion pays exact promise without feedback and returns original settlement`, async s => {
      reward(await s.host.execute({ ...await open(s), parameters: { purpose: 'NORMAL_TROOPS', size } }));
      const session = await finish(s.host, s);
      const unpaid = reward(await lookup(s, session.sessionId));
      assert.strictEqual(unpaid.status, 'AWAITING_SETTLEMENT'); assert.ok(unpaid.canFinalize);
      assert.ok(unpaid.canSubmitFeedback); assert.strictEqual(unpaid.feedbackState, 'FEEDBACK_REQUIRED');
      const paid = reward(await settle(s)); assert.strictEqual(paid.status, 'SETTLED');
      assert.strictEqual(paid.canFinalize, false); assert.strictEqual(paid.currentBankedTroops, soldiers);
      assert.strictEqual(paid.settlement!.applicationId, session.completionRewardEntitlement!.entitlementId);
      assert.deepStrictEqual(paid.settlement!.amountOrEffect, { kind: 'TROOPS', amount: soldiers, bankedTroopsAfter: soldiers });
      assert.deepStrictEqual(paid.completionRewardEntitlement, unpaid.completionRewardEntitlement);
      s.host = createSessionHost(s.persistence, { nowMs: () => 1000 });
      assert.deepStrictEqual(reward(await lookup(s, session.sessionId)), paid);
      const feedback = reward(await s.host.execute(command('SUBMIT_WORKOUT_FEEDBACK', { sessionId: session.sessionId, value: 'ABOUT_RIGHT', now: 20000 })));
      assert.strictEqual(feedback.canSubmitFeedback, false); assert.strictEqual(feedback.feedbackState, 'FEEDBACK_SUBMITTED');
      assert.deepStrictEqual(feedback.settlement, paid.settlement);
      assert.strictEqual(feedback.currentBankedTroops, soldiers);
    });
  }
  test('zero payout is zero even with a nonzero bank; never substitute total balance', async s => {
    s.world.workoutRewards = { ...s.world.workoutRewards!, soldiersPerRewardUnitMicros: 1 };
    getDefaultWorldCatalog().register(s.world);
    const initial = s.load(); initial.state.playerRewards.bankedTroops = 91;
    assert.ok(s.store.save(PLAYER, initial.state, initial.record.stateVersion).ok);
    const session = await completed(s); assert.strictEqual(session.completionRewardEntitlement!.soldiers, 0);
    await wire(s, async post => {
      const paid = reward((await post(command('FINALIZE_WORKOUT'))).response);
      assert.deepStrictEqual(paid.settlement!.amountOrEffect, { kind: 'TROOPS', amount: 0, bankedTroopsAfter: 91 });
      assert.strictEqual(paid.currentBankedTroops, 91); assert.strictEqual(paid.status, 'SETTLED');
    });
  });
  test('wire soldier quantities above Int32 remain exact safe integers', async s => {
    s.world.workoutRewards = { ...s.world.workoutRewards!, soldiersPerRewardUnitMicros: 50_000_000_000_000 };
    getDefaultWorldCatalog().register(s.world);
    const session = await completed(s);
    assert.strictEqual(session.completionRewardEntitlement!.soldiers, 5_000_000_000);
    await wire(s, async post => {
      const paid = reward((await post(command('FINALIZE_WORKOUT'))).response);
      assert.deepStrictEqual(paid.settlement!.amountOrEffect, { kind: 'TROOPS', amount: 5_000_000_000, bankedTroopsAfter: 5_000_000_000 });
      assert.strictEqual(paid.currentBankedTroops, 5_000_000_000);
    });
  });
  test('progress pause resume and skip replies retain the same locked terms', async s => {
    const started = reward(await s.host.execute({ ...await open(s), parameters: { purpose: 'NORMAL_TROOPS', size: 'SHORT' } }));
    const paused = reward(await s.host.execute(command('PAUSE_WORKOUT', { now: 1500 })));
    assert.strictEqual(paused.workoutState, 'PAUSED');
    assert.deepStrictEqual(paused.completionRewardEntitlement, started.completionRewardEntitlement);
    reward(await s.host.execute(command('RESUME_WORKOUT', { now: 1800 })));
    let now = 2000;
    while (s.load().state.playerFitness.activeSession!.state === 'ACTIVE') {
      const step = getCurrentExercise(s.load().state.playerFitness.activeSession!)!;
      const req = step.isRest ? command('SKIP_REST', { order: step.order, now: now += 1000 })
        : command('RECORD_EXERCISE', { order: step.order, now: now += 1000, ...(step.prescription.kind === 'repetitions'
          ? { repetitions: step.prescription.repetitions } : { durationSeconds: step.prescription.durationSeconds }) });
      const current = reward(await s.host.execute(req));
      assert.deepStrictEqual(current.completionRewardEntitlement, started.completionRewardEntitlement);
    }
    assert.strictEqual(reward(await lookup(s, started.sessionId)).status, 'AWAITING_SETTLEMENT');
  });
  test('abandoned response is not earned and cannot finalize', async s => {
    reward(await s.host.execute(await open(s)));
    const abandoned = reward(await s.host.execute(command('ABANDON_WORKOUT', { now: 1500 })));
    assert.strictEqual(abandoned.workoutState, 'ABANDONED'); assert.strictEqual(abandoned.status, 'NOT_EARNED');
    assert.strictEqual(abandoned.canFinalize, false); assert.strictEqual(abandoned.settlement, null);
  });
  test('historical lookup and feedback work after another workout replaces the paid session', async s => {
    const old = await completed(s), paid = reward(await settle(s));
    const lease = s.load().state.gameplaySessionLeases[0]!;
    reward(await s.host.execute({ commandId: 'START_WORKOUT', playerId: PLAYER, gameplaySessionId: lease.sessionId,
      requestId: 'next', renewalSequence: 2, commandSequence: 2, parameters: { purpose: 'NORMAL_TROOPS', size: 'SHORT', now: 30000 } }));
    const current = s.load().state.playerFitness.activeSession!;
    s.host = createSessionHost(s.persistence, { nowMs: () => 1000 });
    assert.deepStrictEqual(reward(await lookup(s, old.sessionId)), paid);
    const feedback = reward(await s.host.execute(command('SUBMIT_WORKOUT_FEEDBACK', { sessionId: old.sessionId, value: 'EASY', now: 40000 })));
    assert.deepStrictEqual(feedback.settlement, paid.settlement);
    assert.strictEqual(s.load().state.playerFitness.activeSession!.sessionId, current.sessionId);
  });
  test('historical lookup recovers original settlement balance separately from current balance', async s => {
    const session = await completed(s), paid = reward(await settle(s));
    const current = s.load(); current.state.playerRewards.bankedTroops = 22;
    assert.ok(s.store.save(PLAYER, current.state, current.record.stateVersion).ok);
    s.host = createSessionHost(s.persistence, { nowMs: () => 1000 });
    const view = reward(await lookup(s, session.sessionId));
    assert.deepStrictEqual(view.settlement, paid.settlement); assert.strictEqual(view.currentBankedTroops, 22);
  });
  test('read-only lookup cannot renew leases consume RNG or save state', async s => {
    const session = await completed(s), before = s.load(), saves = s.store.saveCount.value;
    const req = command('GET_WORKOUT_REWARD', { sessionId: session.sessionId });
    const result = await s.host.execute({ ...req, gameplaySessionId: before.state.gameplaySessionLeases[0]!.sessionId,
      commandSequence: 999, renewalSequence: 999 });
    reward(result); assert.strictEqual(s.store.saveCount.value, saves);
    assert.deepStrictEqual(snapshotGameState(s.load().state), snapshotGameState(before.state));
  });
  test('mutating returned reward data cannot alter persisted lock or ledger', async s => {
    const session = await completed(s), paid = reward(await settle(s));
    const original = JSON.parse(JSON.stringify(paid));
    assert.throws(() => { (paid.completionRewardEntitlement as any).soldiers = 9999; });
    (paid.settlement!.amountOrEffect as any).amount = 9999;
    assert.deepStrictEqual(reward(await lookup(s, session.sessionId)), original);
  });
  test('raw historical settlement audit is not payment authority', async s => {
    const session = await completed(s); reward(await settle(s));
    const entry = s.history.get(PLAYER, session.sessionId)!;
    const current = s.load(); current.state.playerRewards.appliedRewards = []; current.state.playerFitness.activeSession = null;
    assert.ok(s.store.save(PLAYER, current.state, current.record.stateVersion).ok);
    s.host = createSessionHost(s.persistence, { nowMs: () => 1000 });
    const view = reward(await lookup(s, entry.sessionId));
    assert.strictEqual(view.status, 'UNKNOWN'); assert.strictEqual(view.settlement, null);
    assert.strictEqual(view.canFinalize, false);
  });
  test('foreign historical and missing identities have the same wire error and reveal no terms', async s => {
    const session = await completed(s); reward(await settle(s));
    await wire(s, async post => {
      const foreign = await post({ ...command('GET_WORKOUT_REWARD', { sessionId: session.sessionId }), playerId: 'other-player' });
      const missing = await post({ ...command('GET_WORKOUT_REWARD', { sessionId: 'missing' }), playerId: 'other-player' });
      assert.strictEqual(foreign.response.success, false); assert.deepStrictEqual(foreign.response.errors, missing.response.errors);
      assert.ok(!foreign.text.includes('test-only-revision')); assert.ok(!foreign.text.includes('entitlementId'));
      for (const commandId of ['FINALIZE_WORKOUT', 'SUBMIT_WORKOUT_FEEDBACK']) {
        const attempted = await post({ commandId, playerId: 'other-player', parameters: { sessionId: session.sessionId, value: 'EASY', now: 20000 } });
        assert.strictEqual(attempted.response.success, false);
      }
      assert.strictEqual(s.load().state.playerRewards.bankedTroops, 125);
    });
  });
  test('another caller cannot read the active session even through the direct orchestrator', async s => {
    const session = await completed(s), registry = createDefaultRegistry(); registry.workoutHistory = s.history;
    const orch = new Orchestrator(s.load().state, registry);
    assert.strictEqual(orch.execute({ ...command('GET_WORKOUT_REWARD', { sessionId: session.sessionId }), playerId: 'other' }).success, false);
  });
  test('forged start and finalize reward fields cannot change promised or paid amount', async s => {
    const start = await open(s);
    const view = reward(await s.host.execute({ ...start, parameters: { ...start.parameters, soldiers: 9000, rewardUnits: 9000,
      completionRewardEntitlement: { soldiers: 9000 }, workoutReward: { status: 'SETTLED' } } }));
    await finish(s.host, s);
    const paid = reward(await s.host.execute(command('FINALIZE_WORKOUT', { amount: 9000, soldiers: 9000,
      sessionId: view.sessionId, completionRewardEntitlement: { soldiers: 9000 } })));
    assert.strictEqual(paid.currentBankedTroops, 125);
    assert.strictEqual(paid.completionRewardEntitlement!.soldiers, 125);
  });
  test('different finalize request IDs return one application identity for animation deduplication', async s => {
    const session = await completed(s), first = await settle(s);
    const second = await s.host.execute({ ...command('FINALIZE_WORKOUT', { sessionId: session.sessionId }), requestId: 'new-attempt' });
    assert.strictEqual(second.payload.alreadyProcessed, true);
    assert.deepStrictEqual(reward(second).settlement, reward(first).settlement);
    assert.strictEqual(s.load().state.playerRewards.appliedRewards.length, 1);
  });
  test('lost response replay preserves the original presentation payload after restart', async s => {
    const session = await completed(s), lease = s.load().state.gameplaySessionLeases[0]!;
    const req: CommandRequest = { ...command('FINALIZE_WORKOUT', { sessionId: session.sessionId }), requestId: 'lost',
      gameplaySessionId: lease.sessionId, commandSequence: 2, renewalSequence: 2 };
    const first = await s.host.execute(req); reward(first);
    s.host = createSessionHost(s.persistence, { nowMs: () => 1000 });
    const replay = await s.host.execute(req); assert.strictEqual(replay.idempotentReplay, true);
    assert.deepStrictEqual(replay.payload, JSON.parse(JSON.stringify(first.payload)));
    assert.strictEqual((await s.host.execute({ ...req, commandSequence: 1, requestId: 'stale' })).success, false);
    assert.strictEqual((await s.host.execute({ ...req, requestId: 'conflict' })).success, false);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, 125);
  });
  for (const problem of ['missing policy', 'invalid policy', 'missing authored catalog'] as const) {
    test(`${problem} has a clear safe wire configuration error`, async s => {
      const req = await open(s); // Bootstrap valid state before a trusted catalog update becomes invalid.
      const originalPolicy = s.world.workoutRewards;
      if (problem === 'missing policy') delete s.world.workoutRewards;
      if (problem === 'invalid policy') (s.world as any).workoutRewards = { privateDetail: 'private-proposal-config-secret', soldiersPerRewardUnitMicros: -1 };
      if (problem === 'missing authored catalog') installAuthoredWorkoutCatalog(null);
      await wire(s, async post => {
        const failed = await post(req); assert.strictEqual(failed.response.success, false);
        assert.strictEqual(failed.response.errors[0]!.code, 'WORKOUT_CONFIGURATION_UNAVAILABLE');
        assert.match(failed.response.errors[0]!.message, /authored workout size|reward policy/);
        assert.ok(!failed.text.includes('private-proposal-config-secret'));
        s.world.workoutRewards = originalPolicy; // Hydration correctly refuses invalid current world content.
        assert.strictEqual(s.load().state.playerFitness.activeSession, null);
      });
    });
  }
  test('missing and invalid session parameters are rejected without fallback to active session', async s => {
    await completed(s);
    assert.strictEqual((await s.host.execute(command('GET_WORKOUT_REWARD'))).success, false);
    assert.strictEqual((await s.host.execute(command('GET_WORKOUT_REWARD', { sessionId: 7 }))).success, false);
    assert.strictEqual((await lookup(s, 'unknown')).success, false);
  });
  for (const purpose of ['GOLDEN_YIELD', 'EXTRA_CONSTRUCTION_WORKERS'] as const) {
    test(`${purpose} is specialized and never promises ordinary soldiers`, async s => {
      const start = reward(await s.host.execute(command('START_WORKOUT', { purpose, workoutId: 'wk_easy_core', now: 1000 })));
      assert.strictEqual(start.mode, 'SPECIALIZED'); assert.strictEqual(start.completionRewardEntitlement, null);
      const session = await finish(s.host, s);
      const unpaid = reward(await lookup(s, session.sessionId)); assert.strictEqual(unpaid.canFinalize, false);
      reward(await s.host.execute(command('SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: 20000 })));
      const paid = reward(await settle(s)); assert.strictEqual(paid.settlement!.kind, purpose);
      assert.strictEqual(paid.settlement!.amountOrEffect.kind, purpose); assert.strictEqual(paid.currentBankedTroops, 0);
      assert.strictEqual(paid.canSubmitFeedback, false);
      s.host = createSessionHost(s.persistence, { nowMs: () => 1000 });
      assert.deepStrictEqual(reward(await lookup(s, session.sessionId)).settlement, paid.settlement);
    });
  }
  test('defense is presented as specialized without a normal troop promise', s => {
    const { orch } = s.direct(), state = orch.getState(), faction = state.playerFactionId!;
    state.activeInvasions.set('defense-api', createActiveInvasion({ id: 'defense-api',
      territoryId: state.factions.get(faction)!.territories[0]!, defenderFactionId: faction,
      attackerFactionId: [...state.factions.keys()].find(id => id !== faction)!, startedAtTick: 0, notifiedAtTick: 0, responseDeadlineTick: 30 }));
    const view = reward(orch.execute(command('START_WORKOUT', { purpose: 'DEFENSE', invasionId: 'defense-api', workoutId: 'wk_easy_core', now: 1000 })));
    assert.strictEqual(view.mode, 'SPECIALIZED'); assert.strictEqual(view.purpose, 'DEFENSE');
    assert.strictEqual(view.completionRewardEntitlement, null);
  });
  test('legacy normal completion keeps its own reward formula and presentation', async s => {
    const begun = beginWorkoutSession({ playerId: PLAYER, sessionId: 'legacy-api', workoutId: 'wk_easy_core',
      purpose: 'NORMAL_TROOPS', intendedDifficulty: 'EASY', now: 0 });
    assert.ok(begun.ok); if (!begun.ok) return;
    const initial = s.load(); initial.state.playerFitness.activeSession = begun.value;
    assert.ok(s.store.save(PLAYER, initial.state, initial.record.stateVersion).ok);
    const active = reward(await lookup(s, begun.value.sessionId)); assert.strictEqual(active.mode, 'LEGACY');
    assert.strictEqual(active.completionRewardEntitlement, null); assert.strictEqual(active.workoutSize, null);
    await finish(s.host, s);
    assert.strictEqual(reward(await lookup(s, begun.value.sessionId)).canFinalize, false);
    assert.strictEqual((await settle(s)).success, false);
    reward(await s.host.execute(command('SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: 20000 })));
    const paid = reward(await settle(s)); assert.strictEqual(paid.mode, 'LEGACY'); assert.strictEqual(paid.settlement!.kind, 'TROOPS');
    assert.deepStrictEqual(reward(await lookup(s, begun.value.sessionId)).settlement, paid.settlement);
  });
  test('legacy historical completion without a retained ledger is unknown, not a new claim', async s => {
    const begun = beginWorkoutSession({ playerId: PLAYER, sessionId: 'old-campaign-history', workoutId: 'wk_easy_core',
      purpose: 'NORMAL_TROOPS', intendedDifficulty: 'EASY', now: 0 });
    assert.ok(begun.ok); if (!begun.ok) return;
    let session = begun.value;
    while (session.state === 'ACTIVE') {
      const step = getCurrentExercise(session)!;
      const next = completeExercise(session, { order: step.order, ...(step.prescription.kind === 'repetitions'
        ? { repetitions: step.prescription.repetitions } : { durationSeconds: step.prescription.durationSeconds }) }, 20000);
      assert.ok(next.ok); if (!next.ok) return; session = next.value;
    }
    s.history.upsert(toWorkoutHistoryEntry(session, { rewardApplicationId: 'old-ledger-no-longer-retained', rewardKind: 'TROOPS' }));
    const view = reward(await lookup(s, session.sessionId));
    assert.strictEqual(view.mode, 'LEGACY'); assert.strictEqual(view.status, 'UNKNOWN');
    assert.strictEqual(view.settlement, null); assert.strictEqual(view.canFinalize, false);
    assert.strictEqual(view.canSubmitFeedback, false); assert.strictEqual(view.currentBankedTroops, 0);
    assert.strictEqual((await settle(s, session.sessionId)).success, false);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, 0);
  });
  test('history lookup after campaign change retains original promise and ledger result', async s => {
    const session = await completed(s), paid = reward(await settle(s));
    const loaded = loadProductionLevel1Definition(); assert.ok(loaded.ok); if (!loaded.ok) return;
    const state = createGameState({ world: loaded.definition, seed: 17 });
    for (const territory of state.territories.values()) territory.owner = state.playerFactionId;
    for (const faction of state.factions.values()) faction.territories = [...state.territories.values()].filter(t => t.owner === faction.id).map(t => t.id);
    state.playerRewards.appliedRewards = s.load().state.playerRewards.appliedRewards;
    state.playerFitness.activeSession = s.load().state.playerFitness.activeSession;
    const next = buildNextWorldState(state).next!, registry = createDefaultRegistry(); registry.workoutHistory = s.history;
    const view = reward(new Orchestrator(next, registry).execute(command('GET_WORKOUT_REWARD', { sessionId: session.sessionId })));
    assert.deepStrictEqual(view.settlement, paid.settlement);
    assert.deepStrictEqual(view.completionRewardEntitlement, paid.completionRewardEntitlement);
    assert.strictEqual(view.currentBankedTroops, 0); assert.strictEqual(view.status, 'SETTLED');
  });
  test('failed settlement response remains visibly unpaid and retryable', async s => {
    await completed(s);
    const current = s.load(); current.state.playerRewards.bankedTroops = Number.MAX_SAFE_INTEGER;
    assert.ok(s.store.save(PLAYER, current.state, current.record.stateVersion).ok);
    s.host = createSessionHost(s.persistence, { nowMs: () => 1000 });
    const failed = await settle(s); assert.strictEqual(failed.success, false);
    const view = failed.payload.workoutReward as WorkoutRewardView;
    assert.strictEqual(view.status, 'AWAITING_SETTLEMENT'); assert.strictEqual(view.settlement, null);
    assert.strictEqual(view.canFinalize, true); assert.strictEqual(view.currentBankedTroops, Number.MAX_SAFE_INTEGER);
  });
  test('world and catalog changes cannot alter reconnect reward presentation', async s => {
    const session = await completed(s), original = reward(await lookup(s, session.sessionId));
    s.world.workoutRewards = { ...s.world.workoutRewards!, revision: 'later', soldiersPerRewardUnitMicros: 9_000_000 };
    getDefaultWorldCatalog().register(s.world); installAuthoredWorkoutCatalog(null);
    s.host = createSessionHost(s.persistence, { nowMs: () => 1000 });
    assert.deepStrictEqual(reward(await lookup(s, session.sessionId)), original);
    assert.strictEqual(reward(await settle(s)).currentBankedTroops, 125);
  });
  for (const [name, fn] of cases) await report(`R1-F: ${name}`, async () => {
    const previous = getAuthoredWorkoutCatalog();
    try { await fn(scenario()); } finally { installAuthoredWorkoutCatalog(previous); }
  });
}
