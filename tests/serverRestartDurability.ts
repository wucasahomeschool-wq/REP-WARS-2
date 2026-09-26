import assert from 'assert';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { PersistenceError } from '../src/persistence/errors';
import { SupabaseWorkoutHistoryStore } from '../src/persistence/supabase/historyAdapter';
import { SupabasePlayerWorldTable } from '../src/persistence/supabase/playerWorldTable';
import { SupabaseWorkoutHistoryTable } from '../src/persistence/supabase/historyTable';
import { RoutingHistoryStore } from '../src/persistence/supabase/commandHistoryBuffer';
import { createDevelopmentPersistence, createInMemoryPersistence } from '../src/server/persistencePort';
import { createSessionHost, PersistenceFailedError } from '../src/server/session';
import { GameState } from '../src/types/GameState';

export interface ServerRestartTestApi {
  test: (name: string, fn: () => void) => void;
}

const SESSION_ID = 'wses_restart';

function restoreEnv(url: string | undefined, key: string | undefined): void {
  if (url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = url;
  if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
}

export function registerDevelopmentPersistenceTests(api: ServerRestartTestApi): void {
  const { test } = api;
  console.log('Development server persistence');

  test('development server uses Supabase only when both credentials are present', () => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      assert.strictEqual(createDevelopmentPersistence().name, 'memory');

      process.env.SUPABASE_URL = 'https://example.supabase.co';
      assert.throws(
        () => createDevelopmentPersistence(),
        (err: unknown) => err instanceof PersistenceError && err.code === 'persistence.not_configured',
      );

      process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-test-key';
      process.env.SUPABASE_URL = 'http://example.supabase.co';
      assert.throws(
        () => createDevelopmentPersistence(),
        (err: unknown) => err instanceof PersistenceError && err.code === 'persistence.not_configured',
      );

      process.env.SUPABASE_URL = 'https://example.supabase.co';
      const selected = createDevelopmentPersistence();
      assert.strictEqual(selected.name, 'supabase');
      assert.ok(selected.history instanceof RoutingHistoryStore);
      assert.strictEqual(typeof selected.commitWorld, 'function');
    } finally {
      restoreEnv(url, key);
    }
  });
}

export async function assertFailedWorldSaveRollsHistoryBack(): Promise<void> {
  const inner = createInMemoryPersistence();
  let saves = 0;
  const persistence = {
    name: 'memory' as const,
    history: inner.history,
    ensure: (playerId: string) => inner.ensure(playerId),
    save: (playerId: string, state: GameState, expectedVersion: number) => {
      saves += 1;
      if (saves >= 2) {
        return {
          ok: false as const,
          persisted: false as const,
          code: 'persistence.conflict',
          message: 'stale world write',
        };
      }
      return inner.save(playerId, state, expectedVersion);
    },
  };
  const playerId = 'repwars_session_rollback';
  const upserts: string[] = [];
  const originalUpsert = inner.history.upsert.bind(inner.history);
  inner.history.upsert = (entry) => {
    upserts.push(entry.sessionId);
    originalUpsert(entry);
  };
  const host = createSessionHost(persistence);
  const started = await host.execute({
    commandId: 'START_WORKOUT',
    playerId,
    requestId: 'start',
    parameters: { purpose: 'NORMAL_TROOPS', sessionId: SESSION_ID, now: 1_000 },
  });
  assert.strictEqual(started.success, true, started.errors[0]?.message);
  await assert.rejects(
    () => host.execute({
      commandId: 'ABANDON_WORKOUT',
      playerId,
      requestId: 'abandon',
      parameters: { now: 2_000 },
    }),
    (err: unknown) => err instanceof PersistenceFailedError && err.code === 'persistence.conflict',
  );
  assert.deepStrictEqual(upserts, [SESSION_ID]);
  assert.strictEqual(inner.history.get(playerId, SESSION_ID), null);
  const reloaded = await host.execute({
    commandId: 'GET_GAME_STATE',
    playerId,
    requestId: 'reload',
    parameters: {},
  });
  assert.strictEqual(reloaded.success, true, reloaded.errors[0]?.message);
  const gameplay = (reloaded.payload.gameState as { playerGameplay?: { activeWorkout?: { state?: string } | null } }).playerGameplay;
  assert.strictEqual(gameplay?.activeWorkout?.state, 'ACTIVE');
}

