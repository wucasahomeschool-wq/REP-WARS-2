import assert from 'node:assert/strict';
import { createScenario, SIZES, RESOURCES } from '../src/simulation/longrun/scenarios';
import { runSimulation, digest, holdings } from '../src/simulation/longrun/runner';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { snapshotGameState } from '../src/persistence/snapshot';
import { cloneGameState } from '../src/state/cloneGameState';
import { availableResource, reservedResource } from '../src/gameplay/trade/resources';

// Standalone, awaited development suite. Never changes the production test runner.
const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);
for (const size of Object.keys(SIZES) as (keyof typeof SIZES)[]) test(`${size}: valid connected authored scenario and exact troop split`, () => {
  const { definition, state } = createScenario({ size, seed: 11, ticks: 60, presence: 'online' });
  assert.equal(checkGameStateInvariants(state).length, 0);
  assert.equal(state.territories.size, SIZES[size].width * SIZES[size].height);
  assert.equal(state.factions.size, SIZES[size].factions + 1);
  assert.equal(holdings(state).troops, definition.factions.reduce((n, f) => n + f.startingArmy.soldiers + f.startingArmy.knights, 0));
  assert([...state.territoryRecruitment.values()].every(p => p.troops === 0));
});
const config = { size: 'small' as const, seed: 11, ticks: 60, presence: 'online' as const, reloadEvery: 10 };
let result: ReturnType<typeof runSimulation>;
test('real authoritative smoke lifecycle and CAS reload', () => {
  result = runSimulation(config);
  assert.equal(result.summary.completed, true, JSON.stringify(result.summary.error));
  assert.deepEqual(result.summary.nestedErrors, []);
  assert(result.summary.decisions > 0 && result.summary.battles > 0);
  assert(result.summary.operationStatuses.completed > 0);
  assert(result.summary.checkpointDigests.length === 6);
});
test('passive required player is excluded from optional AI decisions', () => {
  assert(result.rows.filter(r => r.kind === 'decision').every(r => r.faction !== 'f_observer'));
  const final = hydratePersistedPayload(result.final);
  assert.deepEqual(final.factions.get('f_observer')!.resources, { gold: 0, food: 0, iron: 0, wood: 0, stone: 0 });
  assert.equal(final.playerEmpirePause.paused, true);
});
test('identical seed and inputs reproduce complete canonical output and diagnostic timeline', () => {
  const repeat = runSimulation(config);
  assert.equal(repeat.summary.stateDigest, result.summary.stateDigest);
  assert.equal(digest(repeat.rows), digest(result.rows));
});
test('reload boundaries preserve exact canonical result', () => {
  const uninterrupted = runSimulation({ ...config, reloadEvery: 0 });
  assert.equal(uninterrupted.summary.stateDigest, result.summary.stateDigest);
});
test('troops, siege and each resource reconcile through actual native reducers', () => {
  assert.equal(result.summary.conservation.troopResidual, 0);
  assert.equal(result.summary.conservation.siegeResidual, 0);
  assert(Object.values(result.summary.conservation.resourceResidual).every(n => n === 0));
});
test('claims remain quantity-correct and linked to live canonical operations', () => {
  const final = hydratePersistedPayload(result.final);
  assert.equal(checkGameStateInvariants(final).length, 0);
  for (const claim of final.operationClaims.values()) assert(!final.operations.get(claim.operationId)!.terminal);
  for (const f of final.factions.values()) for (const r of RESOURCES) {
    assert.equal(availableResource(final, f.id, r) + reservedResource(final, f.id, r), f.resources[r]);
    assert(availableResource(final, f.id, r) >= 0);
  }
});
test('no duplicate terminal operation completion', () => {
  const terminals = result.rows.filter(r => r.kind === 'operation' && r.terminal);
  assert.equal(new Set(terminals.map(r => r.id)).size, terminals.length);
});
test('selected exact proactive plans are preserved by committed operations', () => {
  const final = hydratePersistedPayload(result.final);
  let checked = 0;
  for (const row of result.rows.filter(r => r.kind === 'decision')) {
    const commitment = (row.decision as any).commitment;
    const operation = commitment && final.operations.get(commitment.id);
    if (operation) { assert.equal(digest(operation.plan), digest(commitment.plan)); checked++; }
  }
  assert(checked > 0, 'must exercise actual exact-plan handoff');
});
test('no optional decisions after complete faction elimination', () => {
  const final = hydratePersistedPayload(result.final);
  for (const f of final.factions.values()) if (!f.territories.length && !f.armies.length) {
    const lossTicks = result.rows.filter(r => r.kind === 'ownership' && r.from === f.id).map(r => r.tick);
    const lastLoss = Math.max(-1, ...lossTicks);
    assert(!result.rows.some(r => r.kind === 'decision' && r.faction === f.id && r.tick > lastLoss));
  }
});
test('serialize-hydrate-serialize is exact', () => {
  assert.equal(digest(snapshotGameState(hydratePersistedPayload(result.final))), digest(result.final));
});
test('equivalent batching processes the same earned time and physical results', () => {
  const coarse = runSimulation({ ...config, stepTicks: 5 });
  assert.equal(coarse.summary.completed, true);
  assert.deepEqual(coarse.summary.conservation.final, result.summary.conservation.final);
  const a = hydratePersistedPayload(result.final), b = hydratePersistedPayload(coarse.final);
  for (const field of ['armies', 'territories', 'operations', 'operationClaims', 'peaceProposals', 'tradeProposals', 'tradeShipments', 'territoryRecruitment', 'conflictLedger'] as const)
    assert.equal(digest(a[field]), digest(b[field]), `batching differs: ${field}`);
  assert.equal(digest(a), digest(b), 'complete canonical state differs across batching');
});
test('reversed initial Map insertion order yields the same canonical state', () => {
  const reversed = runSimulation({ ...config, reverseInsertion: true });
  assert.equal(reversed.summary.completed, true);
  const semantic = (payload: unknown) => {
    const state = cloneGameState(hydratePersistedPayload(payload));
    // These membership lists are derived from the territory Map. Ordering is
    // representational; keep causal history, timers and RNG ordering intact.
    for (const f of state.factions.values()) f.territories.sort();
    return state;
  };
  assert.equal(digest(semantic(reversed.final)), digest(semantic(result.final)));
  assert.equal(digest(reversed.rows.filter(r => r.kind === 'decision')), digest(result.rows.filter(r => r.kind === 'decision')));
  assert.equal(digest(reversed.rows.filter(r => r.kind === 'battle').map(r => r.result)), digest(result.rows.filter(r => r.kind === 'battle').map(r => r.result)));
});
test('active claims are exercised before terminal cleanup', () => {
  const early = runSimulation({ ...config, ticks: 2 });
  assert.equal(early.summary.completed, true);
  const state = hydratePersistedPayload(early.final);
  assert(state.operationClaims.size > 0, 'must exercise a live claim');
  assert.equal(checkGameStateInvariants(state).length, 0);
  for (const claim of state.operationClaims.values()) assert(!state.operations.get(claim.operationId)!.terminal);
});
test('offline server-authoritative accrual earns the requested world ticks', () => {
  const offline = runSimulation({ ...config, presence: 'offline', ticks: 30 });
  assert.equal(offline.summary.completed, true);
  assert.equal(offline.summary.processedTick, 30);
  assert.equal(offline.summary.earnedTick, 30);
  assert.equal(offline.summary.conservation.troopResidual, 0);
});
for (const size of ['medium','large'] as const) test(`${size}: seeded native action replay and conservation`, () => {
  const c = { ...config, size, ticks: 20, stepTicks: 5 };
  const a = runSimulation(c), b = runSimulation(c);
  assert.equal(a.summary.completed, true);
  assert.deepEqual(a.summary.nestedErrors, []);
  assert.equal(a.summary.stateDigest, b.summary.stateDigest);
  assert.equal(digest(a.rows), digest(b.rows));
  assert.equal(a.summary.conservation.troopResidual, 0);
  assert(Object.values(a.summary.conservation.resourceResidual).every(n => n === 0));
});
let passed = 0, failed = 0;
for (const [name, fn] of tests) { try { fn(); passed++; console.log('PASS', name); } catch (error) { failed++; console.error('FAIL', name, error); } }
console.log(JSON.stringify({ passed, failed, skipped: 0 }));
if (failed) process.exitCode = 1;
