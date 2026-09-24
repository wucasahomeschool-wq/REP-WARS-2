import assert from 'assert';
import { request } from 'node:http';
import { createCommandHttpServer } from '../src/server/http';
import { createInMemoryPersistence } from '../src/server/persistencePort';
import { createSessionHost } from '../src/server/session';

function httpJson(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
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

export async function runHttpBridgeTest(): Promise<void> {
  const server = createCommandHttpServer(createSessionHost(createInMemoryPersistence()));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('HTTP bridge did not bind a port');
  }
  try {
    const health = await httpJson(address.port, 'GET', '/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.json.ok, true);
    assert.strictEqual(health.json.persistence, 'memory');

    const state = await httpJson(address.port, 'POST', '/commands', {
      commandId: 'GET_GAME_STATE',
      playerId: 'player_local',
      requestId: 'unity-1',
      parameters: {},
    });
    assert.strictEqual(state.status, 200);
    assert.strictEqual(state.json.success, true);
    assert.strictEqual(state.json.commandId, 'GET_GAME_STATE');
    const payload = state.json.payload as { gameState?: { playerFactionId?: string } };
    assert.strictEqual(payload.gameState?.playerFactionId, 'f_player');

    const denied = await httpJson(address.port, 'POST', '/commands', {
      commandId: 'ADVANCE_WORLD',
      playerId: 'player_local',
    });
    assert.strictEqual(denied.status, 403);
    assert.strictEqual(denied.json.error, 'COMMAND_NOT_EXPOSED');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}