interface PublicGame {
  tutorial?: { beat?: string };
  playerGameplay?: {
    bankedTroops?: number;
    empirePaused?: boolean;
    activeWorkout?: {
      state?: string;
      feedbackState?: string;
      currentExercise?: {
        order: number;
        exerciseType?: string;
        skippable?: boolean;
        prescription?: { kind?: string; repetitions?: number; durationSeconds?: number };
      } | null;
    } | null;
  };
}

function httpJson(port: number, method: string, requestPath: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: requestPath,
        method,
        headers: payload === undefined ? undefined : {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) as Record<string, unknown> });
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function command(port: number, playerId: string, commandId: string, parameters: Record<string, unknown>, requestId: string): Promise<Record<string, unknown>> {
  return httpJson(port, 'POST', '/commands', { commandId, playerId, requestId, parameters }).then((response) => {
    if (response.status !== 200 || response.json.success !== true) {
      const errors = response.json.errors as { message?: string }[] | undefined;
      const message = errors?.[0]?.message ?? response.json.message ?? JSON.stringify(response.json);
      throw new Error(`${commandId} failed (${response.status}): ${message}`);
    }
    return response.json;
  });
}

async function gameSnapshot(port: number, playerId: string, requestId: string): Promise<PublicGame> {
  const response = await command(port, playerId, 'GET_GAME_STATE', {}, requestId);
  const payload = response.payload as { gameState?: PublicGame };
  if (!payload.gameState) throw new Error('GET_GAME_STATE returned no gameState');
  return payload.gameState;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function redact(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted]')
    .slice(0, 500);
}

function startDevelopmentServer(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, [
    path.join('node_modules', 'ts-node', 'dist', 'bin.js'),
    '--transpile-only',
    'src/server/main.ts',
  ], {
    cwd: process.cwd(),
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      REP_WARS_AI_INVASION_SETUP: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let output = '';
    let started = false;
    const timer = setTimeout(() => {
      void stopDevelopmentServer(child);
      reject(new Error(`Development server did not start: ${redact(output)}`));
    }, 90_000);
    const onChunk = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      if (!started && output.includes('listening on http://127.0.0.1:')) {
        started = true;
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
    child.once('exit', (code) => {
      if (started) return;
      clearTimeout(timer);
      reject(new Error(`Development server exited ${code ?? 'none'}: ${redact(output)}`));
    });
  });
}

function stopDevelopmentServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  });
}

async function finishWorkout(port: number, playerId: string): Promise<void> {
  await command(port, playerId, 'START_WORKOUT', {
    purpose: 'NORMAL_TROOPS',
    sessionId: SESSION_ID,
    now: 1_000,
  }, 'start');
  let clock = 2_000;
  for (let step = 0; step < 80; step += 1) {
    const state = await gameSnapshot(port, playerId, `peek_${step}`);
    const workout = state.playerGameplay?.activeWorkout;
    if (!workout || workout.state !== 'ACTIVE') break;
    const current = workout.currentExercise;
    if (!current) throw new Error('Active workout has no current exercise');
    clock += 1_000;
    if (current.skippable && current.exerciseType === 'REST') {
      await command(port, playerId, 'SKIP_REST', { order: current.order, now: clock }, `skip_${step}`);
      continue;
    }
    const parameters: Record<string, unknown> = { order: current.order, now: clock };
    if (current.prescription?.kind === 'repetitions') parameters.repetitions = current.prescription.repetitions;
    else parameters.durationSeconds = current.prescription?.durationSeconds;
    await command(port, playerId, 'RECORD_EXERCISE', parameters, `record_${step}`);
  }
  const finished = await gameSnapshot(port, playerId, 'after_exercises');
  if (finished.playerGameplay?.activeWorkout?.feedbackState === 'FEEDBACK_REQUIRED') {
    await command(port, playerId, 'SUBMIT_WORKOUT_FEEDBACK', { value: 'ABOUT_RIGHT', now: clock + 1_000 }, 'feedback');
  }
  await command(port, playerId, 'FINALIZE_WORKOUT', { now: clock + 2_000 }, 'finalize');
}

