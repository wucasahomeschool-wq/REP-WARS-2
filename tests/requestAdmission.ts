import assert from 'node:assert/strict';
import { request } from 'node:http';
import { inspect } from 'node:util';
import { createSessionHost, CommandSessionHost, SessionHostOptions, RequestCapacityError, PersistenceFailedError } from '../src/server/session';
import { createCommandHttpServer } from '../src/server/http';
import { createInMemoryPersistence, PlayerWorldPersistence } from '../src/server/persistencePort';
import { InMemoryGameStateStore } from '../src/persistence/inMemoryGameStateStore';
import { snapshotGameState } from '../src/persistence/snapshot';

type Report = (name: string, test: () => Promise<void>) => Promise<void>;
type Limits = SessionHostOptions;
const read = (host: CommandSessionHost, playerId: string) => host.execute({ commandId: 'GET_GAME_STATE', playerId });
const busy = (error: unknown) => error instanceof Error && error.name === 'RequestCapacityError';
function fixture(options: Limits = {}, wrap?: (port: PlayerWorldPersistence) => PlayerWorldPersistence) {
  const store = new InMemoryGameStateStore(), base = createInMemoryPersistence(store), loaded: string[] = [];
  const counted: PlayerWorldPersistence = { ...base, ensure(id) { loaded.push(id); return base.ensure(id); } };
  const host = createSessionHost(wrap ? wrap(counted) : counted, { nowMs: () => 1000, ...options });
  function load(id: string) { const result = store.load(id); assert.ok(result.ok); return result.state; }
  return { store, base, host, loaded, load };
}

