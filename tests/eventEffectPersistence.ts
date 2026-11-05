import assert from 'node:assert/strict';
import {createGameState} from '../src/state/createGameState';
import {cloneGameState} from '../src/state/cloneGameState';
import {loadProductionLevel2Definition} from '../src/worldDefinition/catalog';
import {WorldSimulator} from '../src/events/WorldSimulator';
import {runEventEngineTurn} from '../src/world/eventTick';
import {snapshotGameState} from '../src/persistence/snapshot';
import {hydratePersistedPayload} from '../src/persistence/hydrate';
import {persistAllTerritoryAccrual} from '../src/gameplay/economy/accrual';
import {checkGameStateInvariants} from '../src/state/gameStateInvariants';
import {GameState} from '../src/types/GameState';
import {toWorldStepInput} from '../src/state/gameStateAdapters';
import {mergeEventStepOntoGameState} from '../src/orchestration/applyEvents';
import {encodePersistable} from '../src/persistence/serialization';
import {getDefaultWorldCatalog} from '../src/worldDefinition/catalog';
import {createSessionHost, PersistenceFailedError} from '../src/server/session';
import {createInMemoryPersistence, PlayerWorldPersistence} from '../src/server/persistencePort';
import {InMemoryGameStateStore} from '../src/persistence/inMemoryGameStateStore';
import {accrueWorldThroughReceipt} from '../src/world/worldAccrual';
import {openGameplaySessionLease} from '../src/world/presenceLeases';
import {gameplaySnapshot} from './mutationTestRequests';
import {RESOURCE_KEYS} from '../src/gameplay/economy/config';

/** Explicit event-eligible fixture: actual registered Level 2, unchanged authored
 * rates; population 3000 replaces the independently unresolved eligibility gap. */
function naturalDiscovery() {
  const definition=loadProductionLevel2Definition();assert(definition.ok);
  const state=createGameState({world:definition.definition,seed:11});
  for(const t of state.territories.values())t.population=3000;
  const before=state.territories.get('t_07')!.resourceOutput.gold;
  const event=runEventEngineTurn(state,new WorldSimulator());
  assert(event.events.some(e=>e.id==='resource_discovery'));
  assert.equal(before,1);assert.equal(state.territories.get('t_07')!.resourceOutput.gold,2);
  assert.deepEqual(checkGameStateInvariants(state),[]);
  return state;
}
function reload(s:GameState) {return hydratePersistedPayload(JSON.parse(JSON.stringify(snapshotGameState(s))));}
/** Economy component probe: use canonical clock/production watermarks without
 * triggering additional unrelated events or AI decisions. Full runtime tests follow. */
function produce(s:GameState,tick:number) {
  s.worldTick=tick;s.accruedTargetWorldTick=tick;persistAllTerritoryAccrual(s);
  assert.deepEqual(checkGameStateInvariants(s),[]);
}
export async function runEventEffectPersistenceTests(report:(name:string,fn:()=>void|Promise<void>)=>Promise<void>) {
  await report('Phase 3: natural Resource Discovery production and canonical state survive a mid-cycle reload',()=>{
    const a=naturalDiscovery();produce(a,30);const b=reload(a);
    produce(a,120);produce(b,120);
    const owner=a.territories.get('t_07')!.owner!;
    console.log('PHASE3_DISCOVERY_PROBE',JSON.stringify({continuousOutput:a.territories.get('t_07')!.resourceOutput,
      reloadedOutput:b.territories.get('t_07')!.resourceOutput,continuousBank:a.factions.get(owner)!.resources,
      reloadedBank:b.factions.get(owner)!.resources}));
    assert.deepEqual(snapshotGameState(b),snapshotGameState(a));
  });
  await runAdditionalTests(report);
}

/** Controlled active-event fixture, not authored content or a new event type.
 * A high already-applied Food rate makes each rounded recurring delta observable.
 * Population remains the real registered value, so unrelated natural events stay quiet. */
function recurringDrought(): GameState {
  const definition = loadProductionLevel2Definition(); assert(definition.ok);
  const state = createGameState({world: definition.definition, seed: 11});
  state.territories.get('t_07')!.resourceOutput.food = 100;
  state.activeEvents.push({instanceId: 'phase3-drought', typeId: 'drought', category: 'environmental',
    title: 'Drought fixture', description: 'Existing recurring effect', causes: ['fixture'], severity: 'critical',
    status: 'active', territoryId: 't_07', factionId: null, triggeredTurn: 0, startedTurn: 0,
    durationTurns: 3, expiresTurn: 3, consequences: [], chainSuppressed: true, chainDelays: [], choicesPending: []});
  assert.deepEqual(checkGameStateInvariants(state), []);
  return state;
}
function eventAndProductionTick(state: GameState) {
  runEventEngineTurn(state, new WorldSimulator());
  produce(state, state.worldTick + 1);
}


