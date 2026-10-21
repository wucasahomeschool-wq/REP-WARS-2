import assert from 'assert';
import { scenario, open, finish } from './workoutStartRewards';
import { getAuthoredWorkoutCatalog, installAuthoredWorkoutCatalog } from '../src/fitness/authoring/registry';
import { buildNextWorldState, evaluateWorldTransition } from '../src/gameplay/worldTransition';
import { loadProductionLevel1Definition } from '../src/worldDefinition/catalog';
import { createGameState } from '../src/state/createGameState';
import { cloneGameState } from '../src/state/cloneGameState';
import { snapshotGameState } from '../src/persistence/snapshot';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { CommandRequest } from '../src/orchestration/protocol';
import { createSessionHost } from '../src/server/session';
import { beginWorkoutSession, completeExercise, getCurrentExercise, submitWorkoutFeedback } from '../src/fitness/session';
import { WorkoutSession } from '../src/fitness/session/types';
import { runWorkoutRewardPipeline } from '../src/rewards/pipeline/runWorkoutRewardPipeline';
import { applyGameReward, applyLockedCompletionReward } from '../src/rewards/application/apply';
import { TroopReward } from '../src/rewards/types';
import { GAME_REWARD_CONFIG_VERSION, GAME_REWARD_MODEL_VERSION } from '../src/rewards/types';
import { PHYSICAL_OUTPUT_VERSION, PHYSICAL_RESULT_MODEL_VERSION } from '../src/fitness/physicalResult';
import { getDefaultWorldCatalog } from '../src/worldDefinition/catalog';
import { createCompletionRewardEntitlement } from '../src/rewards/completionEntitlement';
import { RoutingHistoryStore } from '../src/persistence/supabase/commandHistoryBuffer';
import { PlayerWorldPersistence } from '../src/server/persistencePort';
import { Orchestrator } from '../src/orchestration/orchestrator';
import { createDefaultRegistry } from '../src/orchestration/engineRegistry';
import { cloneWorkoutHistoryEntry } from '../src/fitness/history/record';
import { historyEntryToRow, rowToHistoryEntry } from '../src/persistence/supabase/mapper';
import { retryPendingWorkoutReward } from '../src/rewards/pipeline/runWorkoutRewardPipeline';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { createInitialFitnessEstimate } from '../src/fitness/estimate/evaluator';
import { isPlayerProtected } from '../src/gameplay/invasion/eligibility';
import { playerProtectionTicks } from '../src/gameplay/config';