async function serve(host: CommandSessionHost, run: (post: (path: string, body: unknown) => Promise<{ status: number; raw: string }>) => Promise<void>, report: (value: unknown) => void = () => {}) {
  const server = createCommandHttpServer(host, { identity: { mode: 'authenticated', authenticate: () => 'a' }, onInternalError: report });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const post = (path: string, body: unknown) => new Promise<{ status: number; raw: string }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: address.port, path, method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({ status: res.statusCode!, raw: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
  try { await run(post); } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

export async function runRequestAdmissionTests(report: Report): Promise<void> {
  await report('admission: total capacity rejects before loading another world and recovers after completion', async () => {
    const s = fixture({ maxPendingRequests: 2 });
    const a = read(s.host, 'a'), b = read(s.host, 'b');
    const rejected = assert.rejects(read(s.host, 'c'), busy);
    const loadedBeforeCompletion = [...s.loaded];
    await Promise.all([a, b, rejected]);
    assert.deepEqual(loadedBeforeCompletion, ['a', 'b']);
    assert.ok((await read(s.host, 'c')).success);
    assert.deepEqual(s.loaded, ['a', 'b', 'c']);
  });
  await report('admission: per-player capacity leaves room for another player without reordering accepted work', async () => {
    const s = fixture({ maxPendingRequests: 3, maxPendingRequestsPerPlayer: 1 });
    const first = s.host.execute({ commandId: 'SET_PLAYER_PAUSE', playerId: 'a', parameters: { paused: true } });
    const rejected = assert.rejects(s.host.execute({ commandId: 'SET_PLAYER_PAUSE', playerId: 'a', parameters: { paused: false } }), busy);
    const other = read(s.host, 'b');
    await Promise.all([first, rejected, other]);
    assert.equal(s.load('a').playerEmpirePause.paused, true);
    assert.ok((await read(s.host, 'a')).success);
  });
  await report('admission: default per-player limit admits sixteen pending requests', async () => {
    const s = fixture();
    const accepted = Array.from({ length: 16 }, () => read(s.host, 'a'));
    await Promise.all([...accepted, assert.rejects(read(s.host, 'a'), busy)]);
    assert.ok((await read(s.host, 'a')).success);
  });
  await report('admission: default global limit admits 256 pending requests across players', async () => {
    const s = fixture();
    const accepted = Array.from({ length: 256 }, (_, i) => read(s.host, `player-${Math.floor(i / 8)}`));
    const rejected = assert.rejects(read(s.host, 'overflow'), busy);
    const overflowLoaded = s.loaded.includes('overflow');
    await Promise.all([...accepted, rejected]);
    assert.equal(overflowLoaded, false);
    assert.ok((await read(s.host, 'overflow')).success);
  });
  await report('admission: malformed deployment limits fail before persistence access', async () => {
    for (const key of ['maxPendingRequests', 'maxPendingRequestsPerPlayer'] as const) {
      for (const invalid of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '4']) {
        assert.throws(() => fixture({ [key]: invalid as unknown as number }, port => ({ ...port,
          ensure() { assert.fail('Invalid configuration accessed persistence'); },
        })), new RegExp(key));
      }
    }
  });
  await report('admission: boot failures release capacity without poisoning later requests', async () => {
    let fail = true;
    const s = fixture({ maxPendingRequests: 1 }, port => ({ ...port, ensure(id) {
      if (fail) { fail = false; throw new Error('injected boot failure'); }
      return port.ensure(id);
    } }));
    // The host historically permits synchronous boot failure; either delivery
    // style must leave its new admission accounting reusable.
    await assert.rejects(async () => read(s.host, 'a'), /boot failure/);
    assert.ok((await read(s.host, 'b')).success);
  });
  await report('admission: thrown persistence and normal validation failures release capacity', async () => {
    let fail = true;
    const s = fixture({ maxPendingRequests: 1, maxPendingRequestsPerPlayer: 1 }, port => ({ ...port, save(...args) {
      if (fail) { fail = false; throw new Error('injected write failure'); }
      return port.save(...args);
    } }));
    await assert.rejects(s.host.execute({ commandId: 'SET_PLAYER_PAUSE', playerId: 'a', parameters: { paused: true } }), /write failure/);
    assert.equal(s.load('a').playerEmpirePause.paused, false);
    const invalid = await s.host.execute({ commandId: 'SET_PLAYER_PAUSE', playerId: 'a', parameters: { paused: 'invalid' } });
    assert.equal(invalid.success, false);
    assert.ok((await read(s.host, 'b')).success);
    assert.ok((await read(s.host, 'a')).success);
  });
  await report('admission: rejected logical command can retry and its committed receipt still prevents replay', async () => {
    const s = fixture({ maxPendingRequests: 1 });
    const lease = await s.host.openGameplaySession('a', 'open');
    await read(s.host, 'b');
    const command = { commandId: 'SET_PLAYER_PAUSE', playerId: 'a', requestId: 'pause',
      gameplaySessionId: lease.sessionId, commandSequence: 1, renewalSequence: 1, parameters: { paused: true } };
    const before = snapshotGameState(s.load('a')), writes = s.store.saveCount.value;
    const accepted = read(s.host, 'b');
    await Promise.all([accepted, assert.rejects(s.host.execute(command), busy)]);
    assert.deepEqual(snapshotGameState(s.load('a')), before);
    assert.equal(s.store.saveCount.value, writes);
    assert.ok((await s.host.execute(command)).success);
    const committed = snapshotGameState(s.load('a'));
    assert.equal((await s.host.execute(command)).idempotentReplay, true);
    assert.deepEqual(snapshotGameState(s.load('a')), committed);
  });
  await report('admission: open heartbeat and end share capacity and rejected attempts change no leases', async () => {
    const s = fixture({ maxPendingRequests: 1 });
    const lease = await s.host.openGameplaySession('a', 'open');
    await read(s.host, 'b');
    for (const attempt of [
      () => s.host.openGameplaySession('a', 'second-open'),
      () => s.host.heartbeatGameplaySession('a', 'heartbeat', lease.sessionId, 1),
      () => s.host.endGameplaySession('a', 'end', lease.sessionId),
    ]) {
      const before = snapshotGameState(s.load('a')), writes = s.store.saveCount.value;
      const accepted = read(s.host, 'b');
      await Promise.all([accepted, assert.rejects(attempt(), busy)]);
      assert.deepEqual(snapshotGameState(s.load('a')), before);
      assert.equal(s.store.saveCount.value, writes);
    }
    await s.host.heartbeatGameplaySession('a', 'heartbeat', lease.sessionId, 1);
    await s.host.endGameplaySession('a', 'end', lease.sessionId);
  });
  await report('admission: accepted concurrency preserves canonical state with zero cache retention', async () => {
    const bounded = fixture({ maxCachedPlayers: 0, maxPendingRequests: 4, maxPendingRequestsPerPlayer: 3 });
    const sequential = fixture({ maxCachedPlayers: 0 });
    const commands = [true, false, true].map(paused => ({ commandId: 'SET_PLAYER_PAUSE', playerId: 'a', parameters: { paused } }));
    const queued = commands.map(command => bounded.host.execute(command));
    await Promise.all([...queued, read(bounded.host, 'b')]);
    for (const command of commands) assert.ok((await sequential.host.execute(command)).success);
    assert.deepEqual(snapshotGameState(bounded.load('a')), snapshotGameState(sequential.load('a')));
    assert.ok((await read(bounded.host, 'a')).success);
  });
  await report('admission: CAS conflict releases capacity and preserves the winning state', async () => {
    const s = fixture({ maxPendingRequests: 1, maxPendingRequestsPerPlayer: 1 });
    const other = createSessionHost(s.base, { nowMs: () => 1000 });
    await read(s.host, 'a'); await read(other, 'a');
    assert.ok((await other.execute({ commandId: 'SET_PLAYER_PAUSE', playerId: 'a', parameters: { paused: true } })).success);
    const before = snapshotGameState(s.load('a'));
    await assert.rejects(s.host.execute({ commandId: 'SET_PLAYER_PAUSE', playerId: 'a', parameters: { paused: false } }),
      (e: unknown) => e instanceof PersistenceFailedError && e.code === 'persistence.conflict');
    assert.ok((await read(s.host, 'a')).success);
    assert.deepEqual(snapshotGameState(s.load('a')), before);
  });
  for (const path of ['/commands', '/session/open', '/session/heartbeat', '/session/end']) {
    await report(`admission: ${path} emits safe retryable HTTP 503 under real host pressure`, async () => {
      const s = fixture({ maxPendingRequests: 1 });
      const lease = await s.host.openGameplaySession('a', 'open');
      await read(s.host, 'occupier');
      const before = snapshotGameState(s.load('a')), writes = s.store.saveCount.value;
      // Occupy the actual host synchronously just before this route reaches it.
      // No sleeps, private counters or imitation admission logic are involved.
      const pressure = async <T>(invoke: () => Promise<T>): Promise<T> => {
        const accepted = read(s.host, 'occupier');
        try { return await invoke(); } finally { await accepted; }
      };
      const pressured: CommandSessionHost = { persistenceName: s.host.persistenceName,
        execute: req => pressure(() => s.host.execute(req)),
        openGameplaySession: (...args) => pressure(() => s.host.openGameplaySession(...args)),
        heartbeatGameplaySession: (...args) => pressure(() => s.host.heartbeatGameplaySession(...args)),
        endGameplaySession: (...args) => pressure(() => s.host.endGameplaySession(...args)),
      };
      let reports = 0;
      await serve(pressured, async post => {
        const response = await post(path, { commandId: 'SET_PLAYER_PAUSE', parameters: { paused: true, maxPendingRequests: 999 },
          requestId: 'attempt', gameplaySessionId: lease.sessionId, commandSequence: 1, renewalSequence: 1,
          maxPendingRequests: 999, maxPendingRequestsPerPlayer: 999 });
        assert.equal(response.status, 503);
        assert.deepEqual(JSON.parse(response.raw), { error: 'SERVER_BUSY', message: 'Server is busy. Please retry this request.', retryable: true });
      }, () => { reports++; });
      assert.equal(reports, 0);
      assert.deepEqual(snapshotGameState(s.load('a')), before);
      assert.equal(s.store.saveCount.value, writes);
      assert.ok((await read(s.host, 'a')).success);
    });
  }
  await report('admission: capacity HTTP formatting never reads exception data or executes hooks', async () => {
    const s = fixture(), error = new RequestCapacityError(); let hooks = 0, reports = 0;
    const hook = () => { hooks++; return 'private-proposal-admission private-context-admission'; };
    for (const key of ['message', 'stack', 'details']) Object.defineProperty(error, key, { get: hook });
    Object.assign(error, { toJSON: hook, toString: hook, [inspect.custom]: hook });
    const host: CommandSessionHost = { ...s.host, execute: () => Promise.reject(error), openGameplaySession: () => Promise.reject(error) };
    await serve(host, async post => {
      for (const path of ['/commands', '/session/open']) {
        const result = await post(path, { commandId: 'GET_GAME_STATE', requestId: 'open' });
        assert.equal(result.status, 503); assert.equal(JSON.parse(result.raw).error, 'SERVER_BUSY');
        assert.equal(result.raw.includes('private-proposal-admission'), false);
        assert.equal(result.raw.includes('private-context-admission'), false);
      }
    }, () => { reports++; });
    assert.equal(hooks, 0); assert.equal(reports, 0);
  });
}