export async function runSupabaseServerRestart(): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('  · live server restart skipped; credentials are not set');
    return;
  }
  const playerId = `repwars_http_restart_${Date.now()}`;
  const worlds = new SupabasePlayerWorldTable();
  const historyTable = new SupabaseWorkoutHistoryTable();
  const servers: ChildProcess[] = [];
  try {
    const firstPort = await freePort();
    const first = await startDevelopmentServer(firstPort);
    servers.push(first);
    const health = await httpJson(firstPort, 'GET', '/health');
    assert.strictEqual(health.json.persistence, 'supabase');
    await finishWorkout(firstPort, playerId);
    const saved = await gameSnapshot(firstPort, playerId, 'saved');
    const troops = saved.playerGameplay?.bankedTroops ?? 0;
    const beat = saved.tutorial?.beat;
    assert.ok(troops > 0, `expected banked troops, got ${troops}`);
    assert.ok(beat && beat !== 'FIRST_WORKOUT_PENDING', `expected the tutorial to advance, got ${beat}`);
    assert.strictEqual(saved.playerGameplay?.activeWorkout ?? null, null);
    assert.strictEqual(saved.playerGameplay?.empirePaused, false);
    await stopDevelopmentServer(first);

    const secondPort = await freePort();
    const second = await startDevelopmentServer(secondPort);
    servers.push(second);
    const restored = await gameSnapshot(secondPort, playerId, 'restored');
    assert.strictEqual(restored.playerGameplay?.bankedTroops, troops);
    assert.strictEqual(restored.tutorial?.beat, beat);
    assert.strictEqual(restored.playerGameplay?.activeWorkout ?? null, null);
    const entry = new SupabaseWorkoutHistoryStore(historyTable).get(playerId, SESSION_ID);
    assert.strictEqual(entry?.completionState, 'COMPLETED');
    assert.strictEqual(entry?.playerId, playerId);

    const thirdPort = await freePort();
    const third = await startDevelopmentServer(thirdPort);
    servers.push(third);
    await gameSnapshot(thirdPort, playerId, 'third_boot');
    await command(secondPort, playerId, 'SET_PLAYER_PAUSE', { paused: true }, 'pause');
    const conflict = await httpJson(thirdPort, 'POST', '/commands', {
      commandId: 'SET_PLAYER_PAUSE',
      playerId,
      requestId: 'stale_pause',
      parameters: { paused: false },
    });
    assert.strictEqual(conflict.status, 500);
    assert.strictEqual(conflict.json.code, 'persistence.conflict');
    await stopDevelopmentServer(second);
    await stopDevelopmentServer(third);

    const fourthPort = await freePort();
    const fourth = await startDevelopmentServer(fourthPort);
    servers.push(fourth);
    const afterConflict = await gameSnapshot(fourthPort, playerId, 'after_conflict');
    assert.strictEqual(afterConflict.playerGameplay?.bankedTroops, troops);
    assert.strictEqual(afterConflict.playerGameplay?.empirePaused, true);
    assert.strictEqual(afterConflict.tutorial?.beat, beat);
  } finally {
    for (const server of servers) await stopDevelopmentServer(server);
    historyTable.deletePlayer(playerId);
    worlds.deletePlayer(playerId);
  }
}
