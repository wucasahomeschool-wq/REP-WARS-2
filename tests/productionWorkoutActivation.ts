import assert from 'assert';
import {request} from 'node:http';
import {createCommandHttpServer} from '../src/server/http';
import {createSessionHost} from '../src/server/session';
import {createInMemoryPersistence} from '../src/server/persistencePort';
import {InMemoryGameStateStore} from '../src/persistence/inMemoryGameStateStore';
import {getAuthoredWorkoutCatalog, installAuthoredWorkoutCatalog} from '../src/fitness/authoring/registry';
import {scenario, open, finish} from './workoutStartRewards';
import {snapshotGameState} from '../src/persistence/snapshot';
import {hydratePersistedPayload} from '../src/persistence/hydrate';
import {checkGameStateInvariants} from '../src/state/gameStateInvariants';
import {Orchestrator} from '../src/orchestration/orchestrator';
import {initializePlayerWorld} from '../src/persistence/initializePlayerWorld';
import {nextMutationTestId} from './mutationTestRequests';

/** Production initializer and authenticated HTTP boundary; no legacy session,
 * invented catalog, ratio, readiness, or reward is installed for this probe. */
export async function runProductionWorkoutActivationTests(report: (name: string, fn: () => Promise<void>) => Promise<void>) {
  await report('Phase 4: fresh production world reports unavailable normal workout configuration before start', async () => {
    const previous = getAuthoredWorkoutCatalog(); installAuthoredWorkoutCatalog(null);
    const store = new InMemoryGameStateStore();
    const host = createSessionHost(createInMemoryPersistence(store), {nowMs: () => 1000});
    const server = createCommandHttpServer(host, {identity: {mode: 'authenticated', authenticate: () => 'phase4-fresh'}});
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); assert(address && typeof address !== 'string');
      const post = (path: string, body: unknown) => new Promise<any>((resolve, reject) => {
        const req = request({host: '127.0.0.1', port: address.port, path, method: 'POST', agent: false,
          headers: {'content-type': 'application/json', connection: 'close'}}, res => {
          let raw = ''; res.on('data', chunk => raw += chunk);
          res.on('end', () => {try {assert.equal(res.statusCode, 200); resolve(JSON.parse(raw));} catch (e) {reject(e);}});
        });
        req.on('error', reject); req.end(JSON.stringify(body));
      });
      const opened = await post('/session/open', {requestId: 'phase4-open', worldAttempt: 0});
      const catalog = await post('/commands', {commandId: 'GET_FITNESS_CATALOG'});
      assert.equal(catalog.payload.authoredCatalog, null);
      const selection = await post('/commands', {commandId: 'GET_WORKOUT_SELECTION', parameters: {purpose: 'NORMAL_TROOPS', size: 'SHORT'}});
      const start = await post('/commands', {commandId: 'START_WORKOUT', requestId: 'phase4-start', worldAttempt: 0,
        gameplaySessionId: (opened.session ?? opened).sessionId, commandSequence: 1, renewalSequence: 1,
        parameters: {purpose: 'NORMAL_TROOPS', workoutId: selection.payload.selectedWorkoutId, size: 'SHORT'}});
      assert.equal(start.success, false);
      assert.equal(start.errors[0].code, 'WORKOUT_CONFIGURATION_UNAVAILABLE');
      assert.match(start.errors[0].message, /authored workout size and catalog identity/);
      console.log('PHASE4_FRESH_WORLD', JSON.stringify({allowed: selection.payload.allowed, startError: start.errors[0]}));
      assert.equal(selection.success, true);
      assert.equal(selection.payload.allowed, false);
      assert.equal(selection.payload.configurationError.code, start.errors[0].code);
      assert.equal(selection.payload.configurationError.message, start.errors[0].message);
      const saved = store.load('phase4-fresh'); assert(saved.ok);
      assert.equal(saved.state.definitionWorldId, 'Level 1');
      assert.equal(saved.state.level1Tutorial?.beat, 'FIRST_WORKOUT_PENDING');
      assert.equal(saved.state.playerFitness.activeSession, null);
      assert.equal(saved.state.playerRewards.bankedTroops, 0);
      assert.equal(saved.state.playerRewards.appliedRewards.length, 0);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      installAuthoredWorkoutCatalog(previous);
    }
  });
  await runContractFixtureTests(report);
}

