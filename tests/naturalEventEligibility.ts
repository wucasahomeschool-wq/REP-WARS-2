import {effectiveResourceOutput} from '../src/gameplay/economy/effectiveOutput';
import assert from 'assert';
import {initializePlayerWorld} from '../src/persistence/initializePlayerWorld';
import {candidateTerritoriesForEvents, buildConditionContext, COMMON_ELIGIBILITY} from '../src/events/EventTriggers';
import {EVENT_LIST, evaluateAllTriggersForTerritory} from '../src/events/EventDefinitions';
import {WorldSimulator} from '../src/events/WorldSimulator';
import {ActiveEvent} from '../src/events/EventModel';
import {SeededRNG} from '../src/utils/SeededRNG';
import {BALANCE} from '../src/constants/balance';
import {runEventEngineTurn} from '../src/world/eventTick';
import {GameState} from '../src/types/GameState';
import {snapshotGameState} from '../src/persistence/snapshot';
import {hydratePersistedPayload} from '../src/persistence/hydrate';
import {checkGameStateInvariants} from '../src/state/gameStateInvariants';
import {consumeEmpireFood} from '../src/gameplay/economy/foodConsumption';
import {createSessionHost, PersistenceFailedError} from '../src/server/session';
import {createInMemoryPersistence, PlayerWorldPersistence} from '../src/server/persistencePort';
import {InMemoryGameStateStore} from '../src/persistence/inMemoryGameStateStore';
import {accrueWorldThroughReceipt} from '../src/world/worldAccrual';
import {openGameplaySessionLease} from '../src/world/presenceLeases';
import {gameplaySnapshot} from './mutationTestRequests';
import {createCommandHttpServer} from '../src/server/http';
import {request as httpRequest} from 'node:http';

const PLAYER = 'phase5a-player';
const fresh = (worldId = 'Level 2', seed = 11) => initializePlayerWorld({playerId: PLAYER, worldId, seed}).state;
const reload = (s: GameState) => hydratePersistedPayload(JSON.parse(JSON.stringify(snapshotGameState(s))));
const candidates = (s: GameState) => candidateTerritoriesForEvents(s.territories, s.activeEvents);
function scores(s: GameState, id: string) {
  return evaluateAllTriggersForTerritory(buildConditionContext(s.turn, id, s.territories.get(id)!.owner,
    s.territories, s.factions, s.activeEvents, new SeededRNG(s.worldSeed)));
}
/** Controlled lifecycle records, not new event types or production content. */
function active(typeId: string, territoryId: string, index = 0): ActiveEvent {
  const def = EVENT_LIST.find(e => e.typeId === typeId)!;
  return {instanceId: `fixture-${typeId}-${index}`, typeId, category: def.category, title: 'Existing event fixture', description: '',
    causes: [], severity: 'minor', status: 'active', territoryId, factionId: null, triggeredTurn: 0,
    durationTurns: 10, startedTurn: 0, expiresTurn: 10, consequences: [], chainDelays: [], choicesPending: []};
}
function earned(online: boolean, ticks = 70) {
  const s = fresh(); accrueWorldThroughReceipt(s, 1000);
  const now = 1000 + ticks * (online ? 60000 : 600000) + (online ? 30000 : 300000);
  if (online) s.gameplaySessionLeases = [openGameplaySessionLease({sessionId: 'phase5a-lease', receiptMs: 1000, leaseDurationMs: now - 1000 + 1000})];
  return {s, now};
}
function hosted(s: GameState, now: number, budget = 100, wrap?: (p: PlayerWorldPersistence) => PlayerWorldPersistence) {
  const store = new InMemoryGameStateStore(); assert(store.save(PLAYER, s, 0).ok);
  const base = createInMemoryPersistence(store), persistence = wrap ? wrap(base) : base;
  const options = {nowMs: () => now, maxCatchUpChunks: budget};
  const load = () => {const r = store.load(PLAYER); assert(r.ok); return r;};
  return {store, persistence, options, load, host: createSessionHost(persistence, options)};
}
const sync = (id: string) => ({commandId: 'SYNC_PLAYER_WORLD', playerId: PLAYER, requestId: id, worldAttempt: 0});