function hosted(initial: GameState, now: number, budget: number,
  wrap?: (p: PlayerWorldPersistence) => PlayerWorldPersistence) {
  const store = new InMemoryGameStateStore(), base = createInMemoryPersistence(store);
  assert(store.save('phase3-player', initial, 0).ok);
  const persistence = wrap ? wrap(base) : base;
  const options = {nowMs: () => now, maxCatchUpChunks: budget};
  const load = () => {const r = store.load('phase3-player'); assert(r.ok); return r;};
  const host = createSessionHost(persistence, options);
  return {store, persistence, options, host, load};
}
const syncRequest = (id: string) => ({commandId: 'SYNC_PLAYER_WORLD', playerId: 'phase3-player',
  worldAttempt: 0, requestId: id});
function accruedFixture(online: boolean, ticks: number) {
  const s = naturalDiscovery();
  accrueWorldThroughReceipt(s, 1000);
  const now = 1000 + ticks * (online ? 60000 : 600000) + (online ? 30000 : 300000);
  if (online) s.gameplaySessionLeases = [openGameplaySessionLease({sessionId: 'phase3-online',
    receiptMs: 1000, leaseDurationMs: now - 1000 + 1000})];
  return {s, now};
}

async function runAdditionalTests(report: (name: string, fn: () => void | Promise<void>) => Promise<void>) {
  for (const at of [0, 1, 29, 59, 60, 120]) await report(`Phase 3: instant event reload at production tick ${at} preserves earned banks and accrual watermarks`, () => {
    const a = naturalDiscovery(); produce(a, at);
    const before = snapshotGameState(a), b = reload(reload(a));
    assert.deepEqual(snapshotGameState(b), before);
    produce(b, at); assert.deepEqual(snapshotGameState(b), before);
    produce(a, 180); produce(b, 180);
    assert.deepEqual(snapshotGameState(b), snapshotGameState(a));
  });
  for (const at of [0, 1, 2, 3, 4]) await report(`Phase 3: recurring drought reload at turn ${at} preserves inclusive expiry and lasting losses`, () => {
    const a = recurringDrought();
    for (let i = 0; i < at; i++) eventAndProductionTick(a);
    const b = reload(a);
    for (let i = at; i < 6; i++) {
      const previous = a.territories.get('t_07')!.resourceOutput.food!;
      eventAndProductionTick(a); eventAndProductionTick(b);
      const current = a.territories.get('t_07')!.resourceOutput.food!;
      if (i < 3) assert(current < previous); else assert.equal(current, previous);
      assert.deepEqual(snapshotGameState(b), snapshotGameState(a));
    }
    const event = a.activeEvents.find(e => e.instanceId === 'phase3-drought')!;
    assert.equal(event.status, 'expired'); assert.equal(event.expiresTurn, 3);
    assert.equal(a.eventHistory.filter(h => h.typeId === 'drought' && h.kind === 'expire').length, 1);
    assert.deepEqual(snapshotGameState(reload(b)), snapshotGameState(a));
  });
  await report('Phase 3: supported choice cost, selected consequence, shortened deadline and chain suppression persist once', () => {
    const state = naturalDiscovery(), simulator = new WorldSimulator();
    const event = state.activeEvents.find(e => e.typeId === 'food_shortage')!;
    assert(event); assert(event.choicesPending.some(c => c.id === 'import_food'));
    const owner = state.territories.get(event.territoryId!)!.owner!;
    const beforeGold = state.factions.get(owner)!.resources.gold;
    const result = simulator.resolveChoice({...toWorldStepInput(state), activeEventInstanceId: event.instanceId, choiceId: 'import_food'});
    assert(result.paidCost && result.paidCost.gold! > 0);
    mergeEventStepOntoGameState(state, {newActiveEvents: result.updatedActive, newEventHistory: result.updatedHistory,
      triggeredEvents: [], perTurnConsequences: [], expiredEvents: [], unresolvedDecisions: [], summary: result.messages,
      mutatedTerritories: result.mutatedTerritories, mutatedFactions: result.mutatedFactions, mutatedArmies: result.mutatedArmies});
    assert.equal(state.factions.get(owner)!.resources.gold, beforeGold - result.paidCost.gold!);
    const chosen = state.activeEvents.find(e => e.instanceId === event.instanceId)!;
    assert.equal(chosen.choiceTaken!.id, 'import_food'); assert.equal(chosen.chainSuppressed, true);
    assert(chosen.expiresTurn <= event.expiresTurn); assert.equal(chosen.choicesPending.length, 0);
    const restored = reload(state); assert.deepEqual(snapshotGameState(restored), snapshotGameState(state));
    const duplicate = simulator.resolveChoice({...toWorldStepInput(restored), activeEventInstanceId: event.instanceId, choiceId: 'import_food'});
    assert.equal(duplicate.paidCost, undefined); assert.deepEqual(duplicate.updatedHistory, restored.eventHistory);
    assert.deepEqual(duplicate.mutatedFactions.get(owner)!.resources, restored.factions.get(owner)!.resources);
    for (let i = 0; i < 8; i++) {eventAndProductionTick(state); eventAndProductionTick(restored);}
    assert.deepEqual(snapshotGameState(restored), snapshotGameState(state));
  });
  for (const online of [false, true]) await report(`Phase 3: ${online ? 'online' : 'offline'} full authoritative catch-up equals persisted chunks with active events and AI`, async () => {
    const {s, now} = accruedFixture(online, 150);
    const whole = hosted(s, now, 100), sliced = hosted(s, now, 1);
    assert((await whole.host.execute(syncRequest('phase3-whole'))).success);
    for (let i = 0; i < 3; i++) {
      const response = await createSessionHost(sliced.persistence, sliced.options).execute(syncRequest(`phase3-slice-${i}`));
      assert(response.success, JSON.stringify(response.errors));
      const state = sliced.load().state;
      assert.deepEqual(checkGameStateInvariants(state), []);
      assert.equal(state.accruedTargetWorldTick, 150);
      assert.equal(state.worldTick, Math.min(64 * (i + 1), 150));
    }
    assert.equal(whole.load().state.subTickMicroticks, 500000);
    assert.deepEqual(gameplaySnapshot(sliced.load().state), gameplaySnapshot(whole.load().state));
  });
  await report('Phase 3: failed event commit is rolled back; retry matches the committed deterministic outcome', async () => {
    const {s, now} = accruedFixture(false, 8); let fail = true;
    const failing = hosted(s, now, 1, p => ({...p, save(...args) {
      if (fail) {fail = false; throw new Error('phase3 injected failure');} return p.save(...args);
    }})), control = hosted(s, now, 1);
    const before = snapshotGameState(failing.load().state), request = syncRequest('phase3-failed-retry');
    await assert.rejects(failing.host.execute(request), /phase3 injected failure/);
    assert.deepEqual(snapshotGameState(failing.load().state), before);
    assert((await failing.host.execute(request)).success); assert((await control.host.execute(request)).success);
    assert.deepEqual(snapshotGameState(failing.load().state), snapshotGameState(control.load().state));
  });
  await report('Phase 3: lost event-commit acknowledgment replays durable receipt without new production or event history', async () => {
    const {s, now} = accruedFixture(false, 8); let lose = true;
    const f = hosted(s, now, 1, p => ({...p, save(...args) {
      const saved = p.save(...args); if (saved.ok && lose) {lose = false; throw new Error('phase3 lost response');} return saved;
    }}));
    const request = syncRequest('phase3-lost');
    const recovered = await f.host.execute(request);
    assert.equal(lose, false); assert.equal(recovered.idempotentReplay, true);
    const before = f.load();
    const replay = await createSessionHost(f.persistence, f.options).execute(request);
    assert.equal(replay.idempotentReplay, true);
    assert.deepEqual(snapshotGameState(f.load().state), snapshotGameState(before.state));
    assert.equal(f.load().record.stateVersion, before.record.stateVersion);
  });
  await report('Phase 3: independent stale writer cannot replace committed event consequences; identical retry is one effect', async () => {
    const {s, now} = accruedFixture(false, 8), f = hosted(s, now, 1);
    const other = createSessionHost(f.persistence, f.options);
    await other.execute({commandId: 'GET_GAME_STATE', playerId: 'phase3-player'});
    const request = syncRequest('phase3-winner'); assert((await f.host.execute(request)).success);
    const before = f.load();
    await assert.rejects(other.execute(syncRequest('phase3-stale')), (e: unknown) => e instanceof PersistenceFailedError && e.code === 'persistence.conflict');
    assert.deepEqual(snapshotGameState(f.load().state), snapshotGameState(before.state));
    const retry = await other.execute(request); assert.equal(retry.idempotentReplay, true);
    assert.equal(f.load().record.stateVersion, before.record.stateVersion);
  });
  await report('Phase 3: registered immutable geography is rebound while canonical event output remains saved', () => {
    const s = naturalDiscovery(), original = cloneGameState(s), t = s.territories.get('t_07')!;
    t.terrain = 'desert'; t.regionId = 'wrong'; t.neighboring = [];
    const restored = hydratePersistedPayload(encodePersistable(s));
    assert.deepEqual(snapshotGameState(restored), snapshotGameState(original));
  });
  await report('Phase 3: retaining event output does not authorize changed authored content under the same world identity', () => {
    const s = naturalDiscovery(), catalog = getDefaultWorldCatalog(), saved = catalog.get(s.definitionWorldId!)!;
    const changed = structuredClone(saved); changed.territories[0]!.resourceOutput.gold = 999;
    catalog.register(changed);
    try {assert.throws(() => reload(s), /content differs/);} finally {catalog.register(saved);}
  });
  for (const version of [29, 30, 31, 32]) await report(`Phase 3: schema ${version} valid event output and earned balances migrate without replay or invention`, () => {
    const s = naturalDiscovery(); produce(s, 60);
    const legacy = cloneGameState(s);
    // Schema <=30 held production in uncollected local yield, not in the bank.
    // Represent that actual old accounting shape; migration must move it once.
    if (version < 31) for (const [id, rec] of legacy.territoryEconomy) {
      const owner = legacy.territories.get(id)!.owner;
      if (owner) for (const key of RESOURCE_KEYS) legacy.factions.get(owner)!.resources[key] -= rec.uncollected[key] ?? 0;
    }
    const payload = snapshotGameState(legacy) as Record<string, unknown>; payload.schemaVersion = version;
    if (version < 32) { delete payload.worldAttempt; delete payload.commandReceipts; }
    if (version < 30) delete payload.definitionContentFingerprint;
    const restored = hydratePersistedPayload(payload);
    assert.equal(restored.schemaVersion, 32);
    for (const [id, t] of s.territories) assert.deepEqual(restored.territories.get(id)!.resourceOutput, t.resourceOutput);
    for (const [id, f] of s.factions) assert.deepEqual(restored.factions.get(id)!.resources, f.resources);
    assert.deepEqual(restored.activeEvents, s.activeEvents); assert.deepEqual(restored.eventHistory, s.eventHistory);
    assert.deepEqual(snapshotGameState(reload(restored)), snapshotGameState(restored));
  });
  await report('Phase 3: a historically erased rate is not fabricated from event history on load', () => {
    const s = naturalDiscovery(); s.territories.get('t_07')!.resourceOutput.gold = 1;
    assert.deepEqual(snapshotGameState(reload(s)), snapshotGameState(s));
  });
  await report('Phase 3: malformed canonical production fails snapshot and hydration instead of being masked by authored defaults', () => {
    for (const value of [null, undefined, [], {food: -1}, {food: '5'}, {unobtainium: 1}]) {
      const s = naturalDiscovery(); (s.territories.get('t_07') as unknown as {resourceOutput: unknown}).resourceOutput = value;
      assert.throws(() => snapshotGameState(s), /canonical resource output/);
      assert.throws(() => hydratePersistedPayload(encodePersistable(s)), /canonical resource output/);
    }
    for (const value of [NaN, Infinity]) {
      const s = naturalDiscovery(); s.territories.get('t_07')!.resourceOutput.food = value;
      assert.throws(() => snapshotGameState(s), /canonical resource output/);
    }
  });
  await report('Phase 3: zero, optional resource keys and valid finite output round-trip without rebinding', () => {
    for (const output of [{}, {food: 0}, {food: 2.5, gold: 4, wood: 8, iron: 3, stone: 7}]) {
      const s = naturalDiscovery(); s.territories.get('t_07')!.resourceOutput = output;
      assert.deepEqual(snapshotGameState(reload(s)), snapshotGameState(s));
    }
  });
}

if (require.main === module) {
  let passed = 0;
  runEventEffectPersistenceTests(async (name, fn) => {await fn(); passed++; console.log('PASS ' + name);})
    .then(() => console.log(`${passed} passed, 0 failed`))
    .catch(e => {console.error(e); process.exitCode = 1;});
}