/** Reuses the existing R1-D TEST-ONLY authoring catalog and 1.25 test ratio.
 * These tests prove plumbing, not fitness-content approval or production activation. */
async function runContractFixtureTests(report: (name: string, fn: () => Promise<void>) => Promise<void>) {
  const cases: [string, (s: ReturnType<typeof scenario>) => void | Promise<void>][] = [];
  const test = (name: string, fn: (s: ReturnType<typeof scenario>) => void | Promise<void>) => cases.push([name, fn]);
  const query = (orch: Orchestrator, size = 'STANDARD', purpose = 'NORMAL_TROOPS') => orch.execute({
    commandId: 'GET_WORKOUT_SELECTION', playerId: 'r1-d-player', parameters: {purpose, size}});
  for (const [label, value] of [['absent', undefined], ['zero', 0], ['negative', -1], ['fractional', 0.5], ['unsafe', Number.MAX_SAFE_INTEGER + 1]] as const) {
    test(`${label} world ratio is reported unavailable by discovery and start without state changes`, s => {
      if (value === undefined) delete s.world.workoutRewards;
      else s.world.workoutRewards = {...s.world.workoutRewards!, soldiersPerRewardUnitMicros: value};
      const {orch, req} = s.direct(), before = snapshotGameState(orch.getState());
      const selected = query(orch); assert(selected.success, JSON.stringify(selected.errors));
      assert.equal(selected.payload.allowed, false);
      const start = orch.execute(req); assert.equal(start.success, false);
      assert.equal(start.errors[0]!.code, 'WORKOUT_CONFIGURATION_UNAVAILABLE');
      assert.deepEqual(selected.payload.configurationError, {code: start.errors[0]!.code, message: start.errors[0]!.message});
      assert.deepEqual(snapshotGameState(orch.getState()), before);
    });
  }
  test('unavailable world does not advertise normal rewards', s => {
    const {orch} = s.direct(); orch.getState().definitionWorldId = 'unregistered-phase4-world';
    const selected = query(orch); assert(selected.success);
    assert.equal(selected.payload.allowed, false);
    assert.match((selected.payload.configurationError as {message: string}).message, /world is unavailable/);
  });
  test('installing unrelated fixture content does not silently replace the tutorial prescription', () => {
    const orch = new Orchestrator(initializePlayerWorld({playerId: 'r1-d-player', seed: 1}).state);
    const selected = query(orch); assert(selected.success);
    assert.equal(selected.payload.source, 'tutorial');
    assert.equal(selected.payload.selectedWorkoutId, 'wk_moderate_full_body');
    assert.equal(selected.payload.allowed, false);
    assert.match((selected.payload.configurationError as {message: string}).message, /authored workout size/);
  });
  test('specialized effects do not acquire normal soldier policy requirements', s => {
    delete s.world.workoutRewards;
    const {orch} = s.direct();
    for (const purpose of ['GOLDEN_YIELD', 'EXTRA_CONSTRUCTION_WORKERS', 'DEFENSE']) {
      const selected = query(orch, 'SHORT', purpose); assert(selected.success);
      assert.equal(selected.payload.configurationError, undefined);
      // Availability still follows the existing gameplay gates; no invasion is open.
      assert.equal(selected.payload.allowed, purpose !== 'DEFENSE');
    }
  });
  for (const [size, amount] of [['SHORT', 75], ['STANDARD', 125], ['LONG', 181]] as const) {
    test(`${size} contract fixture discovery start reload and feedback-independent settlement agree exactly once`, async s => {
      const {orch} = s.direct(), before = snapshotGameState(orch.getState());
      const selected = query(orch, size); assert(selected.success);
      assert.equal(selected.payload.allowed, true);
      assert.equal(selected.payload.configurationError, undefined);
      assert.equal(selected.payload.size, size);
      assert.deepEqual(snapshotGameState(orch.getState()), before);
      const req = await open(s);
      const startRequest = {...req, parameters: {...req.parameters, size, workoutId: selected.payload.selectedWorkoutId}};
      const started = await s.host.execute(startRequest); assert(started.success, JSON.stringify(started.errors));
      const active = s.load().state.playerFitness.activeSession!;
      assert.equal(active.workoutId, selected.payload.selectedWorkoutId);
      assert.equal(active.completionRewardEntitlement!.soldiers, amount);
      assert.deepEqual(hydratePersistedPayload(JSON.parse(JSON.stringify(snapshotGameState(s.load().state))))
        .playerFitness.activeSession, active);
      const beforeRetry = snapshotGameState(s.load().state);
      // Durable receipts use the JSON wire representation (undefined keys are omitted).
      assert.deepStrictEqual(await s.host.execute(startRequest), JSON.parse(JSON.stringify({...started, idempotentReplay: true, mutationOutcome: 'replayed'})));
      assert.deepEqual(snapshotGameState(s.load().state), beforeRetry);
      const restored = createSessionHost(s.persistence, {nowMs: () => 1000});
      const busy = await restored.execute({commandId: 'GET_WORKOUT_SELECTION', playerId: 'r1-d-player', parameters: {purpose: 'NORMAL_TROOPS', size}});
      assert.equal(busy.payload.allowed, false); assert.equal(busy.payload.configurationError, undefined);
      const incomplete = await restored.execute({commandId: 'FINALIZE_WORKOUT', playerId: 'r1-d-player', worldAttempt: 0, requestId: nextMutationTestId()});
      assert.equal(incomplete.success, false); assert.equal(s.load().state.playerRewards.bankedTroops, 0);
      const completed = await finish(restored, s); assert.equal(completed.feedback, null);
      const finalRequest = {commandId: 'FINALIZE_WORKOUT', playerId: 'r1-d-player', worldAttempt: 0, requestId: nextMutationTestId()};
      const final = await restored.execute(finalRequest); assert(final.success, JSON.stringify(final.errors));
      const settled = snapshotGameState(s.load().state);
      const reconnected = createSessionHost(s.persistence, {nowMs: () => 1000});
      assert.deepStrictEqual(await reconnected.execute(finalRequest), JSON.parse(JSON.stringify({...final, idempotentReplay: true, mutationOutcome: 'replayed'})));
      const second = await reconnected.execute({...finalRequest, requestId: nextMutationTestId(), parameters: {sessionId: completed.sessionId}});
      assert(second.success, JSON.stringify(second.errors));
      assert.equal(s.load().state.playerRewards.bankedTroops, amount);
      assert.equal(s.load().state.playerRewards.appliedRewards.length, 1);
      assert.deepEqual(s.load().state.playerFitness.activeSession?.completionRewardEntitlement, completed.completionRewardEntitlement);
      assert.deepEqual(s.history.get('r1-d-player', completed.sessionId)?.completionRewardEntitlement, completed.completionRewardEntitlement);
      assert.deepEqual(checkGameStateInvariants(s.load().state), []);
      assert.deepEqual(hydratePersistedPayload(JSON.parse(JSON.stringify(settled))).playerRewards, s.load().state.playerRewards);
    });
  }
  for (const [name, fn] of cases) await report(`Phase 4: ${name}`, async () => {
    const previous = getAuthoredWorkoutCatalog();
    try {await fn(scenario());} finally {installAuthoredWorkoutCatalog(previous);}
  });
}