const PLAYER = 'r1-d-player';
type Scenario = ReturnType<typeof scenario>;
const finalize = (s: Scenario, sessionId?: string, requestId?: string) => s.host.execute({
  commandId: 'FINALIZE_WORKOUT', playerId: PLAYER, requestId, parameters: sessionId ? { sessionId } : {},
});
async function completed(s: Scenario) {
  assert.ok((await s.host.execute(await open(s))).success);
  return finish(s.host, s);
}
function finishSession(session: WorkoutSession): WorkoutSession {
  let next = session, now = session.createdAt + 1000;
  while (next.state === 'ACTIVE') {
    const step = getCurrentExercise(next)!;
    const result = completeExercise(next, { order: step.order, ...(step.prescription.kind === 'repetitions'
      ? { repetitions: step.prescription.repetitions } : { durationSeconds: step.prescription.durationSeconds }) }, now += 1000);
    if (!result.ok) throw new Error(result.error.message);
    next = result.value;
  }
  return next;
}
function conquered() {
  const loaded = loadProductionLevel1Definition();
  if (!loaded.ok) throw new Error('level 1 unavailable');
  const state = createGameState({ world: loaded.definition, seed: 17 });
  for (const territory of state.territories.values()) territory.owner = state.playerFactionId;
  for (const faction of state.factions.values()) faction.territories = [...state.territories.values()].filter(t => t.owner === faction.id).map(t => t.id);
  return state;
}
function legacyReward(sessionId = 'legacy-pending'): TroopReward {
  return { modelVersion: GAME_REWARD_MODEL_VERSION, configVersion: GAME_REWARD_CONFIG_VERSION,
    playerId: PLAYER, sessionId, workoutId: 'wk_very_easy_mobility', sourcePhysicalOutput: 1,
    physicalResultModelVersion: PHYSICAL_RESULT_MODEL_VERSION, physicalOutputVersion: PHYSICAL_OUTPUT_VERSION,
    intendedDifficulty: 'VERY_EASY', completedAt: 1000, conversionNotes: [], kind: 'TROOPS', purpose: 'NORMAL_TROOPS', amount: 10 };
}
export async function runWorkoutSettlementRewardTests(report: (name: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  const cases: [string, (s: ReturnType<typeof scenario>) => void | Promise<void>][] = [];
  const test = (name: string, fn: (s: ReturnType<typeof scenario>) => void | Promise<void>) => cases.push([name, fn]);
  for (const [size, amount] of [['SHORT', 75], ['STANDARD', 125], ['LONG', 181]] as const) {
    test(`${size} pays exact locked soldiers without feedback`, async s => {
      const req = await open(s);
      assert.ok((await s.host.execute({ ...req, parameters: { ...req.parameters, size } })).success);
      const session = await finish(s.host, s);
      assert.strictEqual(session.feedback, null);
      const result = await s.host.execute({ commandId: 'FINALIZE_WORKOUT', playerId: PLAYER });
      assert.ok(result.success, JSON.stringify(result));
      const state = s.load().state;
      assert.strictEqual(state.playerRewards.bankedTroops, amount);
      assert.strictEqual(result.payload.applicationId, session.completionRewardEntitlement!.entitlementId);
      assert.strictEqual(state.playerRewards.appliedRewards.length, 1);
      assert.deepStrictEqual(checkGameStateInvariants(state), []);
      const history = s.history.get(PLAYER, session.sessionId)!;
      assert.deepStrictEqual(history.completionRewardEntitlement, session.completionRewardEntitlement);
      assert.strictEqual(history.evidence, null);
      assert.strictEqual(state.playerFitness.estimate, null);
    });
  }
  for (const kind of ['active', 'unpaid completed', 'pending legacy'] as const) {
    test(`campaign rejects ${kind} obligation without changing state`, s => {
      const state = conquered();
      const { orch, req } = s.direct();
      assert.ok(orch.execute(req).success);
      state.playerFitness.activeSession = cloneGameState(orch.getState()).playerFitness.activeSession;
      if (kind === 'unpaid completed') state.playerFitness.activeSession = finishSession(state.playerFitness.activeSession!);
      if (kind === 'pending legacy') state.playerFitness.pendingReward = {
        sessionId: 'legacy-pending', reward: legacyReward(), context: { playerId: PLAYER, mode: 'banked' },
      };
      const before = snapshotGameState(state);
      assert.strictEqual(evaluateWorldTransition(state).eligible, false);
      assert.throws(() => buildNextWorldState(state), /workout|reward/i);
      assert.deepStrictEqual(snapshotGameState(state), before);
    });
  }
  test('incomplete mandatory work cannot earn completion soldiers', async s => {
    assert.ok((await s.host.execute(await open(s))).success);
    const before = s.load().state.playerRewards;
    assert.strictEqual((await finalize(s)).success, false);
    assert.deepStrictEqual(s.load().state.playerRewards, before);
    const active = s.load().state.playerFitness.activeSession!;
    const step = getCurrentExercise(active)!;
    const response = await s.host.execute({ commandId: 'RECORD_EXERCISE', playerId: PLAYER,
      parameters: { order: step.order, repetitions: 1, now: 2000 } });
    assert.ok(response.success);
    assert.strictEqual((await finalize(s)).success, false);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, 0);
  });
  test('abandoned workout earns nothing and can leave a completed campaign', async s => {
    assert.ok((await s.host.execute(await open(s))).success);
    assert.ok((await s.host.execute({ commandId: 'ABANDON_WORKOUT', playerId: PLAYER, parameters: { now: 2000 } })).success);
    assert.strictEqual((await finalize(s)).success, false);
    const state = conquered(); state.playerFitness.activeSession = s.load().state.playerFitness.activeSession;
    assert.ok(evaluateWorldTransition(state).eligible);
    assert.strictEqual(buildNextWorldState(state).status, 'transitioned');
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, 0);
  });
  test('COMPLETED label alone cannot replace missing prescribed work', async s => {
    const session = await completed(s), state = s.load().state;
    session.performances[0]!.actual = { kind: 'repetitions', completedRepetitions: 0 };
    assert.strictEqual(applyLockedCompletionReward(state, session).ok, false);
    assert.strictEqual(state.playerRewards.bankedTroops, 0);
  });
  for (const ratio of [5000, 200_000_000]) test(`persisted ratio ${ratio} pays without legacy conversion cap`, async s => {
    s.world.workoutRewards = { ...s.world.workoutRewards!, soldiersPerRewardUnitMicros: ratio };
    getDefaultWorldCatalog().register(s.world);
    const session = await completed(s), amount = session.completionRewardEntitlement!.soldiers;
    assert.ok((await finalize(s)).success);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, amount);
  });
  test('policy revision and ratio changes do not reprice an active entitlement', async s => {
    const session = await completed(s);
    s.world.workoutRewards = { ...s.world.workoutRewards!, revision: 'upgraded-policy', soldiersPerRewardUnitMicros: 9_000_000 };
    getDefaultWorldCatalog().register(s.world);
    assert.ok((await finalize(s)).success);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, session.completionRewardEntitlement!.soldiers);
  });
  test('removed catalog and changed readiness cannot reprice or prevent earned settlement', async s => {
    const session = await completed(s);
    installAuthoredWorkoutCatalog(null);
    const current = s.load(); current.state.playerFitness.progression.currentBandId = 'unknown';
    assert.ok(s.store.save(PLAYER, current.state, current.record.stateVersion).ok);
    s.host = createSessionHost(s.persistence, { nowMs: () => 1000 });
    assert.ok((await finalize(s)).success);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, session.completionRewardEntitlement!.soldiers);
  });
  test('different command IDs targeting one completed entitlement return one original result', async s => {
    const session = await completed(s);
    const first = await finalize(s, session.sessionId, 'first'), second = await finalize(s, session.sessionId, 'second');
    assert.ok(first.success && second.success);
    assert.strictEqual(second.payload.alreadyProcessed, true);
    assert.deepStrictEqual(second.payload.amountOrEffect, first.payload.amountOrEffect);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, 125);
    assert.strictEqual(s.load().state.playerRewards.appliedRewards.length, 1);
  });
  test('concurrent same-host finalization serializes to one soldier credit', async s => {
    const session = await completed(s);
    const responses = await Promise.all([finalize(s, session.sessionId, 'a'), finalize(s, session.sessionId, 'b')]);
    assert.ok(responses.every(result => result.success));
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, 125);
    assert.strictEqual(s.load().state.playerRewards.appliedRewards.length, 1);
  });
  test('lost response sequenced retry replays the committed response; stale commands cannot pay', async s => {
    const session = await completed(s);
    const lease = s.load().state.gameplaySessionLeases[0]!;
    const request: CommandRequest = { commandId: 'FINALIZE_WORKOUT', playerId: PLAYER, requestId: 'lost',
      gameplaySessionId: lease.sessionId, commandSequence: 2, renewalSequence: 2, parameters: { sessionId: session.sessionId } };
    const first = await s.host.execute(request);
    assert.ok(first.success);
    s.host = createSessionHost(s.persistence, { nowMs: () => 1000 });
    const replay = await s.host.execute(request);
    assert.strictEqual(replay.idempotentReplay, true);
    assert.deepStrictEqual(replay.payload, JSON.parse(JSON.stringify(first.payload)));
    const stale = await s.host.execute({ ...request, requestId: 'other' });
    assert.strictEqual(stale.success, false);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, 125);
  });
  test('restart before and after settlement preserves lock and ledger', async s => {
    const session = await completed(s);
    const host = createSessionHost(s.persistence, { nowMs: () => 1000 });
    assert.ok((await host.execute({ commandId: 'FINALIZE_WORKOUT', playerId: PLAYER })).success);
    const restored = createSessionHost(s.persistence, { nowMs: () => 1000 });
    const result = await restored.execute({ commandId: 'FINALIZE_WORKOUT', playerId: PLAYER, parameters: { sessionId: session.sessionId } });
    assert.ok(result.success); assert.strictEqual(result.payload.alreadyProcessed, true);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, 125);
  });
  test('failed world save rolls back ledger bank and history; retry pays once', async s => {
    const session = await completed(s), original = s.load(), priorHistory = s.history.clonePlayer(PLAYER);
    let fail = true;
    const persistence: PlayerWorldPersistence = { ...s.persistence, save: (player, state, version) => fail
      ? { ok: false, code: 'persistence.save_failed', message: 'injected failure', persisted: false }
      : s.persistence.save(player, state, version) };
    const host = createSessionHost(persistence, { nowMs: () => 1000 });
    await assert.rejects(() => host.execute({ commandId: 'FINALIZE_WORKOUT', playerId: PLAYER }));
    assert.deepStrictEqual(snapshotGameState(s.load().state), snapshotGameState(original.state));
    assert.deepStrictEqual(s.history.clonePlayer(PLAYER), priorHistory);
    fail = false;
    assert.ok((await host.execute({ commandId: 'FINALIZE_WORKOUT', playerId: PLAYER })).success);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, session.completionRewardEntitlement!.soldiers);
  });
  test('buffered atomic history failure publishes neither world nor history and retries safely', async s => {
    await completed(s);
    const history = new RoutingHistoryStore(s.history), before = s.load();
    let fail = true, entries = 0;
    const persistence: PlayerWorldPersistence = { ...s.persistence, history,
      commitWorld(player, state, version, changes) {
        entries = changes.length;
        if (fail) return { ok: false, code: 'persistence.save_failed', message: 'history transaction rollback', persisted: false };
        const saved = s.store.save(player, state, version);
        if (saved.ok) for (const entry of changes) s.history.upsert(entry);
        return saved;
      } };
    const host = createSessionHost(persistence, { nowMs: () => 1000 });
    await assert.rejects(() => host.execute({ commandId: 'FINALIZE_WORKOUT', playerId: PLAYER }));
    assert.strictEqual(entries, 1);
    assert.deepStrictEqual(snapshotGameState(s.load().state), snapshotGameState(before.state));
    assert.strictEqual(s.history.get(PLAYER, before.state.playerFitness.activeSession!.sessionId), null);
    fail = false;
    assert.ok((await host.execute({ commandId: 'FINALIZE_WORKOUT', playerId: PLAYER })).success);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, 125);
  });
  test('two loaded writers conflict at CAS; loser reloads original settlement', async s => {
    const session = await completed(s), initial = s.load();
    const a = cloneGameState(initial.state), b = cloneGameState(initial.state);
    const first = runWorkoutRewardPipeline(a, a.playerFitness.activeSession!, PLAYER, { history: s.history });
    assert.ok(first.ok); assert.ok(s.store.save(PLAYER, a, initial.record.stateVersion).ok);
    const second = runWorkoutRewardPipeline(b, b.playerFitness.activeSession!, PLAYER, { history: s.history });
    assert.ok(second.ok);
    const stale = s.store.save(PLAYER, b, initial.record.stateVersion);
    assert.strictEqual(stale.ok, false); if (!stale.ok) assert.strictEqual(stale.code, 'persistence.conflict');
    s.host = createSessionHost(s.persistence, { nowMs: () => 1000 });
    assert.ok((await finalize(s, session.sessionId)).success);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, 125);
  });
  test('late feedback evaluates fitness once without another soldier payout', async s => {
    const session = await completed(s); assert.ok((await finalize(s)).success);
    const before = s.load().state.playerRewards;
    const request: CommandRequest = { commandId: 'SUBMIT_WORKOUT_FEEDBACK', playerId: PLAYER,
      parameters: { sessionId: session.sessionId, value: 'ABOUT_RIGHT', now: 20000 } };
    assert.ok((await s.host.execute(request)).success);
    const after = s.load().state;
    assert.ok(after.playerFitness.estimate);
    assert.strictEqual(after.playerFitness.compactHistory.filter(row => row.sessionId === session.sessionId).length, 1);
    assert.strictEqual(after.playerFitness.progression.evidenceLog.filter(row => row.sessionId === session.sessionId).length, 1);
    assert.ok(s.history.get(PLAYER, session.sessionId)!.evidence);
    assert.deepStrictEqual(after.playerRewards, before);
    assert.ok((await s.host.execute(request)).success);
    assert.deepStrictEqual(s.load().state.playerFitness, after.playerFitness);
    assert.ok((await finalize(s, session.sessionId)).success);
    assert.deepStrictEqual(s.load().state.playerRewards, before);
  });
  test('feedback before settlement preserves evidence and pays the same locked amount', async s => {
    const session = await completed(s);
    assert.ok((await s.host.execute({ commandId: 'SUBMIT_WORKOUT_FEEDBACK', playerId: PLAYER,
      parameters: { value: 'HARD', now: 20000 } })).success);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, 0);
    assert.ok((await finalize(s)).success);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, session.completionRewardEntitlement!.soldiers);
    assert.ok(s.history.get(PLAYER, session.sessionId)!.evidence);
  });
  test('historical feedback does not replace another active session or repay old reward', async s => {
    const old = await completed(s); assert.ok((await finalize(s)).success);
    const lease = s.load().state.gameplaySessionLeases[0]!;
    assert.ok((await s.host.execute({ commandId: 'START_WORKOUT', playerId: PLAYER, requestId: 'next',
      gameplaySessionId: lease.sessionId, commandSequence: 2, renewalSequence: 2,
      parameters: { purpose: 'NORMAL_TROOPS', size: 'SHORT', now: 30000 } })).success);
    const active = s.load().state.playerFitness.activeSession!;
    assert.ok((await s.host.execute({ commandId: 'SUBMIT_WORKOUT_FEEDBACK', playerId: PLAYER,
      parameters: { sessionId: old.sessionId, value: 'EASY', now: 40000 } })).success);
    assert.deepStrictEqual(s.load().state.playerFitness.activeSession, active);
    assert.ok((await finalize(s, old.sessionId)).success);
    assert.deepStrictEqual(s.load().state.playerFitness.activeSession, active);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, 125);
  });
  test('campaign transition preserves paid identity and later feedback without old-world payment', async s => {
    const session = await completed(s); assert.ok((await finalize(s)).success);
    const state = conquered();
    state.playerRewards.appliedRewards = s.load().state.playerRewards.appliedRewards;
    state.playerFitness.activeSession = s.load().state.playerFitness.activeSession;
    const next = buildNextWorldState(state).next!;
    assert.ok(next); assert.strictEqual(next.playerFitness.activeSession, null);
    assert.deepStrictEqual(next.playerRewards.appliedRewards, state.playerRewards.appliedRewards);
    const registry = createDefaultRegistry(); registry.workoutHistory = s.history;
    const orch = new Orchestrator(next, registry);
    const before = next.playerRewards.bankedTroops;
    assert.ok(orch.execute({ commandId: 'FINALIZE_WORKOUT', playerId: PLAYER, parameters: { sessionId: session.sessionId } }).success);
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, before);
    assert.ok(orch.execute({ commandId: 'SUBMIT_WORKOUT_FEEDBACK', playerId: PLAYER,
      parameters: { sessionId: session.sessionId, value: 'ABOUT_RIGHT', now: 20000 } }).success);
    assert.ok(orch.getState().playerFitness.estimate);
    assert.strictEqual(orch.getState().playerRewards.bankedTroops, before);
  });
  test('legacy completed workout still waits for feedback then uses legacy physical conversion', s => {
    const begun = beginWorkoutSession({ playerId: PLAYER, sessionId: 'legacy-completed', workoutId: 'wk_easy_core',
      intendedDifficulty: 'EASY', purpose: 'NORMAL_TROOPS', now: 0 });
    assert.ok(begun.ok); if (!begun.ok) return;
    let session = finishSession(begun.value);
    const state = cloneGameState(s.state); state.playerFitness.activeSession = session;
    assert.strictEqual(runWorkoutRewardPipeline(state, session, PLAYER, { history: s.history }).ok, false);
    const feedback = submitWorkoutFeedback(session, 'ABOUT_RIGHT', 20000);
    assert.ok(feedback.ok); if (!feedback.ok) return;
    session = feedback.value; state.playerFitness.activeSession = session;
    const result = runWorkoutRewardPipeline(state, session, PLAYER, { history: s.history });
    assert.ok(result.ok, JSON.stringify(result.error));
    assert.ok(result.physicalOutput! > 0);
    assert.ok(result.application?.ok);
    if (result.application?.ok) assert.notStrictEqual(result.application.result.applicationId, 'workout-completion:legacy-completed');
    assert.strictEqual(state.playerRewards.bankedTroops, Math.min(10000, Math.floor(result.physicalOutput! * 10)));
  });
  test('pending legacy reward blocks transition even with no active workout', s => {
    const state = conquered(); state.playerFitness.pendingReward = { sessionId: 'legacy-pending', reward: legacyReward(),
      context: { playerId: PLAYER, mode: 'banked' } };
    const before = snapshotGameState(state);
    assert.strictEqual(evaluateWorldTransition(state).eligible, false);
    assert.throws(() => buildNextWorldState(state), /pending/);
    assert.deepStrictEqual(snapshotGameState(state), before);
  });
  test('unsafe bank overflow preserves unpaid lock without a ledger entry', async s => {
    await completed(s);
    const value = s.load(); value.state.playerRewards.bankedTroops = Number.MAX_SAFE_INTEGER;
    assert.ok(s.store.save(PLAYER, value.state, value.record.stateVersion).ok);
    s.host = createSessionHost(s.persistence, { nowMs: () => 1000 });
    assert.strictEqual((await finalize(s)).success, false);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, Number.MAX_SAFE_INTEGER);
    assert.strictEqual(s.load().state.playerRewards.appliedRewards.length, 0);
    assert.ok(s.load().state.playerFitness.activeSession!.completionRewardEntitlement);
  });
  test('one session cannot acquire a second payout identity after policy upgrade', async s => {
    const session = await completed(s); assert.ok((await finalize(s)).success);
    const revised = { ...session, completionRewardEntitlement: createCompletionRewardEntitlement({ session,
      size: 'STANDARD', catalogId: session.authoredCatalog!.catalogId, catalogVersion: session.authoredCatalog!.catalogVersion,
      world: session.completionRewardEntitlement!.world,
      policy: { ...session.completionRewardEntitlement!.policy, revision: 'upgraded', soldiersPerRewardUnitMicros: 2_000_000 } }) };
    const result = runWorkoutRewardPipeline(s.load().state, revised, PLAYER, { history: s.history });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.state.playerRewards.bankedTroops, 125);
    const legacy = applyGameReward(result.state, legacyReward(session.sessionId), { playerId: PLAYER, mode: 'banked' });
    assert.strictEqual(legacy.ok, false);
  });
  for (const purpose of ['GOLDEN_YIELD', 'EXTRA_CONSTRUCTION_WORKERS'] as const) {
    test(`${purpose} retains specialized effects without ordinary soldiers`, async s => {
      const start = await s.host.execute({ commandId: 'START_WORKOUT', playerId: PLAYER,
        parameters: { purpose, workoutId: 'wk_easy_core', now: 1000 } });
      assert.ok(start.success, JSON.stringify(start.errors));
      const session = await finish(s.host, s);
      assert.strictEqual(session.completionRewardEntitlement, undefined);
      assert.ok((await s.host.execute({ commandId: 'SUBMIT_WORKOUT_FEEDBACK', playerId: PLAYER,
        parameters: { value: 'ABOUT_RIGHT', now: 20000 } })).success);
      const response = await finalize(s); assert.ok(response.success, JSON.stringify(response.errors));
      const state = s.load().state;
      assert.strictEqual(state.playerRewards.bankedTroops, 0);
      assert.strictEqual(state.playerRewards.appliedRewards[0]!.kind, purpose);
      assert.strictEqual(purpose === 'GOLDEN_YIELD' ? state.playerRewards.pendingGoldenYieldEffects.length
        : state.playerRewards.pendingConstructionEffects.length, 1);
    });
  }
  test('legacy pending amount and identity survive retry then cease blocking transition', () => {
    const state = conquered(), reward = legacyReward();
    state.playerFitness.pendingReward = { sessionId: reward.sessionId, reward,
      context: { playerId: PLAYER, mode: 'banked', rewardApplicationId: 'old-policy-payment' } };
    assert.throws(() => buildNextWorldState(state), /pending/);
    const result = retryPendingWorkoutReward(state, PLAYER);
    assert.ok(result?.ok); assert.strictEqual(state.playerRewards.bankedTroops, 10);
    assert.strictEqual(state.playerRewards.appliedRewards[0]!.applicationId, 'old-policy-payment');
    assert.strictEqual(state.playerFitness.pendingReward, null);
    assert.strictEqual(buildNextWorldState(state).status, 'transitioned');
  });
  test('legacy unpaid completed session blocks campaign even though no new entitlement exists', () => {
    const state = conquered();
    const begun = beginWorkoutSession({ playerId: PLAYER, sessionId: 'legacy-unpaid', workoutId: 'wk_easy_core',
      purpose: 'NORMAL_TROOPS', intendedDifficulty: 'EASY', now: 0 });
    assert.ok(begun.ok); if (!begun.ok) return;
    state.playerFitness.activeSession = finishSession(begun.value);
    const before = snapshotGameState(state);
    assert.throws(() => buildNextWorldState(state), /settled/);
    assert.deepStrictEqual(snapshotGameState(state), before);
  });
  test('paused workout blocks campaign transition', async s => {
    assert.ok((await s.host.execute(await open(s))).success);
    assert.ok((await s.host.execute({ commandId: 'PAUSE_WORKOUT', playerId: PLAYER, parameters: { now: 1500 } })).success);
    const state = conquered(); state.playerFitness.activeSession = s.load().state.playerFitness.activeSession;
    assert.strictEqual(evaluateWorldTransition(state).eligible, false);
    assert.throws(() => buildNextWorldState(state), /active/);
  });
  test('authoritative transition command rejection preserves the original workout and world', async s => {
    await completed(s);
    const state = conquered(); state.playerFitness.activeSession = s.load().state.playerFitness.activeSession;
    const registry = createDefaultRegistry(); registry.workoutHistory = s.history;
    const orch = new Orchestrator(state, registry), before = snapshotGameState(orch.getState());
    const response = orch.execute({ commandId: 'TRANSITION_TO_NEXT_WORLD', playerId: PLAYER });
    assert.strictEqual(response.success, false);
    assert.deepStrictEqual(snapshotGameState(orch.getState()), before);
  });
  test('history JSON mapper round trip preserves lock snapshot settlement and later feedback data', async s => {
    const session = await completed(s); assert.ok((await finalize(s)).success);
    const entry = s.history.get(PLAYER, session.sessionId)!;
    const restored = cloneWorkoutHistoryEntry(rowToHistoryEntry(JSON.parse(JSON.stringify(historyEntryToRow(entry)))));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(restored)), JSON.parse(JSON.stringify(entry)));
    assert.strictEqual(restored.rewardSettlement!.amountOrEffect.kind, 'TROOPS');
    restored.sessionSnapshot!.performances[0]!.actual = { kind: 'none' };
    assert.notDeepStrictEqual(restored.sessionSnapshot, entry.sessionSnapshot);
    assert.deepStrictEqual(s.history.get(PLAYER, session.sessionId), entry);
  });
  test('repeated settlement preserves original history tick terms and ledger result', async s => {
    const session = await completed(s); assert.ok((await finalize(s)).success);
    const before = s.history.get(PLAYER, session.sessionId)!;
    assert.ok((await finalize(s, session.sessionId)).success);
    const after = s.history.get(PLAYER, session.sessionId)!;
    assert.deepStrictEqual(after, before);
  });
  test('forged history session or settlement binding is rejected', async s => {
    const session = await completed(s); assert.ok((await finalize(s)).success);
    const entry = s.history.get(PLAYER, session.sessionId)!;
    assert.throws(() => cloneWorkoutHistoryEntry({ ...entry, sessionId: 'other' }));
    assert.throws(() => cloneWorkoutHistoryEntry({ ...entry, rewardSettlement: { ...entry.rewardSettlement!, sourceSessionId: 'other' } }));
  });
  test('feedback failure during world commit rolls back fitness and retained history', async s => {
    const session = await completed(s); assert.ok((await finalize(s)).success);
    const before = s.load(), historyBefore = s.history.get(PLAYER, session.sessionId);
    const persistence: PlayerWorldPersistence = { ...s.persistence, save: () => ({ ok: false,
      code: 'persistence.save_failed', message: 'feedback rollback', persisted: false }) };
    const host = createSessionHost(persistence, { nowMs: () => 1000 });
    await assert.rejects(() => host.execute({ commandId: 'SUBMIT_WORKOUT_FEEDBACK', playerId: PLAYER,
      parameters: { value: 'EASY', now: 20000 } }));
    assert.deepStrictEqual(snapshotGameState(s.load().state), snapshotGameState(before.state));
    assert.deepStrictEqual(s.history.get(PLAYER, session.sessionId), historyBefore);
  });
  test('locked settlement without durable history fails without touching the bank or source session', async s => {
    const session = await completed(s), state = s.load().state, before = snapshotGameState(state);
    const source = JSON.stringify(session);
    assert.strictEqual(runWorkoutRewardPipeline(state, session, PLAYER).ok, false);
    assert.deepStrictEqual(snapshotGameState(state), before);
    assert.strictEqual(JSON.stringify(session), source);
  });
  test('identical canonical session and restored state settle deterministically', async s => {
    const session = await completed(s), before = snapshotGameState(s.load().state);
    const a = hydratePersistedPayload(before), b = hydratePersistedPayload(before);
    const first = applyLockedCompletionReward(a, session), second = applyLockedCompletionReward(b, session);
    assert.ok(first.ok && second.ok);
    assert.deepStrictEqual(first.result, second.result);
    assert.deepStrictEqual(snapshotGameState(first.state), snapshotGameState(second.state));
    assert.strictEqual(a.playerRewards.bankedTroops, 0);
    assert.strictEqual(b.playerRewards.bankedTroops, 0);
  });
  test('wrong player cannot finalize or submit fitness evidence for another session', async s => {
    await completed(s);
    const registry = createDefaultRegistry(); registry.workoutHistory = s.history;
    const orch = new Orchestrator(s.load().state, registry), before = snapshotGameState(orch.getState());
    assert.strictEqual(orch.execute({ commandId: 'FINALIZE_WORKOUT', playerId: 'other' }).success, false);
    assert.strictEqual(orch.execute({ commandId: 'SUBMIT_WORKOUT_FEEDBACK', playerId: 'other',
      parameters: { value: 'EASY', now: 20000 } }).success, false);
    assert.deepStrictEqual(snapshotGameState(orch.getState()), before);
  });
  test('feedback after newer fitness evidence never rewinds the permanent estimate clock', async s => {
    const session = await completed(s); assert.ok((await finalize(s)).success);
    const original = s.load();
    const newer = createInitialFitnessEstimate({ playerId: PLAYER, now: 50000 });
    assert.ok(newer.ok); if (!newer.ok) return;
    original.state.playerFitness.estimate = { ...newer.value, observationCount: 4 };
    const registry = createDefaultRegistry(); registry.workoutHistory = s.history;
    const orch = new Orchestrator(original.state, registry);
    assert.ok(orch.execute({ commandId: 'SUBMIT_WORKOUT_FEEDBACK', playerId: PLAYER, parameters: { value: 'ABOUT_RIGHT', now: 20000 } }).success);
    const state = orch.getState();
    assert.ok(state.playerFitness.estimate); assert.strictEqual(state.playerFitness.estimate!.lastUpdatedAt, 50000);
    assert.strictEqual(s.history.get(PLAYER, session.sessionId)!.evidence!.completedAt, session.completedAt);
  });
  test('sequenced transition retains lease and receipt for replay plus post-transition feedback', async s => {
    const session = await completed(s); assert.ok((await finalize(s)).success);
    const before = s.load(), state = conquered();
    state.playerFitness = before.state.playerFitness;
    state.playerRewards.appliedRewards = before.state.playerRewards.appliedRewards;
    state.gameplaySessionLeases = before.state.gameplaySessionLeases;
    assert.ok(s.store.save(PLAYER, state, before.record.stateVersion).ok);
    const host = createSessionHost(s.persistence, { nowMs: () => 1000 });
    const request: CommandRequest = { commandId: 'TRANSITION_TO_NEXT_WORLD', playerId: PLAYER, requestId: 'transition',
      gameplaySessionId: state.gameplaySessionLeases[0]!.sessionId, commandSequence: 2, renewalSequence: 2 };
    const response = await host.execute(request); assert.ok(response.success, JSON.stringify(response));
    const restored = createSessionHost(s.persistence, { nowMs: () => 1000 });
    const replay = await restored.execute(request); assert.strictEqual(replay.idempotentReplay, true);
    assert.deepStrictEqual(replay.payload, JSON.parse(JSON.stringify(response.payload)));
    const next = s.load().state;
    assert.strictEqual(next.playerFitness.activeSession, null);
    assert.strictEqual(next.playerRewards.appliedRewards.length, 1);
    assert.strictEqual(next.worldTick, 0); assert.strictEqual(next.accruedTargetWorldTick, 0);
    assert.strictEqual(next.gameplaySessionLeases[0]!.lastCommandReceipt!.commandId, 'TRANSITION_TO_NEXT_WORLD');
    assert.ok((await restored.execute({ commandId: 'SUBMIT_WORKOUT_FEEDBACK', playerId: PLAYER,
      parameters: { sessionId: session.sessionId, value: 'ABOUT_RIGHT', now: 20000 } })).success);
    assert.ok(s.load().state.playerFitness.estimate);
    assert.strictEqual(s.load().state.playerFitness.lastWorkoutCompletedAtTick, null);
    assert.strictEqual(s.load().state.playerRewards.bankedTroops, 0);
  });
  test('first settlement grants existing protection without feedback; late feedback and retries cannot refresh it', async s => {
    const session = await completed(s); assert.ok((await finalize(s)).success);
    const state = s.load().state;
    assert.strictEqual(state.playerFitness.lastWorkoutCompletedAtTick, 0);
    assert.strictEqual(isPlayerProtected(state), true);
    state.worldTick = state.accruedTargetWorldTick = playerProtectionTicks() + 1;
    assert.strictEqual(isPlayerProtected(state), false);
    const registry = createDefaultRegistry(); registry.workoutHistory = s.history;
    const orch = new Orchestrator(state, registry);
    assert.ok(orch.execute({ commandId: 'SUBMIT_WORKOUT_FEEDBACK', playerId: PLAYER,
      parameters: { sessionId: session.sessionId, value: 'ABOUT_RIGHT', now: 20000 } }).success);
    assert.strictEqual(orch.getState().playerFitness.lastWorkoutCompletedAtTick, 0);
    assert.strictEqual(isPlayerProtected(orch.getState()), false);
    assert.ok(orch.execute({ commandId: 'FINALIZE_WORKOUT', playerId: PLAYER, parameters: { sessionId: session.sessionId } }).success);
    assert.strictEqual(orch.getState().playerFitness.lastWorkoutCompletedAtTick, 0);
    assert.strictEqual(isPlayerProtected(orch.getState()), false);
  });
  for (const [name, fn] of cases) await report(`R1-E: ${name}`, async () => {
    const previous = getAuthoredWorkoutCatalog();
    try { await fn(scenario()); } finally { installAuthoredWorkoutCatalog(previous); }
  });
}