export async function runNaturalEventEligibilityTests(report: (name: string, fn: () => void | Promise<void>) => Promise<void>) {
  const test = (name: string, fn: () => void | Promise<void>) => report(`Phase 5A: ${name}`, fn);
  for (const world of ['Level 1', 'Level 2']) await test(`fresh ${world} zero-population territories can trigger natural events`, () => {
    const s = fresh(world), owned = [...s.territories.values()].filter(t => t.owner).map(t => t.id);
    assert([...s.territories.values()].every(t => t.population === 0));
    assert.deepStrictEqual(candidates(s), owned);
    const result = runEventEngineTurn(s, new WorldSimulator());
    assert(result.triggered > 0);
    assert([...s.territories.values()].every(t => t.population === 0));
    assert.deepStrictEqual(checkGameStateInvariants(s), []);
  });
  await test('ownership and the existing concurrent-event cap still exclude invalid territories', () => {
    const s = fresh(), id = [...s.territories.keys()][0]!;
    s.territories.get(id)!.owner = null;
    assert(!candidates(s).includes(id)); assert.deepStrictEqual(scores(s, id), []);
    s.territories.get(id)!.owner = s.playerFactionId;
    s.activeEvents = Array.from({length: BALANCE.events.world.sameTerritoryMaxConcurrentActive}, (_, i) => active(EVENT_LIST[i]!.typeId, id, i));
    assert(!candidates(s).includes(id));
    s.activeEvents[0]!.status = 'expired'; assert(candidates(s).includes(id));
  });
  await test('each existing event type rejects its own active duplicate without disabling unrelated events', () => {
    const s = fresh(), id = candidates(s)[0]!; assert(id);
    for (const def of EVENT_LIST) {
      s.activeEvents = []; assert(scores(s, id).some(row => row.eventId === def.id));
      s.activeEvents = [active(def.typeId, id)];
      assert(!scores(s, id).some(row => row.eventId === def.id));
      assert(scores(s, id).length > 0);
    }
  });
  await test('zero population does not zero any current trigger weight or rewrite event-specific population predicates', () => {
    const s = fresh(), id = candidates(s)[0]!, zero = scores(s, id);
    assert(zero.length > 0); assert(zero.every(row => row.weight > 0));
    const context = () => buildConditionContext(s.turn, id, s.territories.get(id)!.owner, s.territories, s.factions, [], new SeededRNG(11));
    assert.equal(COMMON_ELIGIBILITY.populationThreshold(2000)(context()), false);
    s.territories.get(id)!.population = 3000; // Contrast only; no production initialization change.
    assert.equal(COMMON_ELIGIBILITY.populationThreshold(2000)(context()), true);
    assert.deepStrictEqual(scores(s, id), zero);
  });
  await test('Food shortage and resulting Stability loss increase existing weights on zero-population owned territory', () => {
    const s = fresh(), id = [...s.territories.values()].find(t => t.owner === s.playerFactionId)!.id;
    const faction = s.factions.get(s.playerFactionId!)!;
    const before = scores(s, id), oldStability = faction.stability;
    faction.resources.food = 0; // Depleted-bank fixture; use existing upkeep to lower Stability.
    s.worldTick = 60 * 40; s.accruedTargetWorldTick = s.worldTick;
    consumeEmpireFood(s); assert(faction.stability < oldStability);
    assert(candidates(s).includes(id));
    const after = scores(s, id), weight = (rows: typeof before, eventId: string) => rows.find(r => r.eventId === eventId)!.weight;
    assert(weight(after, 'evt_food_shortage') > weight(before, 'evt_food_shortage'));
    assert(weight(after, 'evt_rebellion') > weight(before, 'evt_rebellion'));
    assert(s.territories.get(id)!.population === 0);
  });
  await test('existing terrain preferences remain weights rather than newly invented hard gates', () => {
    const s = fresh(), id = candidates(s)[0]!, t = s.territories.get(id)!;
    t.terrain = 'plains'; const dry = scores(s, id).find(r => r.eventId === 'evt_flood')!;
    t.terrain = 'river'; const river = scores(s, id).find(r => r.eventId === 'evt_flood')!;
    assert(dry.weight > 0); assert(river.weight > dry.weight);
  });
  await test('existing history cooldown blocks repeat activation until its established boundary', () => {
    const s = fresh();
    for (const t of s.territories.values()) for (const def of EVENT_LIST) s.eventHistory.push({
      id: `prior-${t.id}-${def.typeId}`, turn: 0, typeId: def.typeId, kind: 'trigger', territoryId: t.id, message: 'Prior outcome fixture'});
    const simulator = new WorldSimulator(), before = structuredClone(s.eventHistory);
    for (let i = 1; i < BALANCE.events.world.sameEventCooldownTurns; i++) {
      assert.equal(runEventEngineTurn(s, simulator).triggered, 0);
      assert.deepStrictEqual(s.eventHistory, before);
    }
    assert(runEventEngineTurn(s, simulator).triggered > 0);
    // History is the existing rolling cooldown window, not an archival ledger.
    assert(s.eventHistory.every(h => h.turn === BALANCE.events.world.sameEventCooldownTurns));
  });
  await test('Flood zero losses round-trip exactly without changing nonzero population loss', () => {
    const s = fresh(), id = candidates(s)[0]!, flood = EVENT_LIST.find(e => e.typeId === 'flood')!;
    for (const population of [0, 1, 2000, 3000]) {
      s.territories.get(id)!.population = population;
      const ctx = buildConditionContext(s.turn, id, s.territories.get(id)!.owner, s.territories, s.factions, [], new SeededRNG(11));
      const result = flood.onTrigger(ctx, 'minor');
      const loss = result.consequences[0]!.delta.populationDeltaAbs;
      assert(!Object.is(loss, -0));
      assert.equal(loss, Math.round(BALANCE.events.consequenceMagnitudes.floodPopulationPctPerSeverity * population) || 0);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(result.consequences)), result.consequences);
    }
  });
  for (const seed of [3, 11, 29]) await test(`seed ${seed} replays exact canonical consequences across multiple save boundaries`, () => {
    const a = fresh('Level 2', seed); let b = reload(a);
    for (let i = 0; i < 12; i++) {
      runEventEngineTurn(a, new WorldSimulator()); runEventEngineTurn(b, new WorldSimulator());
      if (i % 3 === 0) b = reload(b);
      assert.deepStrictEqual(snapshotGameState(b), snapshotGameState(a));
    }
    assert(a.eventHistory.length > 0); assert.equal(a.schemaVersion, 32);
  });
  await test('legacy zero-population snapshot loads without migration population grants or history reset', () => {
    const s = fresh(), before = snapshotGameState(s), b = reload(s);
    assert.deepStrictEqual(snapshotGameState(b), before); assert(candidates(b).length > 0);
    runEventEngineTurn(b, new WorldSimulator()); const historical = structuredClone(b.eventHistory), after = reload(b);
    assert.deepStrictEqual(after.eventHistory, historical); assert.deepStrictEqual(after.activeEvents, b.activeEvents);
    assert([...after.territories.values()].every(t => t.population === 0));
  });
  await test('naturally earned production increases remain canonical across hydrate', () => {
    const s = fresh(), initial = s.territories.get('t_07')!.resourceOutput.gold;
    runEventEngineTurn(s, new WorldSimulator());
    assert(s.eventHistory.some(e => e.typeId === 'resource_discovery'));
    assert.equal(s.territories.get('t_07')!.resourceOutput.gold, initial);
    assert(effectiveResourceOutput(s, s.territories.get('t_07')!).gold > initial!);
    assert.deepStrictEqual(snapshotGameState(reload(s)), snapshotGameState(s));
  });
  for (const online of [false, true]) await test(`${online ? 'online' : 'offline'} accrued backlog and seeded consequences agree across reloaded 64-tick chunks`, async () => {
    const {s, now} = earned(online), a = hosted(s, now), b = hosted(s, now, 1);
    assert((await a.host.execute(sync('whole'))).success);
    assert((await b.host.execute(sync('slice-1'))).success);
    assert.equal(b.load().state.worldTick, 64); assert.equal(b.load().state.accruedTargetWorldTick, 70);
    assert((await createSessionHost(b.persistence, b.options).execute(sync('slice-2'))).success);
    assert.equal(b.load().state.worldTick, 70); assert.equal(b.load().state.subTickMicroticks, 500000);
    assert(b.load().state.eventHistory.length > 0);
    assert.deepStrictEqual(gameplaySnapshot(b.load().state), gameplaySnapshot(a.load().state));
    assert.deepStrictEqual(checkGameStateInvariants(b.load().state), []);
  });
  await test('failed commit does not consume event randomness; retry equals control', async () => {
    const {s, now} = earned(false, 8); let fail = true;
    const a = hosted(s, now, 1, p => ({...p, save(...args) {if (fail) {fail = false; throw new Error('phase5a failed commit');} return p.save(...args);}}));
    const b = hosted(s, now, 1), before = snapshotGameState(a.load().state), req = sync('retry');
    await assert.rejects(a.host.execute(req), /phase5a failed commit/);
    assert.deepStrictEqual(snapshotGameState(a.load().state), before);
    assert((await a.host.execute(req)).success); assert((await b.host.execute(req)).success);
    assert.deepStrictEqual(snapshotGameState(a.load().state), snapshotGameState(b.load().state));
  });
  await test('stale writer cannot replace committed event history and identical retry recovers one result', async () => {
    const {s, now} = earned(false, 8), f = hosted(s, now), other = createSessionHost(f.persistence, f.options);
    await other.execute({commandId: 'GET_GAME_STATE', playerId: PLAYER});
    const req = sync('winner'); assert((await f.host.execute(req)).success); const before = f.load();
    await assert.rejects(other.execute(sync('stale')), (e: unknown) => e instanceof PersistenceFailedError && e.code === 'persistence.conflict');
    assert.deepStrictEqual(snapshotGameState(f.load().state), snapshotGameState(before.state));
    assert.equal((await other.execute(req)).idempotentReplay, true); assert.equal(f.load().record.stateVersion, before.record.stateVersion);
  });
  await test('authenticated public sync triggers natural events once and durable retry after reconnect does not write', async () => {
    const {s, now} = earned(false, 8), f = hosted(s, now);
    const server = createCommandHttpServer(f.host, {identity: {mode: 'authenticated', authenticate: () => PLAYER}});
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); assert(address && typeof address !== 'string');
      const post = () => new Promise<any>((resolve, reject) => {
        const req = httpRequest({host: '127.0.0.1', port: address.port, path: '/commands', method: 'POST', agent: false,
          headers: {'content-type': 'application/json', connection: 'close'}}, res => {
          let body = ''; res.on('data', c => body += c); res.on('end', () => {try {assert.equal(res.statusCode, 200); resolve(JSON.parse(body));} catch (e) {reject(e);}});
        }); req.on('error', reject); req.end(JSON.stringify(sync('http-sync')));
      });
      const first = await post(); assert(first.success, JSON.stringify(first.errors));
      const before = f.load(); assert(before.state.eventHistory.some(e => e.kind === 'trigger'));
      assert.equal((await post()).idempotentReplay, true);
      assert.equal((await createSessionHost(f.persistence, f.options).execute(sync('http-sync'))).idempotentReplay, true);
      assert.deepStrictEqual(snapshotGameState(f.load().state), snapshotGameState(before.state));
      assert.equal(f.load().record.stateVersion, before.record.stateVersion);
    } finally {await new Promise<void>(resolve => server.close(() => resolve()));}
  });
}
