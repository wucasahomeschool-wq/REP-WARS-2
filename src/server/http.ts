import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import { CommandRequest } from '../orchestration/protocol';
import { BadRequestError, resolvePlayerId } from './identity';
import { GameplaySessionReceiptError } from './gameplaySessionLifecycle';
import { CommandNotExposedError, CommandSessionHost, PersistenceFailedError } from './session';

const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function pathname(req: IncomingMessage): string {
  const raw = req.url ?? '/';
  try {
    return new URL(raw, 'http://127.0.0.1').pathname;
  } catch {
    return raw;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = req.headers['content-length'];
    if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) {
      reject(new BadRequestError('Request body exceeds 1 MiB'));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new BadRequestError('Request body exceeds 1 MiB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => fail(err));
  });
}

function isJsonContentType(req: IncomingMessage): boolean {
  const header = req.headers['content-type'];
  if (typeof header !== 'string') return false;
  return header.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function optionalObject(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function commandFromBody(req: IncomingMessage, parsed: unknown): CommandRequest {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestError('Request body must be a JSON object');
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.commandId !== 'string' || body.commandId.trim() === '') {
    throw new BadRequestError('commandId must be a non-empty string');
  }
  if (body.timestamp !== undefined && typeof body.timestamp !== 'number') {
    throw new BadRequestError('timestamp must be a number');
  }
  if (body.requestId !== undefined && typeof body.requestId !== 'string') {
    throw new BadRequestError('requestId must be a string');
  }
  if (body.gameplaySessionId !== undefined && typeof body.gameplaySessionId !== 'string') {
    throw new BadRequestError('gameplaySessionId must be a string');
  }
  if (body.renewalSequence !== undefined && typeof body.renewalSequence !== 'number') {
    throw new BadRequestError('renewalSequence must be a positive safe integer');
  }
  if (body.commandSequence !== undefined && typeof body.commandSequence !== 'number') {
    throw new BadRequestError('commandSequence must be a positive safe integer');
  }
  const playerId = resolvePlayerId(req, body);
  return {
    commandId: body.commandId,
    playerId,
    timestamp: body.timestamp as number | undefined,
    parameters: optionalObject(body.parameters, 'parameters'),
    clientContext: optionalObject(body.clientContext, 'clientContext'),
    requestId: body.requestId as string | undefined,
    gameplaySessionId: body.gameplaySessionId as string | undefined,
    renewalSequence: body.renewalSequence as number | undefined,
    commandSequence: body.commandSequence as number | undefined,
  };
}

async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!isJsonContentType(req)) {
    throw new BadRequestError('Content-Type must be application/json');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch (err) {
    if (err instanceof BadRequestError) throw err;
    throw new BadRequestError('Malformed JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestError('Request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function requireRequestId(body: Record<string, unknown>): string {
  if (typeof body.requestId !== 'string') throw new BadRequestError('requestId must be a non-empty string');
  return body.requestId;
}

function requireRenewalSequence(body: Record<string, unknown>): number {
  if (typeof body.renewalSequence !== 'number' || !Number.isSafeInteger(body.renewalSequence) || body.renewalSequence < 1) {
    throw new BadRequestError('renewalSequence must be a positive safe integer');
  }
  return body.renewalSequence;
}

function requireGameplaySessionId(body: Record<string, unknown>): string {
  if (typeof body.gameplaySessionId !== 'string') {
    throw new BadRequestError('gameplaySessionId must be a non-empty string');
  }
  return body.gameplaySessionId;
}

async function handleSession(
  req: IncomingMessage,
  res: ServerResponse,
  host: CommandSessionHost,
  kind: 'open' | 'heartbeat' | 'end',
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(req);
  } catch (err) {
    const message = err instanceof BadRequestError ? err.message : 'Malformed request';
    sendJson(res, 400, { error: 'BAD_REQUEST', message });
    return;
  }
  try {
    const playerId = resolvePlayerId(req, body);
    const requestId = requireRequestId(body);
    const view = kind === 'open'
      ? await host.openGameplaySession(playerId, requestId)
      : kind === 'heartbeat'
        ? await host.heartbeatGameplaySession(
          playerId,
          requestId,
          requireGameplaySessionId(body),
          requireRenewalSequence(body),
        )
        : await host.endGameplaySession(playerId, requestId, requireGameplaySessionId(body));
    sendJson(res, 200, view);
  } catch (err) {
    if (err instanceof BadRequestError) {
      sendJson(res, 400, { error: 'BAD_REQUEST', message: err.message });
      return;
    }
    if (err instanceof GameplaySessionReceiptError) {
      sendJson(res, 409, { error: 'STALE_RECEIPT', message: err.message });
      return;
    }
    if (err instanceof PersistenceFailedError) {
      sendJson(res, 500, { error: 'PERSISTENCE_FAILED', message: err.message, code: err.code });
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    sendJson(res, 500, { error: 'INTERNAL', message });
  }
}

async function handleCommand(req: IncomingMessage, res: ServerResponse, host: CommandSessionHost): Promise<void> {
  let parsed: Record<string, unknown>;
  try {
    parsed = await readJsonObject(req);
  } catch (err) {
    const message = err instanceof BadRequestError ? err.message : 'Malformed JSON';
    sendJson(res, 400, { error: 'BAD_REQUEST', message });
    return;
  }
  let request: CommandRequest;
  try {
    request = commandFromBody(req, parsed);
  } catch (err) {
    const message = err instanceof BadRequestError ? err.message : 'Malformed request';
    sendJson(res, 400, { error: 'BAD_REQUEST', message });
    return;
  }
  try {
    const response = await host.execute(request);
    sendJson(res, 200, response);
  } catch (err) {
    if (err instanceof CommandNotExposedError) {
      sendJson(res, 403, { error: 'COMMAND_NOT_EXPOSED', message: err.message });
      return;
    }
    if (err instanceof PersistenceFailedError) {
      sendJson(res, 500, { error: 'PERSISTENCE_FAILED', message: err.message, code: err.code });
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    sendJson(res, 500, { error: 'INTERNAL', message });
  }
}

export function createCommandHttpServer(host: CommandSessionHost): Server {
  return createServer((req, res) => {
    const path = pathname(req);
    if (req.method === 'GET' && path === '/health') {
      sendJson(res, 200, { ok: true, service: 'rep-wars', persistence: host.persistenceName });
      return;
    }
    if (req.method === 'POST' && (path === '/session/open' || path === '/session/heartbeat' || path === '/session/end')) {
      const kind = path === '/session/open' ? 'open' : path === '/session/heartbeat' ? 'heartbeat' : 'end';
      void handleSession(req, res, host, kind).catch((err: unknown) => {
        if (res.headersSent) return;
        const message = err instanceof Error ? err.message : 'Internal error';
        sendJson(res, 500, { error: 'INTERNAL', message });
      });
      return;
    }
    if (req.method === 'POST' && path === '/commands') {
      void handleCommand(req, res, host).catch((err: unknown) => {
        if (res.headersSent) return;
        const message = err instanceof Error ? err.message : 'Internal error';
        sendJson(res, 500, { error: 'INTERNAL', message });
      });
      return;
    }
    sendJson(res, 404, { error: 'NOT_FOUND', message: 'Not found' });
  });
}
